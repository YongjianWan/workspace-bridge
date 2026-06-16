// @contract — EntryDetector extracted from dep-graph.js: cache, entry detection, framework hint
const assert = require('assert');
const path = require('path');
const { EntryDetector, readScanContent } = require('../src/services/dep-graph/entry-detector');
const { EventBus } = require('../src/utils/event-bus');

function testCacheHit() {
  const detector = new EntryDetector({
    entryFiles: new Set(['/repo/src/main.js']),
    normalizeFilePath: (p) => p,
  });
  assert.strictEqual(detector.isKnownEntryFile('/repo/src/main.js'), true);
  // Second call should hit cache and return same result
  assert.strictEqual(detector.isKnownEntryFile('/repo/src/main.js'), true);
}

function testFrameworkManagedPattern() {
  const detector = new EntryDetector({ normalizeFilePath: (p) => p });
  // Django manage.py is a framework-managed entry
  assert.strictEqual(detector.isKnownEntryFile('/repo/manage.py'), true);
  // Random util file is not
  assert.strictEqual(detector.isKnownEntryFile('/repo/src/utils/helper.js'), false);
}

function testKnownConfigName() {
  const detector = new EntryDetector({ normalizeFilePath: (p) => p });
  assert.strictEqual(detector.isKnownEntryFile('/repo/vite.config.js'), true);
  assert.strictEqual(detector.isKnownEntryFile('/repo/vite.config.ts'), true);
}

function testCacheInvalidationViaBus() {
  const bus = new EventBus();
  const detector = new EntryDetector({
    entryFiles: new Set(),
    normalizeFilePath: (p) => p,
    bus,
  });

  detector.isKnownEntryFile('/repo/src/a.js'); // populate cache with false
  assert.strictEqual(detector._cache.size, 1);

  bus.emit('graph:updated', { fullRebuild: true });
  assert.strictEqual(detector._cache.size, 0, 'cache should be cleared on graph:updated');
}

function testCacheInvalidationManual() {
  const bus = new EventBus();
  const detector = new EntryDetector({
    entryFiles: new Set(),
    normalizeFilePath: (p) => p,
  });

  detector.isKnownEntryFile('/repo/src/b.js');
  assert.strictEqual(detector._cache.size, 1);

  detector.registerCacheInvalidation(bus);
  bus.emit('graph:updated', { fullRebuild: true });
  assert.strictEqual(detector._cache.size, 0);
}

function testGetFrameworkHintPathBased() {
  const detector = new EntryDetector({ normalizeFilePath: (p) => p });
  const hint = detector.getFrameworkHint('/repo/app/page.tsx');
  assert(hint, 'should detect Next.js app page');
  assert.strictEqual(hint.framework, 'nextjs-app');
  assert.strictEqual(hint.isEntry, true);
}

function testGetFrameworkHintNonEntry() {
  const detector = new EntryDetector({ normalizeFilePath: (p) => p });
  const hint = detector.getFrameworkHint('/repo/src/utils/helper.js');
  assert.strictEqual(hint, null, 'plain util file should have no framework hint');
}

function testReadScanContentMissingFile() {
  const content = readScanContent('/nonexistent/file.js');
  assert.strictEqual(content, null);
}

function testIsKnownEntryFileNormalizesRawPath() {
  // Regression: isKnownEntryFile normalized filePath to key but then checked
  // entryFiles.has(filePath) with the raw argument, so a Windows-style path
  // failed to match a normalized entry set entry.
  const detector = new EntryDetector({
    entryFiles: new Set(['C:/repo/src/worker.js']),
    normalizeFilePath: (p) => p.replace(/\\/g, '/'),
  });
  assert.strictEqual(
    detector.isKnownEntryFile('C:\\repo\\src\\worker.js'),
    true,
    'Windows-style raw path should match normalized entry set entry'
  );
}

function testEntryDetectorCacheHitAndFallback() {
  const mockGraph = new Map([
    ['/repo/src/cached-express.js', { frameworkHint: { framework: 'express', reason: 'express-route', isEntry: true } }],
    ['/repo/src/cached-none.js', { frameworkHint: null }],
  ]);
  const getFileInfo = (p) => mockGraph.get(p) || null;

  const detectorWithCache = new EntryDetector({
    normalizeFilePath: (p) => p,
    getFileInfo,
  });

  assert.strictEqual(detectorWithCache.isKnownEntryFile('/repo/src/cached-express.js'), true, 'should hit cache for entry');

  const hint = detectorWithCache.getFrameworkHint('/repo/src/cached-express.js');
  assert.deepStrictEqual(hint, { framework: 'express', reason: 'express-route', isEntry: true }, 'should get cached hint');

  const detectorFallback = new EntryDetector({
    normalizeFilePath: (p) => p,
    getFileInfo: () => null,
  });
  const pathHint = detectorFallback.getFrameworkHint('/repo/app/page.tsx');
  assert.strictEqual(pathHint?.framework, 'nextjs-app', 'should fall back to path-based detection');
}

async function main() {
  testCacheHit();
  testFrameworkManagedPattern();
  testKnownConfigName();
  testCacheInvalidationViaBus();
  testCacheInvalidationManual();
  testGetFrameworkHintPathBased();
  testGetFrameworkHintNonEntry();
  testReadScanContentMissingFile();
  testEntryDetectorCacheHitAndFallback();
  testIsKnownEntryFileNormalizesRawPath();
}

main();
