/**
 * Precomputed impact payload codec (path compression).
 *
 * affectedTests / impactRadius entries repeat full absolute paths many times
 * per row (file + via chains), which made precomputed_impact the dominant
 * cache table (~195MB on Django). Encoding replaces every path with a
 * row-local dictionary index and strips the workspace-root prefix; decoding
 * restores full paths and interns them so identical paths share one string
 * in memory. Unknown entry fields survive the round-trip via object spread.
 *
 * The encoded form is marked with a `v2:` prefix (or `v2g:` when the payload
 * is additionally gzip-compressed — highly repetitive path-index JSON
 * compresses ~5-10x) and stored in the affected_tests column; the
 * impact_radius column stays null. Values without a marker pass through
 * untouched, so legacy rows keep working.
 */

const zlib = require('zlib');

const V2_PREFIX = 'v2:';
const V2_GZIP_PREFIX = 'v2g:';
// Normalized graph keys are absolute paths and never start with '='; the
// marker distinguishes "path outside workspaceRoot, stored as-is" from
// "root-relative path, prefix on decode".
const EXTERNAL_MARKER = '=';

function createImpactEncoder(rootPrefix) {
  return function encode(affectedTests, impactRadius) {
    const paths = [];
    const index = new Map();
    const intern = (p) => {
      if (typeof p !== 'string' || p.length === 0) return p;
      const stored = p.startsWith(rootPrefix) ? p.slice(rootPrefix.length) : EXTERNAL_MARKER + p;
      let i = index.get(stored);
      if (i === undefined) {
        i = paths.length;
        paths.push(stored);
        index.set(stored, i);
      }
      return i;
    };
    const at = (affectedTests || []).map((t) => ({
      ...t,
      file: intern(t.file),
      via: Array.isArray(t.via) ? t.via.map(intern) : t.via,
    }));
    // null (not array) must survive as null: consumers distinguish
    // "no radius computed" (null) from "empty radius" ([]).
    const ir = Array.isArray(impactRadius) ? impactRadius.map((e) => ({
      ...e,
      file: intern(e.file),
      via: Array.isArray(e.via) ? e.via.map(intern) : e.via,
    })) : null;
    const plain = V2_PREFIX + JSON.stringify({ paths, at, ir });
    // Repetitive index JSON compresses hard; one gzip pass beats any
    // hand-rolled cross-row dictionary for a fraction of the complexity.
    return V2_GZIP_PREFIX + zlib.gzipSync(Buffer.from(plain, 'utf8'), { level: 6 }).toString('base64');
  };
}

function createImpactDecoder(rootPrefix) {
  // Cross-row interning: via chains and impact sets repeat the same files
  // across rows of one table load; sharing string instances keeps the warm
  // restore from allocating millions of identical path strings.
  const restored = new Map();
  const restore = (stored) => {
    let full = restored.get(stored);
    if (full === undefined) {
      full = stored.startsWith(EXTERNAL_MARKER) ? stored.slice(1) : rootPrefix + stored;
      restored.set(stored, full);
    }
    return full;
  };
  const restoreField = (paths, x) => {
    if (typeof x !== 'number') return x;
    if (!Number.isInteger(x) || x < 0 || x >= paths.length || typeof paths[x] !== 'string') {
      throw new Error('Invalid impact path index');
    }
    return restore(paths[x]);
  };
  const restorePathList = (paths, list) => (Array.isArray(list) ? list.map((x) => restoreField(paths, x)) : list);

  return function decode(raw) {
    if (typeof raw !== 'string') return raw;
    if (!raw.startsWith(V2_GZIP_PREFIX) && !raw.startsWith(V2_PREFIX)) return raw;
    let payload = raw;
    try {
      if (raw.startsWith(V2_GZIP_PREFIX)) {
        payload = zlib.gunzipSync(Buffer.from(raw.slice(V2_GZIP_PREFIX.length), 'base64')).toString('utf8');
      }
      if (!payload.startsWith(V2_PREFIX)) return null;
      const { paths, at, ir } = JSON.parse(payload.slice(V2_PREFIX.length));
      if (!Array.isArray(paths) || !Array.isArray(at) || (ir !== null && !Array.isArray(ir))) return null;
      const atOut = at.map((t) => ({ ...t, file: restoreField(paths, t.file), via: restorePathList(paths, t.via) }));
      const irOut = ir === null ? null : ir.map((e) => ({ ...e, file: restoreField(paths, e.file), via: restorePathList(paths, e.via) }));
      return { affectedTests: atOut, impactRadius: irOut };
    } catch {
      return null; // corrupted cache row; caller recomputes impact on query
    }
  };
}

function isEncodedImpact(raw) {
  return typeof raw === 'string' && (raw.startsWith(V2_PREFIX) || raw.startsWith(V2_GZIP_PREFIX));
}

module.exports = { createImpactEncoder, createImpactDecoder, isEncodedImpact, V2_PREFIX, V2_GZIP_PREFIX };
