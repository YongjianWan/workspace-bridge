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
    timeout: opts.timeout || 90000,
    env: opts.env || process.env,
  });
  assert.strictEqual(
    result.status,
    0,
    `CLI exited ${result.status}\nstderr: ${result.stderr || ''}\nstdout: ${result.stdout || ''}`.slice(0, 800)
  );
  let stdout = result.stdout;
  if (stdout && stdout.startsWith('\ufeff')) {
    stdout = stdout.slice(1);
  }
  try {
    return JSON.parse(stdout);
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
    env: opts.env || process.env,
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
    env: opts.env || process.env,
    maxBuffer: opts.maxBuffer,
  });
}

/* -------------------------------------------------------------------------- */
// In-process CLI runners (share ServiceContainer across calls)
/* -------------------------------------------------------------------------- */

let _sharedContainer = null;
let _sharedContainerPromise = null;

async function _getSharedContainer(cacheDir) {
  if (_sharedContainer) return _sharedContainer;
  if (_sharedContainerPromise) return _sharedContainerPromise;

  const { ServiceContainer } = require('../src/services/container');
  const { TIMEOUTS } = require('../src/config/constants');

  _sharedContainerPromise = (async () => {
    const container = new ServiceContainer({ quiet: true, cacheDir });
    await container.initialize(REPO_ROOT, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: false,
    });
    _sharedContainer = container;
    return container;
  })();

  return _sharedContainerPromise;
}

/**
 * Run CLI in-process with a shared ServiceContainer.
 * Much faster than spawn-based runners for consecutive calls.
 *
 * @param {string[]} args
 * @param {{cacheDir?: string}} [opts]
 * @returns {Promise<string>}
 */
async function runCliTextInProcess(args, opts = {}) {
  const { runCliInProcess } = require('../cli');
  const injected = _injectCacheDir(args);
  const cacheDir =
    opts.cacheDir ||
    (injected.includes('--cache-dir') ? injected[injected.indexOf('--cache-dir') + 1] : null);
  const container = await _getSharedContainer(cacheDir);
  const result = await runCliInProcess(injected, { container });
  assert.strictEqual(
    result.status,
    0,
    `CLI in-process exited ${result.status}\nstdout: ${result.stdout?.slice(0, 400)}\nstderr: ${result.stderr?.slice(0, 400)}`
  );
  return result.stdout;
}

/**
 * Shut down the shared ServiceContainer used by in-process runners.
 * Call after all in-process tests finish.
 */
