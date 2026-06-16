#!/usr/bin/env node
// @semantic
// @slow
/**
 * Staleness detection unit tests.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function sha256(content) {
  return require('crypto').createHash('sha256').update(content).digest('hex');
}

function main() {

  const container = new ServiceContainer();

  // Before initialization
  {
    const s = container.getStaleness();
    assert.strictEqual(s.indexAgeMs, 0, 'age should be 0 before init');
    assert.strictEqual(s.isStale, false, 'should not be stale before init');
    assert.strictEqual(s.gitHeadChanged, false, 'should not report git head changed before init');
    assert.strictEqual(s.thresholdMs, 86400000, 'default threshold should be 24h');
    assert.strictEqual(s.thresholdDescription, '24 hours', 'should include human-readable threshold');
  }

  // Fresh index (1 second ago)
  {
    container.indexBuildTime = Date.now() - 1000;
    const s = container.getStaleness();
    assert(s.indexAgeMs >= 1000 && s.indexAgeMs < 5000, `age should be ~1000ms, got ${s.indexAgeMs}`);
    assert.strictEqual(s.isStale, false, 'should not be stale after 1s');
    assert.strictEqual(s.gitHeadChanged, false, 'git head should not be changed when no cache');
  }

  // Stale index (>24h)
  {
    container.indexBuildTime = Date.now() - 90000000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, 'should be stale after 25h');
  }

  // Git HEAD changed detection
  {
    container.indexBuildTime = Date.now() - 1000;
    // Mock cache with a mismatched git HEAD
    const mockCache = {
      getWorkspaceInfo() {
        return { gitHead: 'deadbeef00000000000000000000000000000000' };
      },
    };
    container.cache = mockCache;
    container.workspaceRoot = process.cwd();
    const s = container.getStaleness();
    assert.strictEqual(s.gitHeadChanged, true, 'should detect git head change');
    assert.strictEqual(s.isStale, true, 'isStale should be true when git head changed');
    // Clean up mock
    container.cache = null;
    container.workspaceRoot = null;
  }

  // Custom threshold
  {
    container.indexBuildTime = Date.now() - 5000;
    const s = container.getStaleness(3000);
    assert.strictEqual(s.isStale, true, 'should be stale with 3s threshold');
    assert.strictEqual(s.thresholdMs, 3000);
    assert.strictEqual(s.thresholdDescription, '3 seconds');
  }

  // Boundary: exactly at threshold
  {
    container.indexBuildTime = Date.now() - 86400000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, false, 'exactly at threshold should not be stale');
  }

  // Boundary: 1ms over threshold
  {
    container.indexBuildTime = Date.now() - 86400001;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, '1ms over threshold should be stale');
  }

  // Git HEAD unchanged detection
  {
    container.indexBuildTime = Date.now() - 1000;
    const { execSync } = require('child_process');
    let currentHead = null;
    try {
      currentHead = execSync('git rev-parse HEAD', { cwd: process.cwd(), encoding: 'utf8' }).trim();
    } catch {
      // skip if not in git repo
    }
    if (currentHead) {
      const mockCache = {
        getWorkspaceInfo() {
          return { gitHead: currentHead };
        },
      };
      container.cache = mockCache;
      container.workspaceRoot = process.cwd();
      const s = container.getStaleness();
      assert.strictEqual(s.gitHeadChanged, false, 'should not flag unchanged head');
      assert.strictEqual(s.isStale, false, 'should not be stale when head matches and age is fresh');
      container.cache = null;
      container.workspaceRoot = null;
    }
  }

  // File mtime mismatch → filesChanged
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'a.js');
    fs.writeFileSync(file, 'export const a = 1;\n');

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: 0, size: fs.statSync(file).size });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, true, 'should detect mtime mismatch');
    assert.strictEqual(s.isStale, true, 'isStale should be true when files changed');
    assert.ok(s.changedFiles.includes(file), 'changedFiles should include the modified file');

    cleanupTempDir(dir);
  }

  // File size mismatch → filesChanged
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'b.js');
    fs.writeFileSync(file, 'export const b = 1;\n');

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: fs.statSync(file).mtimeMs, size: 99999 });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, true, 'should detect size mismatch');
    assert.strictEqual(s.isStale, true, 'isStale should be true when size changed');

    cleanupTempDir(dir);
  }

  // File unchanged → filesChanged false
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'c.js');
    fs.writeFileSync(file, 'export const c = 1;\n');
    const stats = fs.statSync(file);

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, false, 'should not flag unchanged file');
    assert.strictEqual(s.isStale, false, 'should not be stale when file matches cache');
    assert.deepStrictEqual(s.changedFiles, [], 'changedFiles should be empty');

    cleanupTempDir(dir);
  }

  // Historical cache path drift → fall back to normalized key
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'path-drift.js');
    const content = 'export const drift = 1;\n';
    fs.writeFileSync(file, content);
    const stats = fs.statSync(file);

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.fileMetadata.set(file, {
      originalPath: path.join(dir, 'missing-old-path.js'),
      mtime: stats.mtimeMs,
      size: stats.size,
      hash: sha256(content),
    });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, false, 'should not flag unchanged file when originalPath drifted but key resolves');
    assert.strictEqual(cache.fileMetadata.get(file).originalPath, file, 'should repair originalPath to the resolved key path');

    cleanupTempDir(dir);
  }

  // Historical exact keys must be deletable even if normalizePathKey cannot
  // interpret their old platform shape in the current shell.
  {
    const dir = makeTempDir('wb-staleness-');
    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    const legacyKey = 'c:/legacy/workspace/src/old.js';
    cache.fileMetadata.set(legacyKey, { originalPath: 'C:\\legacy\\workspace\\src\\old.js' });
    cache.parseResults.set(legacyKey, { imports: [], exports: [] });
    cache.diagnostics.set(legacyKey, { diagnostics: [{ message: 'old' }] });

    cache.deleteFileMetadata(legacyKey);
    cache.deleteParseResult(legacyKey);
    cache.clearDiagnostics(legacyKey);

    assert.strictEqual(cache.fileMetadata.has(legacyKey), false, 'deleteFileMetadata should remove exact legacy keys');
    assert.strictEqual(cache.parseResults.has(legacyKey), false, 'deleteParseResult should remove exact legacy keys');
    assert.strictEqual(cache.diagnostics.has(legacyKey), false, 'clearDiagnostics should remove exact legacy keys');

    cleanupTempDir(dir);
  }

  // WSL shell over a Windows-populated cache → translate C:\... to /mnt/c/...
  {
    const repoRoot = path.resolve(__dirname, '..');
    const match = /^\/mnt\/([a-z])\/(.+)$/i.exec(repoRoot);
    if (match) {
      const file = path.join(repoRoot, 'cli.js');
      const content = fs.readFileSync(file, 'utf8');
      const stats = fs.statSync(file);
      const windowsPath = `${match[1].toUpperCase()}:\\${path.relative(`/mnt/${match[1]}`, file).replace(/\//g, '\\')}`;
      const cache = new WorkspaceCache(repoRoot, { cacheDir: path.join(repoRoot, '.workspace-bridge-test-staleness') });
      cache.fileMetadata.set(windowsPath, {
        originalPath: windowsPath,
        mtime: stats.mtimeMs,
        size: stats.size,
        hash: sha256(content),
      });

      const c = new ServiceContainer();
      c.workspaceRoot = repoRoot;
      c.indexBuildTime = Date.now() - 1000;
      c.cache = cache;

      const s = c.getStaleness();
      assert.strictEqual(s.filesChanged, false, 'should translate Windows cache paths under WSL instead of reporting deletion');
      assert.strictEqual(cache.fileMetadata.get(windowsPath).originalPath, file, 'should repair originalPath to the WSL path');
      cache.close();
    }
  }

  // File deleted → filesChanged
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'd.js');
    fs.writeFileSync(file, 'export const d = 1;\n');
    const stats = fs.statSync(file);

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });

    fs.unlinkSync(file);

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, true, 'should detect deleted file');
    assert.strictEqual(s.isStale, true, 'isStale should be true when file deleted');
    assert.ok(s.changedFiles.includes(file), 'changedFiles should include deleted file');

    cleanupTempDir(dir);
  }

  // No fileMetadata → filesChanged false
  {
    const dir = makeTempDir('wb-staleness-');
    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, false, 'should not flag changes when no metadata');
    assert.strictEqual(s.isStale, false, 'should not be stale with empty metadata');

    cleanupTempDir(dir);
  }

  // Ignore docs/style/asset changes in getStaleness
  {
    const dir = makeTempDir('wb-staleness-ignore-');
    const docFile = path.join(dir, 'README.md');
    const styleFile = path.join(dir, 'styles.css');
    const assetFile = path.join(dir, 'logo.png');
    const codeFile = path.join(dir, 'main.js');

    fs.writeFileSync(docFile, '# Readme\n');
    fs.writeFileSync(styleFile, 'body { color: red; }\n');
    fs.writeFileSync(assetFile, 'fake binary content\n');
    fs.writeFileSync(codeFile, 'console.log("hello");\n');

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    const statsDoc = fs.statSync(docFile);
    const statsStyle = fs.statSync(styleFile);
    const statsAsset = fs.statSync(assetFile);
    const statsCode = fs.statSync(codeFile);

    cache.setFileMetadata(docFile, { mtime: statsDoc.mtimeMs, size: statsDoc.size });
    cache.setFileMetadata(styleFile, { mtime: statsStyle.mtimeMs, size: statsStyle.size });
    cache.setFileMetadata(assetFile, { mtime: statsAsset.mtimeMs, size: statsAsset.size });
    cache.setFileMetadata(codeFile, { mtime: statsCode.mtimeMs, size: statsCode.size });

    // Now modify the doc, style, and asset files (e.g. mismatch size/mtime)
    cache.setFileMetadata(docFile, { mtime: 0, size: 9999 });
    cache.setFileMetadata(styleFile, { mtime: 0, size: 9999 });
    cache.setFileMetadata(assetFile, { mtime: 0, size: 9999 });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    const { ProjectContext } = require('../src/utils/project-context');
    c.projectContext = new ProjectContext(dir);
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s1 = c.getStaleness();
    assert.strictEqual(s1.filesChanged, false, 'should ignore modified docs/styles/assets in filesChanged');
    assert.strictEqual(s1.isStale, false, 'should not be stale when only doc/style/asset files are modified');

    // If code file is modified, it should trigger staleness
    cache.setFileMetadata(codeFile, { mtime: 0, size: 9999 });
    const s2 = c.getStaleness();
    assert.strictEqual(s2.filesChanged, true, 'should detect modified code file');
    assert.strictEqual(s2.isStale, true, 'should be stale when code file is modified');
    assert.ok(s2.changedFiles.includes(codeFile), 'changedFiles should include code file');
    assert.strictEqual(s2.changedFiles.includes(docFile), false, 'changedFiles should NOT include doc file');

    cleanupTempDir(dir);
  }

}

try {
  main();
} catch (e) {
  console.error('Test failed:', e.message);
  process.exit(1);
}
