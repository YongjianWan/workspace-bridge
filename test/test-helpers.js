#!/usr/bin/env node
/**
 * Unified test helpers for workspace-bridge.
 * Extracted to eliminate copy-paste across 110 test files.
 *
 * Design constraints:
 * - Zero top-level side effects (safe to require without running tests)
 * - No external dependencies beyond Node built-ins
 * - Works with both spawnSync CLI tests and in-process unit tests
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli.js');

/* -------------------------------------------------------------------------- */
// CLI runners
/* -------------------------------------------------------------------------- */

/**
 * Run the workspace-bridge CLI and return parsed JSON.
 * Asserts exit code 0 and valid JSON.
 *
 * @param {string[]} args
 * @param {{cwd?: string, timeout?: number}} [opts]
 * @returns {any}
 */
function _injectCacheDir(args) {
  const cacheDir = process.env.WB_TEST_CACHE_DIR;
  if (!cacheDir || args.includes('--cache-dir')) {
    return args;
  }
  // Per-project sub-cache to prevent cross-project contamination
  // when a single test spawns CLI against multiple --cwd values.
  const cwdIdx = args.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? args[cwdIdx + 1] : REPO_ROOT;
  const hash = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 8);
  const subCacheDir = path.join(cacheDir, hash);
  fs.mkdirSync(subCacheDir, { recursive: true });
  return ['--cache-dir', subCacheDir, ...args];
}

function runCli(args, opts = {}) {
  const result = spawnSync('node', [CLI_PATH, ..._injectCacheDir(args)], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
  });
  assert.strictEqual(
    result.status,
    0,
    `CLI exited ${result.status}\nstderr: ${result.stderr || ''}\nstdout: ${result.stdout || ''}`.slice(0, 800)
  );
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`Failed to parse CLI stdout as JSON:\n${result.stdout?.slice(0, 500)}\n${e.message}`);
  }
}

/**
 * Run the workspace-bridge CLI and return raw stdout text.
 * Asserts exit code 0.
 *
 * @param {string[]} args
 * @param {{cwd?: string, timeout?: number}} [opts]
 * @returns {string}
 */
function runCliText(args, opts = {}) {
  const result = spawnSync('node', [CLI_PATH, ..._injectCacheDir(args)], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
  });
  assert.strictEqual(
    result.status,
    0,
    `CLI exited ${result.status}\nstderr: ${result.stderr || ''}\nstdout: ${result.stdout || ''}`.slice(0, 800)
  );
  return result.stdout;
}

/**
 * Run the workspace-bridge CLI and return the full spawnSync result.
 * Does NOT assert status — useful for testing error paths.
 *
 * @param {string[]} args
 * @param {{cwd?: string, timeout?: number}} [opts]
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function runCliRaw(args, opts = {}) {
  return spawnSync('node', [CLI_PATH, ..._injectCacheDir(args)], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    maxBuffer: opts.maxBuffer,
  });
}

/**
 * Run an arbitrary command and return stdout.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function runInDir(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(
    result.status,
    0,
    `Command "${command} ${args.join(' ')}" exited ${result.status}\nstderr: ${result.stderr || ''}`.slice(0, 800)
  );
  return result.stdout;
}

/* -------------------------------------------------------------------------- */
// Temporary directory helpers
/* -------------------------------------------------------------------------- */

/**
 * Create a unique temporary directory under os.tmpdir().
 *
 * @param {string} [prefix='wb-test-']
 * @returns {string}
 */
