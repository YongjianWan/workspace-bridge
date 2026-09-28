#!/usr/bin/env node
// @semantic
/**
 * P1-13: 无插值的模板字符串写的动态导入必须按普通字符串识别。
 * `` import(`./lazy`) `` 之前不产生 import 记录，目标文件被误报死代码；
 * 带插值的 `` import(`./x/${name}`) `` 依旧识别不了（也不许崩）。
 */
const assert = require('assert');
const { registry } = require('../src/services/dep-graph/parsers/registry');
const {
  sanitizeForRegex,
  extractImportsWithRegex,
} = require('../src/services/dep-graph/parsers/js/regex-fallback');

function parseJs(content, filePath = 'main.ts') {
  const entry = registry.findByExt(filePath.slice(filePath.lastIndexOf('.')));
  assert.ok(entry, `registry should have a parser for ${filePath}`);
  return entry.parse(content, filePath);
}

function testTemplateLiteralDynamicImport() {
  const result = parseJs('const f = () => import(`./lazy`);\nexport { f };\n');
  assert(
    result.imports.includes('./lazy'),
    `template-literal dynamic import should be extracted, got imports: ${JSON.stringify(result.imports)}`
  );
  const record = (result.importRecords || []).find((r) => r.source === './lazy');
  assert.ok(record, 'import record for ./lazy should exist');
  assert.strictEqual(record.isLazy, true, 'dynamic import record should be marked lazy');
}

function testTemplateLiteralRequire() {
  const result = parseJs('const m = require(`./cjs-dep`);\n', 'main.cjs');
  assert(
    result.imports.includes('./cjs-dep'),
    `template-literal require should be extracted, got imports: ${JSON.stringify(result.imports)}`
  );
}

function testInterpolatedTemplateStillSkipped() {
  const result = parseJs('const name = "x";\nconst f = () => import(`./mods/${name}`);\n');
  assert(
    !result.imports.some((s) => String(s).includes('mods')),
    `interpolated template must NOT produce a static import, got: ${JSON.stringify(result.imports)}`
  );
}

function testQuotedFormsUnchanged() {
  const single = parseJs("const f = () => import('./a');\n");
  const double = parseJs('const g = () => import("./b");\n');
  assert(single.imports.includes('./a'), 'single-quoted dynamic import still works');
  assert(double.imports.includes('./b'), 'double-quoted dynamic import still works');
}

function testRegexFallbackParity() {
  const dyn = extractImportsWithRegex(sanitizeForRegex('const f = () => import(`./lazy`);'));
  assert(
    dyn.imports.includes('./lazy'),
    `regex fallback should extract template-literal dynamic import, got: ${JSON.stringify(dyn.imports)}`
  );
  const req = extractImportsWithRegex(sanitizeForRegex('const m = require(`./cjs-dep`);'));
  assert(
    req.imports.includes('./cjs-dep'),
    `regex fallback should extract template-literal require, got: ${JSON.stringify(req.imports)}`
  );
  const interp = extractImportsWithRegex(sanitizeForRegex('const f = () => import(`./mods/${name}`);'));
  assert(
    !interp.imports.some((s) => String(s).includes('mods')),
    `regex fallback must NOT extract interpolated template, got: ${JSON.stringify(interp.imports)}`
  );
}

function main() {
  testTemplateLiteralDynamicImport();
  testTemplateLiteralRequire();
  testInterpolatedTemplateStillSkipped();
  testQuotedFormsUnchanged();
  testRegexFallbackParity();
  console.log('p1-13-template-literal-import-test: PASS');
}

main();
