// @slow
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ServiceContainer } = require('../src/services/container');
const { executeCommand } = require('../src/cli/repl');
const { formatHuman, formatSummary, formatMarkdown } = require('../src/cli/formatters');
const { makeTempDir, cleanupTempDir, runCliRaw } = require('./test-helpers');

const languages = [
  ['JS/TS', 'ts', name => `export class ${name} {}\n`],
  ['Python', 'py', name => `class ${name}:\n    pass\n`],
  ['Java', 'java', name => `public class ${name} {}\n`],
  ['Go', 'go', name => `package ranking\nfunc ${name}() {}\n`],
  ['Rust', 'rs', name => `pub struct ${name};\n`],
  ['Vue', 'vue', name => `<script setup>const name = '${name}';</script><template><div>{{ name }}</div></template>\n`],
];

async function main() {
  for (const [language, extension, content] of languages) {
    const root = makeTempDir('wb-ranking-cli-');
    const container = new ServiceContainer();
    const git = (...args) => {
      const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stderr);
    };
    const input = `InvoiceService.${extension}`;
    const partner = `InvoiceDTO.${extension}`;
    const sibling = `InvoiceEntity.${extension}`;
    try {
      git('init', '-q');
      git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.com');
      for (const name of ['InvoiceService', 'InvoiceDTO']) {
        fs.writeFileSync(path.join(root, `${name}.${extension}`), content(name));
      }
      git('add', '.'); git('commit', '-qm', 'pair');
      fs.writeFileSync(path.join(root, sibling), content('InvoiceEntity'));
      await container.initialize(root, 30000, { watch: false });
      const raw = runCliRaw(['impact', '--cwd', root, '--file', input, '--json', '--quiet']);
      assert.strictEqual(raw.status, 0, raw.stderr);
      const cli = JSON.parse(raw.stdout);
      assert.deepStrictEqual(cli.impact.map(row => path.basename(row.file)), [partner, sibling], language);
      assert.strictEqual(cli.impact[0].source, 'cochange', language);
      assert.strictEqual(cli.impact[1].source, 'same-stem', language);
      const repl = await executeCommand(container, `impact ${input}`, { structured: true });
      assert.deepStrictEqual(repl.impact, cli.impact, `${language}: CLI/REPL must agree in order and evidence`);
      if (process.platform === 'win32') {
        const lowerCase = await executeCommand(container, `impact ${input.toLowerCase()}`, { structured: true });
        assert.deepStrictEqual(lowerCase.impact, cli.impact, `${language}: Windows case aliases must recover original spelling for stems`);
      }
      for (const format of [formatHuman, formatSummary, formatMarkdown]) {
        const text = format('impact', cli);
        assert(!text.includes('undefined'), `${language}: formatter must not invent a graph level`);
        assert(text.includes('cochange (low)') && text.includes('same-stem (low)'), `${language}: evidence must be visible`);
      }
      const text = await executeCommand(container, `impact ${input}`);
      assert(text.includes('cochange (low)') && !text.includes('level-undefined'), language);
      const limited = await executeCommand(container, `impact ${input} --max-files 1`, { structured: true });
      assert.deepStrictEqual(limited.impact, cli.impact.slice(0, 1));
      assert.strictEqual(limited.impactCount, 2);
      assert.strictEqual(limited.truncated, true);
      console.log(`${language}: CLI/REPL ranking and evidence passed`);
    } finally {
      await container.shutdown();
      cleanupTempDir(root);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