function shutdownSharedContainer() {
  if (_sharedContainer) {
    _sharedContainer.shutdown().catch(() => {});
    _sharedContainer = null;
    _sharedContainerPromise = null;
  }
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

  const defaultStubs = _createStubDepGraph({
    root,
    graph: graphMap,
    reverseGraph: reverseGraphMap,
    entryFiles: entryFilesSet,
    projectContext: opts.projectContext,
    overrides: opts.depGraphOverrides || {},
  });

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
// Shared stub factory — eliminates 20+ hand-written method declarations
/* -------------------------------------------------------------------------- */

/**
 * Build a Proxy-backed mock that satisfies the DependencyGraphView interface.
 *
 * Only methods with non-trivial defaults are listed in semanticDefaults;
 * everything else falls through to a safe no-op (() => []), so future
 * additions to DependencyGraphView do not require manual stub updates.
 */
function _createStubDepGraph(opts = {}) {
  const root = opts.root || '/repo';
  const graphMap = opts.graph || new Map();
  const reverseGraph = opts.reverseGraph || new Map();
  const entryFiles = opts.entryFiles || new Set();
  const overrides = opts.overrides || {};

  const projectContext = opts.projectContext || {
    classifyFile: () => ({ fileRole: 'library', directoryRole: 'active', isMainline: true }),
    summarizeFiles: () => ({
      counts: { totalFiles: graphMap.size, mainlineFiles: graphMap.size, nonMainlineFiles: 0, testFiles: 0 },
      directoryRoles: { active: graphMap.size, reference: 0, archive: 0, generated: 0 },
      fileRoles: { entry: 0, library: graphMap.size, config: 0, test: 0, migration: 0, script: 0, docs: 0, style: 0, asset: 0, unknown: 0 },
      entryFiles: [],
    }),
  };

  const baseData = {
    root,
    graph: graphMap,
    reverseGraph,
    entryFiles,
    projectContext,
    packageJson: opts.packageJson || null,
    excludeDirs: [],
    cliExcludeDirs: [],
  };

  const semanticDefaults = new Map([
    ['getFileInfo', (file) => graphMap.get(file)],
    ['hasFile', (file) => graphMap.has(file)],
    ['getDependents', (file) => reverseGraph.get(file) || []],
    ['getDependencies', (file) => graphMap.get(file)?.imports || []],
    ['getFileCount', () => graphMap.size],
    ['getAllFilePaths', () => Array.from(graphMap.keys())],
    ['getAllFileValues', () => Array.from(graphMap.values())],
    ['getAllFileInfos', () => Array.from(graphMap.entries())],
    ['isTestLikeFile', () => false],
    ['isKnownEntryFile', () => false],
    ['findDeadExports', () => opts.deadExports || []],
    ['findUnresolvedImports', () => opts.unresolved || []],
    ['findCircularDependencies', () => opts.cycles || []],
    ['getStats', () => ({
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
    })],
    ['getPageRank', () => new Map()],
    ['getScopeSummary', () => ({})],
    ['buildWarnings', () => []],
    ['_displayPath', (p) => p],
    ['normalizeFilePath', (p) => p],
    ['shouldExclude', () => false],
    ['shouldExcludeCli', () => false],
    ['getFrameworkHint', () => null],
    ['getSymbolImpact', () => null],
    ['getChangedFunctionImpact', () => null],
    ['getFunctionReuseHints', () => []],
    ['getFunctionLevelAffectedTests', () => []],
    ['getImpactRadius', () => []],
    ['findAffectedTests', () => []],
    ['_scanSymbolUsageInImporters', () => new Set()],
  ]);

  return new Proxy(baseData, {
    get(target, prop) {
      if (prop in overrides) {
        return overrides[prop];
      }
      if (semanticDefaults.has(prop)) {
        return semanticDefaults.get(prop);
      }
      if (prop in target) {
        return target[prop];
      }
      // Safe fallback for any unknown callable property
      if (typeof prop === 'string' && !prop.startsWith('_') && !prop.startsWith('Symbol(')) {
        return () => [];
      }
      return target[prop];
    },
  });
}

/* -------------------------------------------------------------------------- */
// Mock graph factory (enhanced)
/* -------------------------------------------------------------------------- */

const { DependencyGraph } = require('../src/services/dep-graph');

/**
 * Create a mock DependencyGraph — either a real instance with injected data
 * or a lightweight plain-object stub.
 *
 * @param {{
 *   root?: string,
 *   mode?: 'instance' | 'stub',
 *   schema?: Record<string, Partial<import('../src/services/dep-graph').FileNode>>,
 *   entryFiles?: Set<string>,
 *   projectContext?: object,
 *   deadExports?: any[],
 *   unresolved?: any[],
 *   cycles?: any[],
 *   overrides?: Record<string, any>,
 *   depGraphOptions?: object,
 * }} [opts]
 * @returns {DependencyGraph | object}
 */
function createMockDepGraph(opts = {}) {
  const root = opts.root || '/repo';
  const mode = opts.mode || 'instance';

  const graphMap = opts.schema ? buildMockDepGraph(opts.schema) : new Map();

  // Auto-build reverseGraph from imports
  const reverseGraph = new Map();
  for (const [file, node] of graphMap) {
    if (!reverseGraph.has(file)) reverseGraph.set(file, []);
    for (const imp of node.imports || []) {
      if (!reverseGraph.has(imp)) reverseGraph.set(imp, []);
      reverseGraph.get(imp).push(file);
    }
  }

  if (mode === 'stub') {
    return _createStubDepGraph({
      root,
      graph: graphMap,
      reverseGraph,
      entryFiles: opts.entryFiles,
      projectContext: opts.projectContext,
      overrides: opts.overrides,
      deadExports: opts.deadExports,
      unresolved: opts.unresolved,
      cycles: opts.cycles,
    });
  }

  const depGraph = DependencyGraph.fromSchema(
    root,
    opts.schema || {},
    {
      quiet: true,
      entryFiles: opts.entryFiles || new Set(),
      projectContext: opts.projectContext || null,
      ...opts.depGraphOptions,
    }
  );

  return depGraph;
}

/**
 * Standard graph fixtures for tests.
 */
const GraphFixtures = {
  /**
   * Empty graph with no files.
   */
  empty(root = '/repo', mode = 'instance') {
    return createMockDepGraph({ root, mode, schema: {} });
  },

  /**
   * Linear chain: f0 -> f1 -> ... -> f{n-1} (import direction: fn imports fn-1)
   */
  chain(root = '/repo', n = 5, mode = 'instance') {
    const schema = {};
    for (let i = 0; i < n; i++) {
      const file = `${root}/src/f${i}.js`;
      const imports = i > 0 ? [`${root}/src/f${i - 1}.js`] : [];
      const importRecords = imports.length
        ? [{ source: `./f${i - 1}`, resolved: imports[0], imported: [`f${i - 1}`], usesAllExports: false }]
        : [];
      schema[file] = {
        imports,
        exports: [`f${i}`],
        exportRecords: [{ name: `f${i}`, kind: 'function' }],
        importRecords,
        parseMode: 'ast',
      };
    }
    return createMockDepGraph({ root, mode, schema });
  },

  /**
   * Cycle: each file imports the next, last imports first.
   */
  cycle(root = '/repo', files = ['a.js', 'b.js', 'c.js'], mode = 'instance') {
    const schema = {};
    for (let i = 0; i < files.length; i++) {
      const file = `${root}/src/${files[i]}`;
      const nextFile = `${root}/src/${files[(i + 1) % files.length]}`;
      schema[file] = {
        imports: [nextFile],
        exports: [],
        exportRecords: [],
        importRecords: [{ source: `./${files[(i + 1) % files.length]}`, resolved: nextFile, imported: [], usesAllExports: false }],
        parseMode: 'ast',
      };
    }
    return createMockDepGraph({ root, mode, schema });
  },

  /**
   * Star: one center file imported by many leaves.
   */
  star(root = '/repo', center = 'core.js', leaves = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'], mode = 'instance') {
    const centerPath = `${root}/src/${center}`;
    const schema = {
      [centerPath]: {
        imports: [],
        exports: ['core'],
        exportRecords: [{ name: 'core', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      },
    };
    for (const leaf of leaves) {
      const leafPath = `${root}/src/${leaf}`;
      schema[leafPath] = {
        imports: [centerPath],
        exports: [],
        exportRecords: [],
        importRecords: [{ source: `./${center}`, resolved: centerPath, imported: ['core'], usesAllExports: false }],
        parseMode: 'ast',
      };
    }
    return createMockDepGraph({ root, mode, schema });
  },

  /**
   * Large graph with N disconnected files (useful for scale assertions).
   */
  large(root = '/repo', n = 1000, mode = 'instance') {
    const schema = {};
    for (let i = 0; i < n; i++) {
      schema[`${root}/src/file${i}.js`] = {
        imports: [],
        exports: [],
        exportRecords: [],
        importRecords: [],
        parseMode: 'ast',
      };
    }
    return createMockDepGraph({ root, mode, schema });
  },

  /**
   * Small realistic project: entry + lib + util + test.
   */
  miniProject(root = '/repo', mode = 'instance') {
    const schema = {
      [`${root}/src/index.js`]: {
        imports: [`${root}/src/lib.js`],
        exports: ['main'],
        exportRecords: [{ name: 'main', kind: 'function' }],
        importRecords: [{ source: './lib', resolved: `${root}/src/lib.js`, imported: ['helper'], usesAllExports: false }],
        parseMode: 'ast',
      },
      [`${root}/src/lib.js`]: {
        imports: [`${root}/src/util.js`],
        exports: ['helper'],
        exportRecords: [{ name: 'helper', kind: 'function' }],
        importRecords: [{ source: './util', resolved: `${root}/src/util.js`, imported: ['utilFn'], usesAllExports: false }],
        parseMode: 'ast',
      },
      [`${root}/src/util.js`]: {
        imports: [],
        exports: ['utilFn'],
        exportRecords: [{ name: 'utilFn', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      },
      [`${root}/test/index.test.js`]: {
        imports: [`${root}/src/index.js`],
        exports: [],
        exportRecords: [],
        importRecords: [{ source: '../src/index', resolved: `${root}/src/index.js`, imported: ['main'], usesAllExports: false }],
        parseMode: 'ast',
      },
    };
    return createMockDepGraph({
      root,
      mode,
      schema,
      entryFiles: new Set([`${root}/src/index.js`]),
    });
  },
};

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
  runCliTextInProcess,
  shutdownSharedContainer,
  runInDir,
  makeTempDir,
  cleanupTempDir,
  buildMockDepGraph,
  createMockDepGraph,
  GraphFixtures,
  makeMockSnapshot,
  assertOk,
  assertAll,
};
