#!/usr/bin/env node
// @fast
// @semantic
/**
 * Hardcoded secrets are recognised by the shape of the value (provider prefixes, PEM headers,
 * credentials inside a connection string), not only by the variable name. Fixture values are
 * assembled at runtime so this file itself holds no scannable secret.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { auditSecurity } = require('../src/tools/security-tools');

const FILLER = 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm';
const DASHES = '-'.repeat(5);

const SOURCE = [
  `module.exports = {`,
  `  stripe: '${'sk_' + 'live_'}${FILLER}',`,
  `  awsKey: '${'AK' + 'IA'}IOSFODNN7EXAMPLE',`,
  `  gh: '${'gh' + 'p_'}${FILLER}',`,
  `};`,
  `const pw = "correct-horse-battery";`,
  `const DB_URL = "${'post' + 'gres'}://admin:${'hunter' + '2hunter2'}@db.internal/app";`,
  `const pem = \`${DASHES}BEGIN RSA PRIVATE KEY${DASHES}\`;`,
  ``,
].join('\n');

const EXPECTED_LINES = { 2: 'stripe', 3: 'aws', 4: 'github', 6: 'password var', 7: 'connection string', 8: 'pem' };

async function main() {
  const root = makeTempDir('wb-secret-values-');
  try {
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config', 'secrets.js'), SOURCE);
    fs.writeFileSync(path.join(root, 'config', 'clean.js'), "const url = 'https://example.com/path';\nconst n = 'hello world';\n");

    const res = await auditSecurity({ cwd: root, targets: ['.'], builtinOnly: true }, null);
    assert.strictEqual(res.ok, true);

    const hitLines = new Set(res.findings.filter((f) => /secrets\.js$/.test(f.file)).map((f) => f.lineStart));
    for (const [line, what] of Object.entries(EXPECTED_LINES)) {
      assert(hitLines.has(Number(line)), `${what} (line ${line}) must be reported, got lines ${[...hitLines]}`);
    }
    assert(!res.findings.some((f) => /clean\.js$/.test(f.file)), 'ordinary strings must not be flagged');

    const dump = JSON.stringify(res);
    for (const needle of [FILLER, 'correct-horse-battery', 'hunter' + '2hunter2']) {
      assert(!dump.includes(needle), 'secret values must be redacted from the output');
    }

    const coverage = res.scanMeta[0].summary.coverage;
    assert(coverage && Array.isArray(coverage.ruleIds), 'scanMeta must state which rules ran');
    assert(coverage.ruleIds.some((id) => id.startsWith('secret-')), 'coverage must list the secret rules');
    assert(/not (?:mean|imply)|does not/i.test(coverage.note), 'coverage note must say that no findings is not proof of no secrets');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
