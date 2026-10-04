// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-security-redaction-');
  const secrets = [];
  try {
    fs.mkdirSync(path.join(root, 'src'));
    const fixtures = {
      'app.js': (value) => `export const API_TOKEN = "${value}";`,
      'util.ts': (value) => `export const API_TOKEN: string = "${value}";\nconst token = "${value}";`,
      'util.py': (value) => `token = "${value}"`,
      'PlainUtility.java': (value) => `class PlainUtility { String token = "${value}"; }`,
      'App.vue': (value) => `<script>const token = "${value}";</script>`,
      'App.svelte': (value) => `<script>const token = "${value}";</script>`,
    };
    for (const [name, source] of Object.entries(fixtures)) {
      const value = `FAKESECRET_${name.replace(/\W/g, '_')}_q81_private`;
      secrets.push(value);
      fs.writeFileSync(path.join(root, 'src', name), source(value));
    }
    for (const format of ['json', 'markdown', 'ai', 'human']) {
      const output = await runCliInProcessRaw(['audit-security', '--cwd', root, '--builtin-only', '--format', format, '--quiet']);
      assert.strictEqual(output.status, 0, `${format}: ${output.stderr}`);
      for (const secret of secrets) assert(!`${output.stdout}\n${output.stderr}`.includes(secret), `${format} leaked ${secret}`);
      if (format === 'json') {
        const data = JSON.parse(output.stdout);
        const findings = data.findings.filter((item) => item.ruleId.endsWith('hardcoded-secret'));
        assert.strictEqual(findings.length, Object.keys(fixtures).length);
        assert(findings.every((item) => item.matchedText === '[REDACTED]' && item.lineStart > 0 && item.file));
      }
      console.log(`OK ${format} keeps findings without secret values`);
    }
    // Custom rules exercise the shared masking boundary for every supported language.
    const extensions = ['js', 'py', 'java', 'kt', 'go', 'rs', 'cpp', 'vue', 'svelte'];
    const rules = { rules: [{ lang: 'all', ext: '\\.(js|py|java|kt|go|rs|cpp|vue|svelte)$', rules: [
      { id: 'custom-credential', pattern: 'CUSTOM_PRIVATE_[A-Z]+', severity: 'high', message: 'Credential', sensitive: true },
    ] }], allowlist: [] };
    fs.writeFileSync(path.join(root, 'rules.json'), JSON.stringify(rules));
    for (const ext of extensions) fs.writeFileSync(path.join(root, 'src', `custom.${ext}`), 'CUSTOM_PRIVATE_VALUE');
    const custom = await runCliInProcessRaw(['audit-security', '--cwd', root, '--builtin-only', '--config', 'rules.json', '--json', '--quiet']);
    assert.strictEqual(custom.status, 0, custom.stderr);
    const findings = JSON.parse(custom.stdout).findings;
    assert.strictEqual(findings.length, extensions.length);
    assert(findings.every((item) => item.matchedText === '[REDACTED]'));
    assert(!custom.stdout.includes('CUSTOM_PRIVATE_VALUE'));
    console.log('OK custom sensitive rules mask all nine languages');
  } finally { cleanupTempDir(root); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
