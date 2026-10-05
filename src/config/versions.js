/**
 * Schema and cache version constants.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// CLI/API schema version. Increment when JSON output structure changes.
const SCHEMA_VERSION = '1.2.0';

// Cache layout revision. Increment when the persistent cache *structure* changes (tables, columns,
// key formats). A change to what the parsers/resolvers compute does not need a bump: the
// fingerprint below covers it.
const CACHE_SCHEMA_REVISION = 55;

// Persisted parse results, edges and aggregates are a function of the code under
// src/services/dep-graph (parsers, resolvers, builder, analysis) and of the tree-sitter packages.
// Their fingerprint is part of CACHE_VERSION so an edit to that code invalidates old caches by itself,
// instead of relying on someone remembering to bump a number.
const FINGERPRINT_BITS = 31;
const FINGERPRINT_SPAN = 2 ** FINGERPRINT_BITS;
const FINGERPRINTED_EXTENSIONS = new Set(['.js', '.scm', '.json']);
const FINGERPRINTED_PACKAGES = ['web-tree-sitter', 'tree-sitter-wasms', '@babel/parser'];

function listFingerprintedFiles(dir, skipDirs = new Set()) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) files.push(...listFingerprintedFiles(full, skipDirs));
    }
    else if (FINGERPRINTED_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function readManifestVersion(manifest, name) {
  if (!fs.existsSync(manifest)) return null;
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return pkg.name === name ? pkg.version : null;
}

// Some packages hide package.json behind an "exports" map and some have no loadable entry point,
// so try the manifest directly and then walk up from the entry point.
function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    // not exported: look for the manifest next to the entry point
  }
  try {
    let dir = path.dirname(require.resolve(name));
    while (dir !== path.dirname(dir)) {
      const version = readManifestVersion(path.join(dir, 'package.json'), name);
      if (version) return version;
      dir = path.dirname(dir);
    }
  } catch {
    // fall through: an unresolvable package is recorded as such
  }
  return 'unresolved';
}

/**
 * Hash of the engine sources and tree-sitter package versions, line endings normalised so a
 * Windows and a Linux checkout of the same commit agree. If the sources cannot be read the
 * provenance is unknown, so the result is random: no cache written by another process is trusted.
 */
function computeSourceFingerprint(rootDir, skipDirs) {
  const hash = crypto.createHash('sha256');
  try {
    for (const file of listFingerprintedFiles(rootDir, skipDirs).sort()) {
      hash.update(path.relative(rootDir, file).split(path.sep).join('/'));
      hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    }
    for (const name of FINGERPRINTED_PACKAGES) hash.update(`${name}@${packageVersion(name)}`);
  } catch {
    hash.update(crypto.randomBytes(16));
  }
  return hash.digest().readUInt32BE(0) % FINGERPRINT_SPAN;
}

function computeEngineFingerprint(engineDir = path.join(__dirname, '..', 'services', 'dep-graph')) {
  return computeSourceFingerprint(engineDir);
}

// Analysis snapshots hold what the tools layer computed from the graph, so they depend on all of
// src/ except the CLI layer, which only formats a snapshot after it has been replayed. Parse results
// keep the narrower engine stamp: editing a tool must not throw away parsing work.
const SNAPSHOT_EXCLUDED_DIRS = new Set(['cli']);

function computeSnapshotFingerprint(srcDir = path.join(__dirname, '..')) {
  return computeSourceFingerprint(srcDir, SNAPSHOT_EXCLUDED_DIRS);
}

const CACHE_VERSION = CACHE_SCHEMA_REVISION * FINGERPRINT_SPAN + computeEngineFingerprint();
const SNAPSHOT_VERSION = CACHE_SCHEMA_REVISION * FINGERPRINT_SPAN + computeSnapshotFingerprint();

module.exports = {
  SCHEMA_VERSION, CACHE_VERSION, SNAPSHOT_VERSION, CACHE_SCHEMA_REVISION, FINGERPRINT_SPAN,
  computeEngineFingerprint, computeSnapshotFingerprint,
};
