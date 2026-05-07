/**
 * Search tools for workspace-bridge - SECURE VERSION
 * ReDoS protected: query length limit + dangerous pattern detection
 */
const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../config/constants');
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

// Security limits
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 200;
const MAX_DEPTH = 12;
const MAX_FILE_SIZE = LIMITS.SEARCH_MAX_FILE_BYTES;

/**
 * Escape regex special characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if query contains ReDoS vulnerable patterns
 * Blocks: nested quantifiers, excessive repetition, etc.
 */
function containsReDoSPattern(query) {
  // Dangerous patterns that can cause catastrophic backtracking
  const dangerousPatterns = [
    new RegExp('\\([^()]*[+*][^()]*\\)[+*]'), // (a+)+, (a*)*, (a+)*, (a*)+
    /\+\+/, // ++
    /\*\+/, // *+
    /\+\*/, // +*
    /\{\d+,\d+\}\+/, // {n,m}+
    /\[.*\]\+.*\[.*\]\+/, // [a]+[b]+
  ];
  return dangerousPatterns.some(p => p.test(query));
}

/**
 * Validate search query for security
 */
function validateQuery(query) {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'query is required' };
  }
  
  if (query.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `query too long (max ${MAX_QUERY_LENGTH} chars)` };
  }
  
  if (containsReDoSPattern(query)) {
    return { valid: false, error: 'query contains potentially dangerous pattern' };
  }
  
  return { valid: true };
}

function matchGlob(filename, pattern) {
  const regex = new RegExp(
    `^${escapeRegex(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`,
    'i',
  );
  return regex.test(filename);
}

function findFilesByName(query, root, maxResults) {
  const results = [];
  const lower = query.toLowerCase();

  function walk(dir, depth) {
    if (depth > MAX_DEPTH || results.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // Directory read failed (permissions or not a directory), skip
      if (process.env.DEBUG) {
        console.error(`[Search] Cannot read directory ${dir}: ${e.message}`);
      }
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
  const maxResults = Number.isFinite(args?.maxResults) ? Math.min(args.maxResults, MAX_RESULTS) : 50;
  const glob = args?.glob || null;

  // Validate query for ReDoS protection
  const validation = validateQuery(query);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  if (type === 'file') {
    const results = findFilesByName(query, root, maxResults);
    return { ok: true, workspaceRoot: root, type, query, matchCount: results.length, results };
  }

  let pattern;
  try {
    if (type === 'symbol') {
      const prefixAlt = [
        'def\\s+', 'class\\s+', 'async\\s+function\\s+', 'function\\s+',
        'const\\s+', 'let\\s+', 'var\\s+', 'interface\\s+', 'type\\s+',
        'export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s+|class\\s+|const\\s+|let\\s+|var\\s+)?',
      ].join('|');
      const escapedQuery = escapeRegex(query);
      const methodShorthand = `(?:^|\\n)\\s*(?:async\\s+)?${escapedQuery}\\s*\\(`;
      pattern = new RegExp(`(?:${prefixAlt})${escapedQuery}\\b|${methodShorthand}`, 'im');
    } else {
      pattern = new RegExp(escapeRegex(query), 'i');
    }
  } catch (e) {
    return { ok: false, error: 'Invalid regex pattern: ' + e.message };
  }

  const matches = [];

  function walk(dir, depth) {
    if (depth > MAX_DEPTH || matches.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // Directory read failed (permissions or not a directory), skip
      if (process.env.DEBUG) {
        console.error(`[Search] Cannot read directory ${dir}: ${e.message}`);
      }
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
          const stats = fs.statSync(fullPath);
          if (stats.size > MAX_FILE_SIZE) continue;
          content = fs.readFileSync(fullPath, 'utf8');
        } catch (e) {
          // File read failed (permissions, binary, or deleted), skip
          if (process.env.DEBUG) {
            console.error(`[Search] Cannot read file ${fullPath}: ${e.message}`);
          }
          continue;
        }
        const lines = content.split('\n');
        const lowerQuery = type === 'text' ? query.toLowerCase() : null;
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          let matched = false;
          const line = lines[i];
          if (type === 'text') {
            // Pure text search: use includes to eliminate any regex risk
            matched = line.toLowerCase().includes(lowerQuery);
          } else {
            // Symbol search: pattern is built from escaped user input via escapeRegex(),
            // so catastrophic backtracking is structurally impossible. Pre-check
            // with includes for both speed and defense in depth.
            if (line.toLowerCase().includes(lowerQuery)) {
              matched = pattern.test(line);
            }
          }
          if (matched) {
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
  validateQuery,  // Export for testing
  escapeRegex,    // Export for testing
};
