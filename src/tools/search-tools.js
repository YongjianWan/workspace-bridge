/**
 * Search tools for workspace-bridge
 */
const fs = require('fs');
const path = require('path');
const { findWorkspaceRoot } = require('../utils/path');

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'dist', 'build',
  '__pycache__', '.cache', '.next', 'target', 'out', '.turbo',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.pyc', '.pyo', '.class',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.db', '.sqlite', '.sqlite3',
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchGlob(filename, pattern) {
  const regex = new RegExp(
    `^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    'i',
  );
  return regex.test(filename);
}

function findFilesByName(query, root, maxResults) {
  const results = [];
  const lower = query.toLowerCase();

  function walk(dir, depth) {
    if (depth > 12 || results.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().includes(lower)) {
        results.push({ file: path.relative(root, fullPath) });
      }
    }
  }

  walk(root, 0);
  return results;
}

function searchCode(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const query = args?.query;
  const type = args?.type || 'text';
  const maxResults = Number.isFinite(args?.maxResults) ? Math.min(args.maxResults, 200) : 50;
  const glob = args?.glob || null;

  if (!query) return { ok: false, error: 'query parameter is required' };

  if (type === 'file') {
    const results = findFilesByName(query, root, maxResults);
    return { ok: true, workspaceRoot: root, type, query, matchCount: results.length, results };
  }

  let pattern;
  if (type === 'symbol') {
    const prefixAlt = [
      'def\\s+', 'class\\s+', 'async\\s+function\\s+', 'function\\s+',
      'const\\s+', 'let\\s+', 'var\\s+', 'interface\\s+', 'type\\s+',
      'export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s+|class\\s+|const\\s+|let\\s+|var\\s+)?',
    ].join('|');
    const methodShorthand = `(?:^|\\n)\\s*(?:async\\s+)?${escapeRegex(query)}\\s*\\(`;
    pattern = new RegExp(`(?:${prefixAlt})${escapeRegex(query)}\\b|${methodShorthand}`, 'im');
  } else {
    pattern = new RegExp(escapeRegex(query), 'i');
  }

  const matches = [];

  function walk(dir, depth) {
    if (depth > 12 || matches.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= maxResults) break;
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
        if (glob && !matchGlob(entry.name, glob)) continue;
        let content;
        try {
          if (fs.statSync(fullPath).size > 1024 * 1024) continue;
          content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          if (pattern.test(lines[i])) {
            matches.push({
              file: path.relative(root, fullPath),
              line: i + 1,
              content: lines[i].trim().slice(0, 200),
            });
          }
        }
      }
    }
  }

  walk(root, 0);

  return {
    ok: true,
    workspaceRoot: root,
    type,
    query,
    matchCount: matches.length,
    truncated: matches.length >= maxResults,
    results: matches,
  };
}

module.exports = {
  searchCode,
  EXCLUDE_DIRS,
  BINARY_EXTS,
};
