#!/usr/bin/env node
// @semantic
// @fast
/**
 * A JS file the AST parser could not handle falls back to regex. That result must be
 * labelled 'regex-fallback' (never trusted from cache, 0-importer dead exports drop to low).
 * A Svelte file without a script block has nothing to parse: 'regex-native'.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { GraphBuilder } = require('../src/services/dep-graph/builder');

async function parseReason(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-parse-reason-'));
  try {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content, 'utf8');
    const builder = new GraphBuilder(DependencyGraph.fromSchema(dir, {}));
    const res = await builder.parseFileOnly(file);
    return { mode: res.parseMode, reason: res.parseModeReason };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const ok = await parseReason('ok.js', "import x from './y';\nexport const a = 1;\n");
  assert.deepStrictEqual(ok, { mode: 'ast', reason: 'ast-success' });

  const broken = await parseReason('broken.js', "import x from './y';\nexport const = ;;; {{{\n");
  assert.strictEqual(broken.mode, 'regex', 'unparseable JS must fall back to regex');
  assert.strictEqual(broken.reason, 'regex-fallback');

  const svelteNoScript = await parseReason('A.svelte', '<p>hi</p>\n');
  assert.deepStrictEqual(svelteNoScript, { mode: 'regex', reason: 'regex-native' });

  const svelteScript = await parseReason('B.svelte', "<script>\n  import x from './y';\n</script>\n<p>hi</p>\n");
  assert.deepStrictEqual(svelteScript, { mode: 'ast', reason: 'ast-success' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
