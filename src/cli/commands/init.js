const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('../../config/constants');
const { validateCwd } = require('./_utils');

async function initCmd(parsed, _container) {
  const invalidInit = validateCwd(parsed);
  if (invalidInit) return { ...invalidInit, __managedLifecycle: true };
  const configPath = path.join(parsed.cwd || process.cwd(), '.workspace-bridge.json');
  if (fs.existsSync(configPath)) {
    const err = { ok: false, error: `.workspace-bridge.json already exists at ${configPath}` };
    if (parsed.json) console.log(JSON.stringify(err, null, 2));
    else console.error(err.error);
    process.exitCode = 1;
    return { ok: false, __managedLifecycle: true };
  }
  const root = parsed.cwd || process.cwd();
  const GENERATED_HINTS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', '.turbo', 'coverage', '.cache', '.git']);
  const REFERENCE_HINTS = new Set(['docs', 'test', 'tests', 'benchmark', 'scripts', 'reference', 'fixtures', 'fixture-temp']);
  const generated = [];
  const reference = [];
  const active = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (GENERATED_HINTS.has(entry.name)) generated.push(entry.name);
      else if (REFERENCE_HINTS.has(entry.name)) reference.push(entry.name);
      else if (!entry.name.startsWith('.')) active.push(entry.name);
    }
  } catch { /* ignore read errors */ }
  const defaultConfig = {
    $schema: 'https://workspace-bridge.dev/schema/v1.json',
    directories: {
      active,
      reference,
      archive: [],
      generated,
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n');

  // Auto-manage .gitignore for workspace-bridge cache artifacts
  const gitignorePath = path.join(root, '.gitignore');
  const GITIGNORE_ENTRIES = [
    '# workspace-bridge cache',
    '.workspace-bridge-cache.json',
    '.workspace-bridge-cache.json.bak',
    '.tmp-*.json',
    '.workspace-bridge-cache.json.tmp-*',
    'cache.db',
    'cache.db-wal',
    'cache.db-shm',
  ];
  let gitignoreUpdated = false;
  try {
    let existing = '';
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf8');
    }
    const missing = GITIGNORE_ENTRIES.filter((line) => !existing.includes(line));
    if (missing.length > 0) {
      const append = (existing.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n';
      fs.writeFileSync(gitignorePath, existing + append);
      gitignoreUpdated = true;
    }
  } catch { /* ignore gitignore errors */ }

  const parts = [];
  parts.push('Created .workspace-bridge.json.');
  if (active.length > 0) parts.push(`Active directories: ${active.join(', ')}.`);
  if (generated.length > 0) parts.push(`Generated directories: ${generated.join(', ')}.`);
  if (reference.length > 0) parts.push(`Reference directories: ${reference.join(', ')}.`);
  if (gitignoreUpdated) parts.push('Updated .gitignore with workspace-bridge cache exclusions.');
  parts.push('Adjust "active" / "archive" as needed.');
  const result = {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    configPath,
    gitignoreUpdated,
    message: parts.join(' '),
  };
  if (parsed.json) console.log(JSON.stringify(result, null, 2));
  else console.log(result.message);
  return { ok: true, __managedLifecycle: true };
}

module.exports = initCmd;
