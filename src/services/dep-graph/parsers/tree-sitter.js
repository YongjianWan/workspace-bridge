const path = require('path');

// L2-20: both caches hold the IN-FLIGHT PROMISE, not the settled value.
// Checking the cache synchronously but populating it after an async load let
// N concurrent first-time callers all see a miss and run N duplicate loads —
// in the builder that race produced "Incompatible language version 0" objects
// (19/36 cobra files silently degraded to regex, 2026-07-28). A rejected or
// null-settling load is evicted so a later call retries (toolchain may have
// been fixed), matching the old no-cache-on-failure behavior.
let parserModulePromise = null;
const languageCache = new Map();
const MAX_LANGUAGE_CACHE_SIZE = 12; // defensive cap: 9 langs + headroom

async function getParserModule() {
  if (!parserModulePromise) {
    parserModulePromise = (async () => {
      try {
        if (process.env.FORCE_WASM_FAIL) {
          throw new Error('Simulated WASM WASI cold start failure');
        }
        const mod = require('web-tree-sitter');
        await mod.Parser.init();
        return mod;
      } catch {
        return null;
      }
    })();
    parserModulePromise.then((mod) => {
      if (!mod) parserModulePromise = null;
    });
  }
  return parserModulePromise;
}

async function loadLanguage(langName) {
  const cached = languageCache.get(langName);
  if (cached) return cached;

  const promise = (async () => {
    const mod = await getParserModule();
    if (!mod) return null;
    try {
      const pkgJson = require.resolve('tree-sitter-wasms/package.json');
      const wasmPath = path.join(path.dirname(pkgJson), 'out', `tree-sitter-${langName}.wasm`);
      const lang = await mod.Language.load(wasmPath);
      // Defensive LRU-like eviction: if cache exceeds cap, drop oldest entry
      if (languageCache.size > MAX_LANGUAGE_CACHE_SIZE) {
        const firstKey = languageCache.keys().next().value;
        if (firstKey !== undefined && firstKey !== langName) {
          const oldPromise = languageCache.get(firstKey);
          languageCache.delete(firstKey);
          Promise.resolve(oldPromise).then((oldLang) => {
            try { if (oldLang) oldLang.delete(); } catch {}
          });
        }
      }
      return lang;
    } catch {
      return null;
    }
  })();
  languageCache.set(langName, promise);
  promise.then((lang) => {
    if (!lang && languageCache.get(langName) === promise) {
      languageCache.delete(langName);
    }
  });
  return promise;
}

function getNodeText(node) {
  if (!node) return '';
  return node.text;
}

function getLineStart(node) {
  if (!node) return undefined;
  return node.startPosition.row + 1;
}

function getLineEnd(node) {
  if (!node) return undefined;
  return node.endPosition.row + 1;
}

function stripQuotes(text) {
  if (!text) return '';
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith('<') && t.endsWith('>')) {
    return t.slice(1, -1);
  }
  return t;
}

module.exports = {
  getParserModule,
  loadLanguage,
  getNodeText,
  getLineStart,
  getLineEnd,
  stripQuotes,
};