function makeTempDir(prefix = 'wb-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Recursively delete a directory, swallowing errors.
 *
 * @param {string} dir
 */
function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/* -------------------------------------------------------------------------- */
// WorkspaceSnapshot mock factory
/* -------------------------------------------------------------------------- */

const { WorkspaceSnapshot, DependencyGraphView } = require('../src/models/workspace-snapshot');

/**
 * Build a mock WorkspaceSnapshot for unit tests.
 *
 * Provides two usage modes:
 * 1. Declarative — pass `graph` (Map), `reverseGraph` (Map), `entryFiles` (Set)
 *    and optional `depGraphOverrides` to tweak specific methods.
 * 2. Direct — pass `mockDepGraph` as a full plain-object stub and skip all defaults.
 *
 * @param {{
 *   root?: string,
 *   graph?: Map<string, any>,
 *   reverseGraph?: Map<string, string[]>,
 *   entryFiles?: Set<string>,
 *   files?: Array<{path: string, mtime?: number, size?: number, hash?: string, symbols?: string[], lineCount?: number}>,
 *   projectContext?: object,
 *   packageJson?: object|null,
 *   gitStatus?: {head?: string|null},
 *   frameworkHints?: Map<string, any>,
 *   knownBlindSpots?: string[],
 *   confidenceByDomain?: Map<string, {level: string, reason: string}>,
 *   depGraphOverrides?: Record<string, any>,
 *   mockDepGraph?: object,
 * }} [opts]
 * @returns {WorkspaceSnapshot}
 */
function makeMockSnapshot(opts = {}) {
  const root = opts.root || '/mock';
  const graphMap = opts.graph || new Map();
  const reverseGraphMap = opts.reverseGraph || new Map();
  const entryFilesSet = opts.entryFiles || new Set();

  const defaultStubs = {
    root,
    graph: graphMap,
    reverseGraph: reverseGraphMap,
    entryFiles: entryFilesSet,
    projectContext: opts.projectContext || {
      classifyFile: () => ({ fileRole: 'library', directoryRole: 'active', isMainline: true }),
      summarizeFiles: () => ({
        counts: { totalFiles: graphMap.size, mainlineFiles: graphMap.size, nonMainlineFiles: 0, testFiles: 0 },
        directoryRoles: { active: graphMap.size, reference: 0, archive: 0, generated: 0 },
        fileRoles: { entry: 0, library: graphMap.size, config: 0, test: 0, migration: 0, script: 0, docs: 0, style: 0, asset: 0, unknown: 0 },
        entryFiles: [],
      }),
    },
    packageJson: opts.packageJson || null,
    excludeDirs: [],
    cliExcludeDirs: [],
    hasFile: (p) => graphMap.has(p),
    getFileInfo: (p) => graphMap.get(p),
    getAllFileInfos: () => Array.from(graphMap.entries()),
    normalizeFilePath: (p) => p,
    _displayPath: (p) => p,
    shouldExclude: () => false,
    shouldExcludeCli: () => false,
    isTestLikeFile: () => false,
    isKnownEntryFile: () => false,
    getFrameworkHint: () => null,
    getSymbolImpact: () => null,
    getChangedFunctionImpact: () => null,
    getFunctionReuseHints: () => [],
    getFunctionLevelAffectedTests: () => [],
    getDependencies: () => [],
    getDependents: () => [],
    getImpactRadius: () => [],
    findDeadExports: () => [],
    findCircularDependencies: () => [],
    findUnresolvedImports: () => [],
    findAffectedTests: () => [],
    getStats: () => ({
      files: graphMap.size,
      totalImports: 0,
      totalExports: 0,
      cycles: 0,
      totalLines: 0,
      analysisCoverage: {
        totalFiles: graphMap.size,
        parsedFiles: graphMap.size,
        fallbackFiles: 0,
        coverageRatio: 1,
      },
      filteredAnalysisCoverage: {
        totalFiles: graphMap.size,
        parsedFiles: graphMap.size,
        fallbackFiles: 0,
        coverageRatio: 1,
      },
    }),
    getPageRank: () => new Map(),
    getScopeSummary: () => ({}),
    buildWarnings: () => [],
    _scanSymbolUsageInImporters: () => new Set(),
    ...opts.depGraphOverrides,
  };

  const mockDg = opts.mockDepGraph || defaultStubs;
  const view = new DependencyGraphView(mockDg);

  return new WorkspaceSnapshot({
    workspaceRoot: root,
    files: opts.files || [],
    graph: view,
    gitStatus: opts.gitStatus || { head: 'abc123' },
    frameworkHints: opts.frameworkHints || new Map(),
    projectContext: mockDg.projectContext,
    fileIndexVersion: opts.fileIndexVersion || 1,
    cacheStaleness: opts.cacheStaleness || { isStale: false },
    gitHead: opts.gitHead || 'abc123',
    knownBlindSpots: opts.knownBlindSpots || [],
    confidenceByDomain: opts.confidenceByDomain || new Map(),
  });
}

/* -------------------------------------------------------------------------- */
// Mock graph factory (legacy — prefer makeMockSnapshot for new tests)
/* -------------------------------------------------------------------------- */

/**
 * Build a mock DependencyGraph internal structure from a concise schema.
 *
 * Schema:
 *   {
 *     '/repo/src/a.js': {
 *       imports: ['b.js'],
 *       exports: ['foo', 'bar'],
 *       importRecords: [{ source: './b', resolved: 'b.js', imported: ['foo'], usesAllExports: false }],
 *       exportRecords: [{ name: 'foo', kind: 'function', lineStart: 1, lineEnd: 3, fingerprint: 'abc' }],
 *       functionRecords: [{ name: 'foo', kind: 'function', lineStart: 1, lineEnd: 3, fingerprint: 'abc' }],
 *     }
 *   }
 *
 * Missing fields are filled with sensible defaults.
 *
 * @param {Record<string, Partial<import('../src/services/dep-graph').FileNode>>} schema
 * @returns {Map<string, import('../src/services/dep-graph').FileNode>}
 */
function buildMockDepGraph(schema) {
  const map = new Map();
  for (const [file, partial] of Object.entries(schema)) {
    map.set(file, {
      imports: partial.imports || [],
      exports: partial.exports || [],
      importRecords: partial.importRecords || [],
      exportRecords: partial.exportRecords || [],
      functionRecords: partial.functionRecords || [],
      parseMode: partial.parseMode || 'ast',
      ...(partial.parseModeReason ? { parseModeReason: partial.parseModeReason } : {}),
      ...partial,
    });
  }
  return map;
}

/* -------------------------------------------------------------------------- */
// Assertion helpers
/* -------------------------------------------------------------------------- */

/**
 * Assert that a CLI result object represents success (status === 0).
 *
 * @param {import('child_process').SpawnSyncReturns<string>} result
 * @param {string} [msg]
 */
function assertOk(result, msg) {
  assert.strictEqual(
    result.status,
    0,
    (msg ? `${msg}\n` : '') +
      `exit=${result.status} stderr=${result.stderr || ''}\nstdout=${result.stdout || ''}`.slice(0, 800)
  );
}

/**
 * Assert that an array has at least one element and every element
 * satisfies the given predicate.
 *
 * @param {any[]} arr
 * @param {(item: any) => boolean} predicate
 * @param {string} [msg]
 */
function assertAll(arr, predicate, msg) {
  assert(Array.isArray(arr) && arr.length > 0, msg || 'expected non-empty array');
  for (let i = 0; i < arr.length; i += 1) {
    assert(predicate(arr[i]), `${msg || 'assertAll'} failed at index ${i}: ${JSON.stringify(arr[i])}`);
  }
}

/* -------------------------------------------------------------------------- */
// Exports
/* -------------------------------------------------------------------------- */

module.exports = {
  REPO_ROOT,
  CLI_PATH,
  runCli,
  runCliText,
  runCliRaw,
  runInDir,
  makeTempDir,
  cleanupTempDir,
  buildMockDepGraph,
  makeMockSnapshot,
  assertOk,
  assertAll,
};
