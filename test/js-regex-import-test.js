// @semantic
const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');

// Force regex fallback by placing invalid syntax at the end
const INVALID_SUFFIX = '\ninvalid syntax here to force regex fallback\n';

function testImportRegexFallback() {
  const content = `
import React from 'react';
import { useState, useEffect } from 'react-dom';
import * as path from "path";
import './style.css';
const fs = require('fs');
const { join } = require('path');
import('./dynamic-module');

const template = \`hello
import fake from './fake'
world\`;
` + INVALID_SUFFIX;

  const result = parseJavaScript(content, 'test.js');

  assert.strictEqual(result.parseMode, 'regex', 'Expected parseMode to fallback to regex');
  
  // Verify correct imports are extracted
  assert.ok(result.imports.includes('react'), 'Should extract react import');
  assert.ok(result.imports.includes('react-dom'), 'Should extract react-dom import');
  assert.ok(result.imports.includes('path'), 'Should extract path import');
  assert.ok(result.imports.includes('./style.css'), 'Should extract side-effect CSS import');
  assert.ok(result.imports.includes('fs'), 'Should extract fs require');
  assert.ok(result.imports.includes('path'), 'Should extract path require');
  assert.ok(result.imports.includes('./dynamic-module'), 'Should extract dynamic import');

  // Verify false imports inside template literals are NOT extracted
  assert.ok(!result.imports.includes('./fake'), 'Should NOT extract fake import from template literal');

  // Verify importRecords detail
  const reactRecord = result.importRecords.find(r => r.source === 'react');
  assert.ok(reactRecord, 'Should have react importRecord');
  assert.deepStrictEqual(reactRecord.imported, ['default']);

  const reactDomRecord = result.importRecords.find(r => r.source === 'react-dom');
  assert.ok(reactDomRecord, 'Should have react-dom importRecord');
  assert.ok(reactDomRecord.imported.includes('useState'));
  assert.ok(reactDomRecord.imported.includes('useEffect'));

  const pathRecord = result.importRecords.find(r => r.source === 'path' && r.usesAllExports === true);
  assert.ok(pathRecord, 'Should have namespace path importRecord');

  const cssRecord = result.importRecords.find(r => r.source === './style.css');
  assert.ok(cssRecord, 'Should have side-effect importRecord');
  assert.strictEqual(cssRecord.usesAllExports, true);

  console.log('js-regex-import-test: all passed');
}

testImportRegexFallback();
