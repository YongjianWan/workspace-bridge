const path = require('path');

let parserModule = null;
const languageCache = new Map();
const MAX_LANGUAGE_CACHE_SIZE = 12; // defensive cap: 9 langs + headroom

async function getParserModule() {
  if (parserModule) return parserModule;
  try {
    if (process.env.FORCE_WASM_FAIL) {
      throw new Error('Simulated WASM WASI cold start failure');
    }
    const mod = require('web-tree-sitter');
    await mod.Parser.init();
    parserModule = mod;
    return mod;
  } catch {
    return null;
  }
}

async function loadLanguage(langName) {
  if (languageCache.has(langName)) return languageCache.get(langName);
  const mod = await getParserModule();
  if (!mod) return null;
  try {
    const pkgJson = require.resolve('tree-sitter-wasms/package.json');
    const wasmPath = path.join(path.dirname(pkgJson), 'out', `tree-sitter-${langName}.wasm`);
    const lang = await mod.Language.load(wasmPath);
    // Defensive LRU-like eviction: if cache exceeds cap, drop oldest entry
    if (languageCache.size >= MAX_LANGUAGE_CACHE_SIZE) {
      const firstKey = languageCache.keys().next().value;
      if (firstKey !== undefined) {
        const oldLang = languageCache.get(firstKey);
        languageCache.delete(firstKey);
        try { oldLang.delete(); } catch {}
      }
    }
    languageCache.set(langName, lang);
    return lang;
  } catch {
    return null;
  }
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
