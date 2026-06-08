// @semantic — Test WorkspaceSnapshot properties, getters, self-awareness and helper functions
const assert = require('assert');
const {
  WorkspaceSnapshot,
  computeKnownBlindSpots,
  computeConfidenceByDomain,
  DependencyGraphView,
} = require('../src/models/workspace-snapshot');

function testConstructorAndBasicProperties() {
  const dummyGraph = { root: '/test-root' };
  const graphView = new DependencyGraphView(dummyGraph);
  const data = {
    workspaceRoot: '/test-root',
    graph: graphView,
    gitStatus: { head: 'commit-hash-abc' },
    frameworkHints: new Map([['/test-root/src/index.js', 'vue']]),
    projectContext: { mainlineFiles: new Set(['/test-root/src/index.js']) },
    fileIndexVersion: 12345678,
    cacheStaleness: { isStale: false },
    gitHead: 'commit-hash-abc',
    knownBlindSpots: ['test spot'],
    confidenceByDomain: new Map([['dead-exports', { level: 'high', reason: 'looks good' }]]),
  };

  const snapshot = new WorkspaceSnapshot(data);
  
  assert.strictEqual(snapshot.workspaceRoot, '/test-root');
  assert.strictEqual(snapshot.graph, graphView);
  assert.deepStrictEqual(snapshot.gitStatus, { head: 'commit-hash-abc' });
  assert.strictEqual(snapshot.frameworkHints.get('/test-root/src/index.js'), 'vue');
  assert.strictEqual(snapshot.projectContext.mainlineFiles.has('/test-root/src/index.js'), true);
  
  assert.strictEqual(snapshot.basedOn.fileIndexVersion, 12345678);
  assert.deepStrictEqual(snapshot.basedOn.cacheStaleness, { isStale: false });
  assert.strictEqual(snapshot.basedOn.gitHead, 'commit-hash-abc');
  assert.deepStrictEqual(snapshot.knownBlindSpots, ['test spot']);
  
  // Test confidenceByDomain retrieval
  const confidence = snapshot.getConfidence('dead-exports');
  assert.deepStrictEqual(confidence, { level: 'high', reason: 'looks good' });
  
  const defaultConfidence = snapshot.getConfidence('cycles');
  assert.strictEqual(defaultConfidence.level, 'medium');
  assert(defaultConfidence.reason.includes('default confidence'));

  // Test getSelfAwarenessSummary
  const summary = snapshot.getSelfAwarenessSummary();
  assert(summary.generatedAt > 0);
  assert.strictEqual(summary.basedOn.fileIndexVersion, 12345678);
  assert.deepStrictEqual(summary.knownBlindSpots, ['test spot']);
  assert.deepStrictEqual(summary.confidenceByDomain, {
    'dead-exports': { level: 'high', reason: 'looks good' }
  });
}

function testStaticAndLiveFiles() {
  // Test static files array fallback
  const staticFiles = [
    { path: '/test-root/src/a.js', size: 100 },
    { path: '/test-root/src/b.js', size: 200 },
  ];
  const snapshotStatic = new WorkspaceSnapshot({ files: staticFiles });
  assert.deepStrictEqual(snapshotStatic.files, staticFiles);

  // Test live files from fileIndex
  const mockFileMetadata = new Map([
    ['/test-root/src/a.js', { size: 100, mtime: 10 }],
    ['/test-root/src/b.js', { size: 200, mtime: 20 }],
  ]);
  const mockFileIndex = {
    cache: {
      fileMetadata: mockFileMetadata
    }
  };
  const snapshotLive = new WorkspaceSnapshot({ fileIndex: mockFileIndex });
  const liveFiles = snapshotLive.files;
  assert.strictEqual(liveFiles.length, 2);
  assert.deepStrictEqual(liveFiles.find(f => f.path === '/test-root/src/a.js'), {
    path: '/test-root/src/a.js',
    size: 100,
    mtime: 10
  });
}

function testComputeKnownBlindSpots() {
  const mockDepGraph = {
    getStats: () => ({ files: 2, totalImports: 0 }), // edge ratio = 0
    getAllFilePaths: () => ['src/a.js', 'src/b.js']
  };
  const blindSpots = computeKnownBlindSpots(null, mockDepGraph);
  assert(blindSpots.length > 2);
  assert(blindSpots.some(s => s.includes('sparse import graph')));

  // Test Java/Kotlin project
  const mockJavaDepGraph = {
    getStats: () => ({ files: 5, totalImports: 4 }), // edge ratio = 0.8
    getAllFilePaths: () => ['src/a.java', 'src/b.kt']
  };
  const javaBlindSpots = computeKnownBlindSpots(null, mockJavaDepGraph);
  assert(javaBlindSpots.some(s => s.includes('Java/Kotlin projects')));
}

function testComputeConfidenceByDomain() {
  const mockSparseGraph = {
    getStats: () => ({ files: 5, totalImports: 0 }),
    getAllFilePaths: () => ['src/a.js', 'src/b.js']
  };
  const confidenceSparse = computeConfidenceByDomain(null, mockSparseGraph);
  assert.strictEqual(confidenceSparse.get('dead-exports').level, 'low');
  assert.strictEqual(confidenceSparse.get('security').level, 'low');
  assert.strictEqual(confidenceSparse.get('cycles').level, 'high');

  const mockStandardGraph = {
    getStats: () => ({ files: 5, totalImports: 10 }),
    getAllFilePaths: () => ['src/a.js', 'src/b.js']
  };
  const confidenceStandard = computeConfidenceByDomain(null, mockStandardGraph);
  assert.strictEqual(confidenceStandard.get('dead-exports').level, 'high');
}

function main() {
  testConstructorAndBasicProperties();
  testStaticAndLiveFiles();
  testComputeKnownBlindSpots();
  testComputeConfidenceByDomain();
  console.log('WorkspaceSnapshot tests passed!');
}

main();
