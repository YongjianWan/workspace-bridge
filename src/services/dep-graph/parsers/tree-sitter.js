const path = require('path');

let parserModule = null;
const languageCache = new Map();

async function getParserModule() {
  if (parserModule) return parserModule;
  try {
    const mod = require('web-tree-sitter');
    await mod.Parser.init();
    parserModule = mod;
    return mod;
  } catch {
    return null;
  }
}

function isTreeSitterAvailable() {
  return parserModule !== null;
}

async function loadLanguage(langName) {
  if (languageCache.has(langName)) return languageCache.get(langName);
  const mod = await getParserModule();
  if (!mod) return null;
  try {
    const pkgJson = require.resolve('tree-sitter-wasms/package.json');
    const wasmPath = path.join(path.dirname(pkgJson), 'out', `tree-sitter-${langName}.wasm`);
    const lang = await mod.Language.load(wasmPath);
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

function getChildByType(node, type) {
  if (!node || !node.children) return null;
  for (const child of node.children) {
    if (child.type === type) return child;
  }
  return null;
}

function getChildrenByType(node, type) {
  if (!node || !node.children) return [];
  return node.children.filter((c) => c.type === type);
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
  isTreeSitterAvailable,
  loadLanguage,
  getNodeText,
  getChildByType,
  getChildrenByType,
  getLineStart,
  getLineEnd,
  stripQuotes,
};
