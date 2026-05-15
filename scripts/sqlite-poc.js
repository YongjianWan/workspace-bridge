#!/usr/bin/env node
/**
 * SQLite POC: 验证 better-sqlite3 的读写性能和查询能力
 *
 * 目标：
 * 1. 写入 239 nodes + 473 edges（模拟 ai_zcypg_frontend 规模）
 * 2. 测试核心查询性能（findDeadExports / getImpactRadius / cycles）
 * 3. 对比内存 Map vs SQLite 查询耗时
 * 4. 验证增量更新（update 1 个文件只改几条记录）
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '.tmp-sqlite-poc.db');

// 清理旧数据库
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('=== SQLite POC ===\n');
console.log('Database:', DB_PATH);

// ========== Schema ==========
console.log('\n[1] Creating schema...');
const t0 = Date.now();

db.exec(`
  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    role TEXT,
    framework TEXT,
    hash TEXT,
    last_analyzed INTEGER
  );

  CREATE TABLE edges (
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    type TEXT DEFAULT 'import',
    symbols TEXT,
    is_implicit INTEGER DEFAULT 0,
    PRIMARY KEY (from_id, to_id, type)
  );

  CREATE TABLE file_metadata (
    path TEXT PRIMARY KEY,
    mtime INTEGER,
    size INTEGER,
    hash TEXT,
    parse_mode TEXT,
    parse_mode_reason TEXT,
    last_parsed INTEGER
  );

  CREATE INDEX idx_edges_to ON edges(to_id);
  CREATE INDEX idx_edges_from ON edges(from_id);
`);

console.log(`  Schema created in ${Date.now() - t0}ms`);

// ========== Data Generation ==========
console.log('\n[2] Generating test data...');

const NODE_COUNT = 239;
const EDGE_COUNT = 473;

// 生成 nodes
const nodes = [];
for (let i = 0; i < NODE_COUNT; i++) {
  nodes.push({
    path: `src/${i % 10 === 0 ? 'views' : i % 10 === 1 ? 'components' : i % 10 === 2 ? 'utils' : 'api'}/file_${i}.js`,
    role: i < 5 ? 'entry' : i < 50 ? 'library' : 'unknown',
    framework: i % 5 === 0 ? 'vue' : i % 7 === 0 ? 'spring' : null,
    hash: `hash_${i}_${Math.random().toString(36).slice(2)}`,
    last_analyzed: Date.now()
  });
}

// 生成 edges（模拟真实依赖模式：局部聚集 + 少量长链）
const edges = [];
for (let i = 0; i < EDGE_COUNT; i++) {
  const from = Math.floor(Math.random() * NODE_COUNT);
  const to = Math.floor(Math.random() * NODE_COUNT);
  if (from === to) continue;
  
  // 50% 概率是局部依赖（同目录）
  const isLocal = Math.random() < 0.5;
  const toNode = isLocal
    ? Math.floor(from / 10) * 10 + Math.floor(Math.random() * 10)
    : to;
  
  if (from === toNode || toNode >= NODE_COUNT) continue;
  
  edges.push({
    from_id: from + 1, // SQLite 自增 ID 从 1 开始
    to_id: toNode + 1,
    type: Math.random() < 0.9 ? 'import' : 'dynamic',
    symbols: JSON.stringify(['func_' + i, 'const_' + i]),
    is_implicit: 0
  });
}

console.log(`  Nodes: ${NODE_COUNT}`);
console.log(`  Edges: ${edges.length}`);

// ========== Bulk Insert ==========
console.log('\n[3] Bulk inserting...');

const insertNode = db.prepare(
  'INSERT INTO nodes (path, role, framework, hash, last_analyzed) VALUES (?, ?, ?, ?, ?)'
);
const insertEdge = db.prepare(
  'INSERT INTO edges (from_id, to_id, type, symbols, is_implicit) VALUES (?, ?, ?, ?, ?)'
);

const insertAll = db.transaction(() => {
  for (const n of nodes) {
    insertNode.run(n.path, n.role, n.framework, n.hash, n.last_analyzed);
  }
  for (const e of edges) {
    try {
      insertEdge.run(e.from_id, e.to_id, e.type, e.symbols, e.is_implicit);
    } catch (err) {
      // 忽略重复边
    }
  }
});

const t1 = Date.now();
insertAll();
console.log(`  Inserted in ${Date.now() - t1}ms`);

// ========== Query 1: findDeadExports ==========
console.log('\n[4] Query: findDeadExports (nodes with no incoming edges)...');

const t2 = Date.now();
const deadExports = db.prepare(`
  SELECT n.id, n.path, n.role
  FROM nodes n
  LEFT JOIN edges e ON e.to_id = n.id
  WHERE e.to_id IS NULL
`).all();
console.log(`  Result: ${deadExports.length} dead exports`);
console.log(`  Time: ${Date.now() - t2}ms`);

// ========== Query 2: getImpactRadius (Recursive CTE) ==========
console.log('\n[5] Query: getImpactRadius (recursive CTE from node 10)...');

const t3 = Date.now();
const impactResult = db.prepare(`
  WITH RECURSIVE impact_chain(node_id, level, path_chain) AS (
    SELECT to_id, 1, CAST(from_id AS TEXT) || '->' || CAST(to_id AS TEXT)
    FROM edges
    WHERE from_id = 10
    
    UNION ALL
    
    SELECT e.to_id, ic.level + 1, ic.path_chain || '->' || CAST(e.to_id AS TEXT)
    FROM edges e
    JOIN impact_chain ic ON e.from_id = ic.node_id
    WHERE ic.level < 3
      AND e.to_id NOT IN (
        -- 避免循环：路径中已出现的节点不再遍历
        SELECT CAST(value AS INTEGER)
        FROM json_each('[' || REPLACE(REPLACE(ic.path_chain, '->', ','), ic.path_chain || '->', '') || ']')
      )
  )
  SELECT DISTINCT node_id, level
  FROM impact_chain
  ORDER BY level
`).all();
console.log(`  Result: ${impactResult.length} impacted files`);
console.log(`  Time: ${Date.now() - t3}ms`);

// ========== Query 3: findCircularDependencies ==========
console.log('\n[6] Query: findCircularDependencies (cycle detection)...');

const t4 = Date.now();
const cycles = db.prepare(`
  WITH RECURSIVE path(from_id, to_id, depth, cycle_path, visited) AS (
    SELECT from_id, to_id, 1, CAST(from_id AS TEXT) || '->' || CAST(to_id AS TEXT), CAST(from_id AS TEXT) || ',' || CAST(to_id AS TEXT)
    FROM edges
    
    UNION ALL
    
    SELECT p.from_id, e.to_id, p.depth + 1,
      p.cycle_path || '->' || CAST(e.to_id AS TEXT),
      p.visited || ',' || CAST(e.to_id AS TEXT)
    FROM path p
    JOIN edges e ON p.to_id = e.from_id
    WHERE p.depth < 5
      AND p.visited NOT LIKE '%,' || CAST(e.to_id AS TEXT) || ',%'
      AND e.to_id != p.from_id
  )
  SELECT from_id, to_id, cycle_path
  FROM path
  WHERE to_id = from_id
  LIMIT 10
`).all();
console.log(`  Result: ${cycles.length} cycles found`);
console.log(`  Time: ${Date.now() - t4}ms`);

// ========== Query 4: Memory Map Simulation ==========
console.log('\n[7] Memory Map baseline (for comparison)...');

// 模拟内存 Map
const memGraph = new Map();
const memReverseGraph = new Map();
for (const e of edges) {
  if (!memGraph.has(e.from_id)) memGraph.set(e.from_id, []);
  memGraph.get(e.from_id).push(e.to_id);
  if (!memReverseGraph.has(e.to_id)) memReverseGraph.set(e.to_id, []);
  memReverseGraph.get(e.to_id).push(e.from_id);
}

const t5 = Date.now();
const memDead = [];
for (let i = 1; i <= NODE_COUNT; i++) {
  if (!memReverseGraph.has(i)) memDead.push(i);
}
console.log(`  Memory findDeadExports: ${memDead.length} files, ${Date.now() - t5}ms`);

const t6 = Date.now();
const memImpact = new Map();
const queue = [[10, 0]];
const visited = new Set();
while (queue.length > 0) {
  const [node, level] = queue.shift();
  if (level >= 3 || visited.has(node)) continue;
  visited.add(node);
  memImpact.set(node, level);
  const deps = memGraph.get(node) || [];
  for (const d of deps) queue.push([d, level + 1]);
}
console.log(`  Memory getImpactRadius: ${memImpact.size} files, ${Date.now() - t6}ms`);

// ========== Incremental Update ==========
console.log('\n[8] Incremental update test...');

const t7 = Date.now();
const affectedNode = 10;

// 1. 删除旧边
const deleteOld = db.prepare('DELETE FROM edges WHERE from_id = ?');
deleteOld.run(affectedNode);

// 2. 插入新边（模拟文件变化后新增了 3 个 import，删除了 2 个）
const insertNew = db.prepare('INSERT INTO edges (from_id, to_id, type, symbols, is_implicit) VALUES (?, ?, ?, ?, ?)');
insertNew.run(affectedNode, 20, 'import', JSON.stringify(['newFunc1']), 0);
insertNew.run(affectedNode, 30, 'import', JSON.stringify(['newFunc2']), 0);
insertNew.run(affectedNode, 40, 'import', JSON.stringify(['newFunc3']), 0);

console.log(`  Incremental update (delete + insert 3 edges): ${Date.now() - t7}ms`);

// 验证更新后的查询
const t8 = Date.now();
const postUpdateImpact = db.prepare(`
  WITH RECURSIVE impact_chain(node_id, level) AS (
    SELECT to_id, 1 FROM edges WHERE from_id = 10
    UNION ALL
    SELECT e.to_id, ic.level + 1
    FROM edges e
    JOIN impact_chain ic ON e.from_id = ic.node_id
    WHERE ic.level < 3
  )
  SELECT COUNT(DISTINCT node_id) as count FROM impact_chain
`).get();
console.log(`  Post-update impact query: ${postUpdateImpact.count} files, ${Date.now() - t8}ms`);

// ========== File Size ==========
console.log('\n[9] File size...');
const stats = fs.statSync(DB_PATH);
console.log(`  Database file: ${(stats.size / 1024).toFixed(1)} KB`);

// 对比 JSON 缓存大小
const jsonData = { nodes, edges };
const jsonPath = DB_PATH + '.json';
fs.writeFileSync(jsonPath, JSON.stringify(jsonData));
const jsonStats = fs.statSync(jsonPath);
console.log(`  Equivalent JSON: ${(jsonStats.size / 1024).toFixed(1)} KB`);

// ========== Summary ==========
console.log('\n=== POC Summary ===');
console.log(`Nodes: ${NODE_COUNT}`);
console.log(`Edges: ${edges.length}`);
console.log(`SQLite DB size: ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`JSON equivalent: ${(jsonStats.size / 1024).toFixed(1)} KB`);
console.log(`\nQuery performance:`);
console.log(`  findDeadExports: SQLite=${Date.now() - t2}ms vs Memory=${Date.now() - t5}ms`);
console.log(`  getImpactRadius: SQLite=${Date.now() - t3}ms vs Memory=${Date.now() - t6}ms`);
console.log(`  Incremental update: ${Date.now() - t7}ms`);
console.log(`\nConclusion: SQLite ${stats.size < jsonStats.size ? 'smaller' : 'larger'} than JSON, queries ${t3 - t6 < 10 ? 'comparable' : 'slower'} than memory.`);

// 清理
fs.unlinkSync(jsonPath);
