#!/usr/bin/env node

const assert = require('assert');
const { classifyChangeType } = require('../src/cli/formatters/audit-diff-summary');

// 纯 docs → docs
assert.strictEqual(classifyChangeType([
  { file: 'README.md', classification: { fileRole: 'docs' } },
  { file: 'CHANGELOG.md', classification: { fileRole: 'docs' } },
]), 'docs');

// 纯 config → config
assert.strictEqual(classifyChangeType([
  { file: '.eslintrc.json', classification: { fileRole: 'config' } },
]), 'config');

// docs 主导 + 少量 code（code 占比 ≤20%）→ 应保持 docs，不应被 1 个 code 文件拖升为 code
assert.strictEqual(classifyChangeType([
  { file: 'README.md', classification: { fileRole: 'docs' } },
  { file: 'CHANGELOG.md', classification: { fileRole: 'docs' } },
  { file: 'docs/guide.md', classification: { fileRole: 'docs' } },
  { file: 'docs/api.md', classification: { fileRole: 'docs' } },
  { file: 'src/tweak.js', classification: { fileRole: 'library' } },
]), 'docs');

// code 占比 >20% → code
assert.strictEqual(classifyChangeType([
  { file: 'README.md', classification: { fileRole: 'docs' } },
  { file: 'src/a.js', classification: { fileRole: 'library' } },
  { file: 'src/b.js', classification: { fileRole: 'library' } },
]), 'code');

// reference 文件不应影响 changeType 判断
assert.strictEqual(classifyChangeType([
  { file: 'reference/foo.md', classification: { fileRole: 'docs', directoryRole: 'reference' } },
  { file: 'reference/bar.md', classification: { fileRole: 'docs', directoryRole: 'reference' } },
  { file: 'src/code.js', classification: { fileRole: 'library', directoryRole: 'active' } },
]), 'code');

// 全是 reference → fallback to code（无有效主线文件时保守处理）
assert.strictEqual(classifyChangeType([
  { file: 'reference/foo.md', classification: { fileRole: 'docs', directoryRole: 'reference' } },
]), 'code');

// tests + 少量 code（code 占比 ≤20%）→ tests
assert.strictEqual(classifyChangeType([
  { file: 'test/a.test.js', classification: { fileRole: 'test' } },
  { file: 'test/b.test.js', classification: { fileRole: 'test' } },
  { file: 'test/c.test.js', classification: { fileRole: 'test' } },
  { file: 'test/d.test.js', classification: { fileRole: 'test' } },
  { file: 'src/helper.js', classification: { fileRole: 'library' } },
]), 'tests');

console.log('change-type-test: ok');
