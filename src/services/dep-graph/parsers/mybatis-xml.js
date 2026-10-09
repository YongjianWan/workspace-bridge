/**
 * MyBatis mapper XML — regex-designed parser (no tree-sitter).
 *
 * Emits the class references a mapper XML declares as import records so
 * XML→class edges flow through the normal resolveImport chain:
 *  - `namespace` on <mapper> (the bound Mapper interface FQCN) →
 *    importKind 'mybatis-namespace';
 *  - `resultType` / `parameterType` on any element and `type` on
 *    <resultMap> (entity/result classes) → importKind 'mybatis-type'.
 * The reverse interface→XML edge is derived at graph build time
 * (builder.js derive-mybatis-reverse-edges) and must never enter
 * parse_results — this parser only produces pure parse output.
 *
 * parseMode 'regex' + parseModeReason 'regex-designed': regex is this
 * parser's designed path, not a degraded fallback, so the parse cache
 * trusts these entries (builder.js _isParseCacheUsable rejects only
 * 'regex-fallback').
 */
const { createImportRecord } = require('./shared');

const NAMESPACE_IMPORT_KIND = 'mybatis-namespace';
const TYPE_IMPORT_KIND = 'mybatis-type';

// Module scope, not per-call (L2-6): every parse reuses the same patterns.
const MAPPER_OPEN_TAG = /<mapper\b[^>]*>/i;
const NAMESPACE_ATTR = /\bnamespace\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const TYPE_ATTR = /\b(?:resultType|parameterType)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const RESULT_MAP_TAG = /<resultMap\b[^>]*>/gi;
const RESULT_MAP_TYPE_ATTR = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

// Discovery口径 lives in project-context (layer 0) so file-index (L1) can
// consume it without importing up into parsers (L2.5 — layering-test).
// Re-exported from here for parser-side consumers.
const { isMybatisMapperXmlPath } = require('../../../utils/project-context');

function emptyResult() {
  return {
    imports: [],
    exports: [],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'regex',
    parseModeReason: 'regex-designed',
  };
}

function attrValue(match) {
  const raw = match ? (match[1] ?? match[2]) : '';
  return raw ? raw.trim() : '';
}

function parseMybatisXml(content, filePath = '') {
  // Defensive double gate: a non-mapper path or a non-mapper root element
  // yields the empty result, never guessed edges (L1-4).
  if (filePath && !isMybatisMapperXmlPath(filePath)) return emptyResult();
  const text = String(content || '');
  const openTag = text.match(MAPPER_OPEN_TAG);
  if (!openTag) return emptyResult();

  const records = [];
  const sources = [];
  const seen = new Set();
  const push = (value, importKind) => {
    if (!value) return;
    const key = `${importKind}\u0000${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(value);
    records.push(createImportRecord(value, { importKind }));
  };

  push(attrValue(openTag[0].match(NAMESPACE_ATTR)), NAMESPACE_IMPORT_KIND);

  TYPE_ATTR.lastIndex = 0;
  let match;
  while ((match = TYPE_ATTR.exec(text)) !== null) {
    push(attrValue(match), TYPE_IMPORT_KIND);
  }

  RESULT_MAP_TAG.lastIndex = 0;
  while ((match = RESULT_MAP_TAG.exec(text)) !== null) {
    push(attrValue(match[0].match(RESULT_MAP_TYPE_ATTR)), TYPE_IMPORT_KIND);
  }

  return {
    imports: sources,
    exports: [],
    importRecords: records,
    exportRecords: [],
    functionRecords: [],
    parseMode: 'regex',
    parseModeReason: 'regex-designed',
  };
}

module.exports = { parseMybatisXml, isMybatisMapperXmlPath, NAMESPACE_IMPORT_KIND, TYPE_IMPORT_KIND };
