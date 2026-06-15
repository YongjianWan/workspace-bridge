// @semantic
const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');

function testDynamicImport() {
  const content = `
import { Command } from 'commander';
const program = new Command();
program.command('analyze').action(() => import('./analyze.js'));
program.command('clean').action(() => import('./clean.js'));
`;

  const result = parseJavaScript(content, 'src/cli/index.ts');
  assert.strictEqual(result.parseMode, 'ast', `Expected parseMode 'ast', got: ${result.parseMode}`);

  const dynamicImports = result.importRecords.filter((r) =>
    r.source === './analyze.js' || r.source === './clean.js'
  );
  assert.strictEqual(dynamicImports.length, 2, `Expected 2 dynamic imports, got: ${dynamicImports.length}`);
}

testDynamicImport();
