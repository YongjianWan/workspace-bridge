/**
 * Graph keys fold case (Windows) and use `/`, so some tools hand back the key where others hand
 * back the file's own spelling. Output is the one place a path gets a single spelling: any string
 * that is exactly a known file or directory key is replaced by the on-disk spelling, in the style
 * it was written in (absolute stays absolute, workspace-relative stays relative with `/`).
 */
const path = require('path');
const { normalizePathKey } = require('../utils/path');

function toPosixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

/**
 * Map of key spelling -> on-disk spelling, only for keys that differ from their on-disk
 * spelling (on a case-sensitive filesystem that is none, so the map is empty and free).
 */
function buildSpellingIndex(graph, root) {
  const index = new Map();
  const rootKey = normalizePathKey(root);
  const seenDirs = new Set();

  const add = (key, onDisk) => {
    const relKey = key.startsWith(`${rootKey}/`) ? key.slice(rootKey.length + 1) : null;
    if (key !== onDisk) index.set(key, onDisk);
    if (relKey) {
      const relOnDisk = toPosixRelative(root, onDisk);
      if (relKey !== relOnDisk) index.set(relKey, relOnDisk);
    }
  };

  for (const key of graph.getAllFilePaths()) {
    const onDisk = graph._displayPath(key);
    add(key, onDisk);
    let dirKey = path.posix.dirname(key);
    let dirOnDisk = path.dirname(onDisk);
    while (dirKey.startsWith(`${rootKey}/`) && !seenDirs.has(dirKey)) {
      seenDirs.add(dirKey);
      add(dirKey, dirOnDisk);
      dirKey = path.posix.dirname(dirKey);
      dirOnDisk = path.dirname(dirOnDisk);
    }
  }
  return index;
}

function respell(value, index) {
  if (typeof value === 'string') return index.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => respell(item, index));
  if (!value || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) out[index.get(key) ?? key] = respell(child, index);
  return out;
}

/** Returns `result` with every exact file/directory key replaced by its on-disk spelling. */
function applyPathSpelling(result, index) {
  return !index || index.size === 0 || !result || typeof result !== 'object' ? result : respell(result, index);
}

module.exports = { buildSpellingIndex, applyPathSpelling };
