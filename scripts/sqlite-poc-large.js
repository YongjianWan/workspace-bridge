#!/usr/bin/env node
/**
 * SQLite POC Stage 3: 大项目压力测试
 *
 * 目标：
 * 1. 写入 5000+ nodes + 20000+ edges
 * 2. 验证 recursive CTE 在大图上是否仍 < 100ms
 * 3. 验证批量增量更新性能（模拟 watch 场景）
 * 4. 对比内存 Map 基线
 * 5. 验证 WAL 模式下无异常
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.tmpdir(), 'wb-poc-large.db');

// 清理旧数据库
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('=== SQLite POC Stage 3: Large Project Stress Test ===\n');
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

const NODE_COUNT = 5000;
const EDGE_COUNT = 20000;

// 生成 nodes：模拟真实项目目录结构
const DIR_NAMES = ['views', 'components', 'utils', 'api', 'services', 'models', 'hooks', 'store', 'router', 'config'];
const nodes = [];
for (let i = 0; i < NODE_COUNT; i++) {
  const dir = DIR_NAMES[i % DIR_NAMES.length];
  nodes.push({
    path: `src/${dir}/file_${i}.js`,
    role: i < 20 ? 'entry' : i < 500 ? 'library' : 'unknown',
    framework: i % 5 === 0 ? 'vue' : i % 7 === 0 ? 'spring' : null,
    hash: `hash_${i}_${Math.random().toString(36).slice(2)}`,
    last_analyzed: Date.now()
  });
}

// 生成 edges：模拟真实依赖模式
// 1. 同目录局部聚集（60%）
// 2. 中心枢纽（utils/index.js 被大量引用，5%）
// 3. 跨目录长链（35%）
const edges = [];
const edgeSet = new Set();

for (let i = 0; i < EDGE_COUNT; i++) {
  const from = Math.floor(Math.random() * NODE_COUNT);
  let to;

  const r = Math.random();
  if (r < 0.6) {
    // 同目录
    const dirBase = Math.floor(from / DIR_NAMES.length) * DIR_NAMES.length;
    to = dirBase + Math.floor(Math.random() * DIR_NAMES.length);
  } else if (r < 0.65) {
    // 中心枢纽：指向 utils 目录前 20 个文件
    to = 20 + Math.floor(Math.random() * 20);
  } else {
    // 随机跨目录
    to = Math.floor(Math.random() * NODE_COUNT);
  }

  if (from === to || to >= NODE_COUNT) continue;

  const fromId = from + 1;
  const toId = to + 1;
  const key = `${fromId}->${toId}`;
  if (edgeSet.has(key)) continue;
  edgeSet.add(key);

  edges.push({
    from_id: fromId,
    to_id: toId,
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
const insertMs = Date.now() - t1;
console.log(`  Inserted in ${insertMs}ms`);

// ========== Memory Map Baseline ==========
console.log('\n[4] Building memory Map baseline...');
const tMemBuild = Date.now();
const memGraph = new Map();
const memReverseGraph = new Map();
for (const e of edges) {
  if (!memGraph.has(e.from_id)) memGraph.set(e.from_id, []);
  memGraph.get(e.from_id).push(e.to_id);
  if (!memReverseGraph.has(e.to_id)) memReverseGraph.set(e.to_id, []);
  memReverseGraph.get(e.to_id).push(e.from_id);
}
console.log(`  Memory graph built in ${Date.now() - tMemBuild}ms`);

// ========== Query 1: findDeadExports ==========
console.log('\n[5] Query: findDeadExports (nodes with no incoming edges)...');

const t2 = Date.now();
const deadExports = db.prepare(`
  SELECT n.id, n.path, n.role
  FROM nodes n
  LEFT JOIN edges e ON e.to_id = n.id
  WHERE e.to_id IS NULL
`).all();
const deadMs = Date.now() - t2;
console.log(`  Result: ${deadExports.length} dead exports`);
console.log(`  SQLite time: ${deadMs}ms`);

const tMemDead = Date.now();
const memDead = [];
for (let i = 1; i <= NODE_COUNT; i++) {
  if (!memReverseGraph.has(i)) memDead.push(i);
}
const memDeadMs = Date.now() - tMemDead;
console.log(`  Memory time: ${memDeadMs}ms`);

// ========== Query 2: getImpactRadius depth=2 (Recursive CTE) ==========
console.log('\n[6] Query: getImpactRadius depth=2 (recursive CTE from node 100)...');

const t3 = Date.now();
const impactD2 = db.prepare(`
  WITH RECURSIVE impact_chain(node_id, level) AS (
    SELECT to_id, 1 FROM edges WHERE from_id = 100
    UNION ALL
    SELECT e.to_id, ic.level + 1
    FROM edges e
    JOIN impact_chain ic ON e.from_id = ic.node_id
    WHERE ic.level < 2
  )
  SELECT COUNT(DISTINCT node_id) as count FROM impact_chain
`).get();
const impactD2Ms = Date.now() - t3;
console.log(`  Result: ${impactD2.count} impacted files`);
console.log(`  SQLite time: ${impactD2Ms}ms`);

const tMemImpactD2 = Date.now();
const memImpactD2 = new Set();
const queueD2 = [[100, 0]];
const visitedD2 = new Set();
while (queueD2.length > 0) {
  const [node, level] = queueD2.shift();
  if (level >= 2 || visitedD2.has(node)) continue;
  visitedD2.add(node);
  memImpactD2.add(node);
  for (const d of memGraph.get(node) || []) {
    queueD2.push([d, level + 1]);
  }
}
const memImpactD2Ms = Date.now() - tMemImpactD2;
console.log(`  Memory time: ${memImpactD2Ms}ms`);

// ========== Query 3: getImpactRadius depth=5 (deeper chain) ==========
console.log('\n[7] Query: getImpactRadius depth=5 (deeper recursive CTE from node 100)...');

const t4 = Date.now();
const impactD5 = db.prepare(`
  WITH RECURSIVE impact_chain(node_id, level) AS (
    SELECT to_id, 1 FROM edges WHERE from_id = 100
    UNION ALL
    SELECT e.to_id, ic.level + 1
    FROM edges e
    JOIN impact_chain ic ON e.from_id = ic.node_id
    WHERE ic.level < 5
  )
  SELECT COUNT(DISTINCT node_id) as count FROM impact_chain
`).get();
const impactD5Ms = Date.now() - t4;
console.log(`  Result: ${impactD5.count} impacted files`);
console.log(`  SQLite time: ${impactD5Ms}ms`);

const tMemImpactD5 = Date.now();
const memImpactD5 = new Set();
const queueD5 = [[100, 0]];
const visitedD5 = new Set();
while (queueD5.length > 0) {
  const [node, level] = queueD5.shift();
  if (level >= 5 || visitedD5.has(node)) continue;
  visitedD5.add(node);
  memImpactD5.add(node);
  for (const d of memGraph.get(node) || []) {
    queueD5.push([d, level + 1]);
  }
}
const memImpactD5Ms = Date.now() - tMemImpactD5;
console.log(`  Memory time: ${memImpactD5Ms}ms`);

// ========== Query 4: findCircularDependencies ==========
console.log('\n[8] Query: findCircularDependencies (cycle detection depth < 6)...');

const t5 = Date.now();
const cycles = db.prepare(`
  WITH RECURSIVE path(from_id, to_id, depth, cycle_path, visited) AS (
    SELECT from_id, to_id, 1,
      CAST(from_id AS TEXT) || '->' || CAST(to_id AS TEXT),
      CAST(from_id AS TEXT) || ',' || CAST(to_id AS TEXT)
    FROM edges

    UNION ALL

    SELECT p.from_id, e.to_id, p.depth + 1,
      p.cycle_path || '->' || CAST(e.to_id AS TEXT),
      p.visited || ',' || CAST(e.to_id AS TEXT)
    FROM path p
    JOIN edges e ON p.to_id = e.from_id
    WHERE p.depth < 6
      AND p.visited NOT LIKE '%,' || CAST(e.to_id AS TEXT) || ',%'
      AND e.to_id != p.from_id
  )
  SELECT from_id, to_id, cycle_path
  FROM path
  WHERE to_id = from_id
  LIMIT 50
`).all();
const cycleMs = Date.now() - t5;
console.log(`  Result: ${cycles.length} cycles found`);
console.log(`  SQLite time: ${cycleMs}ms`);

// ========== Query 5: Random node impact (simulate audit-file) ==========
console.log('\n[9] Query: Random node impact (100 random files, depth=2)...');

const randomNodes = Array.from({ length: 100 }, () => Math.floor(Math.random() * NODE_COUNT) + 1);
const t6 = Date.now();
let totalRandomImpacts = 0;
const randomImpactStmt = db.prepare(`
  WITH RECURSIVE impact_chain(node_id, level) AS (
    SELECT to_id, 1 FROM edges WHERE from_id = ?
    UNION ALL
    SELECT e.to_id, ic.level + 1
    FROM edges e
    JOIN impact_chain ic ON e.from_id = ic.node_id
    WHERE ic.level < 2
  )
  SELECT COUNT(DISTINCT node_id) as count FROM impact_chain
`);
for (const nodeId of randomNodes) {
  const r = randomImpactStmt.get(nodeId);
  totalRandomImpacts += r.count;
}
const randomMs = Date.now() - t6;
console.log(`  Total impacted files (100 random): ${totalRandomImpacts}`);
console.log(`  SQLite time: ${randomMs}ms (avg ${(randomMs / 100).toFixed(2)}ms/query)`);

// ========== Query 6: Batch incremental update (simulate watch) ==========
console.log('\n[10] Batch incremental update (50 files, delete + insert 3 edges each)...');

const t7 = Date.now();
const deleteOldStmt = db.prepare('DELETE FROM edges WHERE from_id = ?');
const insertNewStmt = db.prepare('INSERT INTO edges (from_id, to_id, type, symbols, is_implicit) VALUES (?, ?, ?, ?, ?)');

const batchUpdate = db.transaction(() => {
  for (let i = 1; i <= 50; i++) {
    const fromId = i * 10;
    deleteOldStmt.run(fromId);
    for (let j = 0; j < 3; j++) {
      const toId = Math.floor(Math.random() * NODE_COUNT) + 1;
      if (fromId === toId) continue;
      try {
        insertNewStmt.run(fromId, toId, 'import', JSON.stringify([`newFunc_${i}_${j}`]), 0);
      } catch (err) {
        // ignore dup
      }
    }
  }
});

batchUpdate();
const batchUpdateMs = Date.now() - t7;
console.log(`  Batch update (50 files): ${batchUpdateMs}ms`);

// 验证更新后总量
const postUpdateCount = db.prepare('SELECT COUNT(*) as count FROM edges').get();
console.log(`  Total edges after update: ${postUpdateCount.count}`);

// ========== File Size ==========
console.log('\n[11] File size comparison...');
const dbStats = fs.statSync(DB_PATH);
const jsonData = { nodes, edges };
const jsonPath = DB_PATH + '.json';
fs.writeFileSync(jsonPath, JSON.stringify(jsonData));
const jsonStats = fs.statSync(jsonPath);

console.log(`  SQLite DB size: ${(dbStats.size / 1024).toFixed(1)} KB`);
console.log(`  JSON equivalent: ${(jsonStats.size / 1024).toFixed(1)} KB`);
console.log(`  Size ratio: ${(jsonStats.size / dbStats.size).toFixed(1)}x`);

// ========== Summary ==========
console.log('\n=== POC Stage 3 Summary ===');
console.log(`Nodes: ${NODE_COUNT}`);
console.log(`Edges: ${edges.length}`);
console.log(`SQLite DB size: ${(dbStats.size / 1024).toFixed(1)} KB`);
console.log(`JSON equivalent: ${(jsonStats.size / 1024).toFixed(1)} KB`);
console.log(`\nQuery performance (SQLite vs Memory Map):`);
console.log(`  findDeadExports:      SQLite=${deadMs}ms      Memory=${memDeadMs}ms`);
console.log(`  getImpactRadius d=2:  SQLite=${impactD2Ms}ms       Memory=${memImpactD2Ms}ms`);
console.log(`  getImpactRadius d=5:  SQLite=${impactD5Ms}ms       Memory=${memImpactD5Ms}ms`);
console.log(`  cycle detection:      SQLite=${cycleMs}ms`);
console.log(`  random 100× d=2:      SQLite=${randomMs}ms (avg ${(randomMs / 100).toFixed(2)}ms/query)`);
console.log(`  batch incremental:    SQLite=${batchUpdateMs}ms`);

const allPass = impactD2Ms < 100 && impactD5Ms < 100 && randomMs < 1000 && cycleMs < 500;
console.log(`\n${allPass ? '✅ PASS' : '⚠️  NEEDS ATTENTION'}: All critical queries within thresholds (impact<100ms, cycle<500ms, random100<1000ms)`);

// 清理 JSON
fs.unlinkSync(jsonPath);
