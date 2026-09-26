// @semantic — P0-5: framework detection and route extraction must see the whole file, not a 4KB/16KB window
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  detectFrameworkFromContent,
  detectFrameworkFromContentSync,
  extractRoutes,
} = require('../src/services/dep-graph/framework-patterns');
const { EntryDetector, readScanContent } = require('../src/services/dep-graph/entry-detector');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function padHelpers(n) {
  return Array.from({ length: n }, (_, i) => `def helper_${i}():\n    return ${i}\n`).join('\n');
}

// Mirrors repro FASTAPI-16KB: first decorator sits around byte 20792.
function fastapiContent() {
  return `from fastapi import FastAPI\nfrom util import helper\napp = FastAPI()\n\n${padHelpers(600)}\n\n@app.get("/health")\ndef health():\n    return helper()\n`;
}

async function testFastapiHintBeyond4KBPrefilter() {
  const content = fastapiContent();
  assert.ok(
    content.indexOf('@app.get') > 4096,
    'fixture sanity: first decorator must sit past the old 4KB prefilter'
  );

  const sync = detectFrameworkFromContentSync('asr_service.py', content);
  assert.ok(
    sync && sync.framework === 'fastapi' && sync.isEntry === true,
    'sync framework scan must find FastAPI decorators anywhere in the file'
  );

  const hint = await detectFrameworkFromContent('/svc/asr_service.py', content);
  assert.ok(
    hint && hint.framework === 'fastapi',
    'full detection (tree-sitter query + sync fallback) must find FastAPI past 4KB'
  );
}

async function testFlaskRouteBeyond16KBWindow() {
  // Flask has no registered route query → always exercises the regex fallback.
  const content = `from flask import Flask\napp = Flask(__name__)\n\n${padHelpers(700)}\n\n@app.route("/late")\ndef late():\n    return "ok"\n`;
  assert.ok(
    content.indexOf('@app.route') > 4096 * 4,
    'fixture sanity: route must sit past the old 4KB×4 window'
  );
  const routes = await extractRoutes('late_api.py', content);
  assert.ok(
    routes.some((r) => r.path === '/late'),
    'regex route fallback must extract routes declared beyond 16KB'
  );
}

async function testFastapiRouteBeyond16KB() {
  const routes = await extractRoutes('asr_service.py', fastapiContent());
  assert.ok(
    routes.some((r) => r.path === '/health'),
    'FastAPI routes beyond 16KB must be extracted (query and regex paths agree)'
  );
}

function testEntryDetectorSeesFastapiPast4KBOnDisk() {
  const dir = makeTempDir('wb-p0-5-');
  try {
    const file = path.join(dir, 'asr_service.py');
    fs.writeFileSync(file, fastapiContent());
    const content = readScanContent(file);
    assert.ok(
      content && content.includes('@app.get'),
      'entry scan content must reach decorators past 4KB'
    );
    const detector = new EntryDetector({ normalizeFilePath: (p) => p });
    assert.strictEqual(
      detector.isKnownEntryFile(file),
      true,
      'a FastAPI service file must be an entry regardless of decorator offset'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

async function run() {
  await testFastapiHintBeyond4KBPrefilter();
  await testFlaskRouteBeyond16KBWindow();
  await testFastapiRouteBeyond16KB();
  testEntryDetectorSeesFastapiPast4KBOnDisk();
  console.log('PASS: p0-5-fastapi-route-scan-test');
}

run().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
