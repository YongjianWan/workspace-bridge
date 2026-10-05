#!/usr/bin/env node
// @fast
// @semantic
/**
 * External tools must be probed with the environment they are run in, and a skipped tool must
 * be said out loud: "adapters: ['builtin']" alone reads as "semgrep ran and found nothing extra".
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { buildSafeEnv } = require('../src/utils/command');
const { ADAPTERS } = require('../src/adapters');
const { auditSecurity } = require('../src/tools/security-tools');

async function main() {
  // Windows resolves `semgrep` to semgrep.exe through PATHEXT; without it `where semgrep` finds nothing.
  const savedPathext = process.env.PATHEXT;
  const savedComspec = process.env.COMSPEC;
  process.env.PATHEXT = '.COM;.EXE;.CMD';
  process.env.COMSPEC = '/test/shell';
  try {
    const env = buildSafeEnv();
    assert.strictEqual(env.PATHEXT, '.COM;.EXE;.CMD', 'PATHEXT must reach child processes');
    assert.strictEqual(env.COMSPEC, '/test/shell');
  } finally {
    if (savedPathext === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = savedPathext;
    if (savedComspec === undefined) delete process.env.COMSPEC; else process.env.COMSPEC = savedComspec;
  }

  const root = makeTempDir('wb-ext-tool-');
  const originals = ADAPTERS.map((a) => a.isAvailable);
  try {
    fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = 1;\n');
    ADAPTERS.forEach((a) => { a.isAvailable = async () => false; });

    const skipped = await auditSecurity({ cwd: root, targets: ['.'], builtinOnly: false }, null);
    assert.deepStrictEqual(skipped.adapters, ['builtin']);
    const warning = (skipped.warnings || []).find((w) => w.type === 'external-tool-unavailable');
    assert(warning, 'a missing external tool must be reported in warnings[]');
    assert.strictEqual(warning.tool, 'semgrep');

    const chosen = await auditSecurity({ cwd: root, targets: ['.'], builtinOnly: true }, null);
    assert.deepStrictEqual(chosen.warnings || [], [], '--builtin-only is a choice, not a missing tool');
  } finally {
    ADAPTERS.forEach((a, i) => { a.isAvailable = originals[i]; });
    cleanupTempDir(root);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
