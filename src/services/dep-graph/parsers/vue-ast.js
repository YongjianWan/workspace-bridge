/**
 * Vue SFC parser — tree-sitter-vue WASM in-process path (L3-7).
 *
 * Replaces the regex-based script extraction in vue.js. Parses the full SFC
 * AST so that:
 *   - script blocks are extracted robustly (no </script> string pitfalls);
 *   - <script lang="ts"> is detected and passed to the JS/TS parser;
 *   - template component references are extracted as template-usage importRecords.
 *
 * Template component refs are intentionally conservative: a PascalCase tag is
 * only recorded when it matches a local import binding from the script block.
 * This avoids fabricating edges for global components, HTML custom elements,
 * or auto-imports we cannot statically resolve.
 */

const { parseJavaScript } = require('./js');
const { babelParser } = require('./js/shared');
const {
  getParserModule,
  loadLanguage,
  getNodeText,
} = require('./tree-sitter');
const { createImportRecord } = require('./shared');

const VUE_BUILT_IN_TAGS = new Set([
  'component',
  'slot',
  'template',
  'transition',
  'keep-alive',
  'teleport',
  'suspense',
  'Component',
  'Slot',
  'Template',
  'Transition',
  'KeepAlive',
  'Teleport',
  'Suspense',
]);

const HTML_TAG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CUSTOM_ELEMENT_RE = /^(?:x-|vue:|data-)/i;

function isComponentTagName(name) {
  if (!name) return false;
  // HTML native tags and custom elements are not Vue components.
  if (HTML_TAG_RE.test(name)) return false;
  if (CUSTOM_ELEMENT_RE.test(name)) return false;
  if (VUE_BUILT_IN_TAGS.has(name)) return false;
  // PascalCase is the conventional indicator for a Vue component in template.
  return /^[A-Z]/.test(name);
}

function getStartTagLang(startTagNode) {
  for (let i = 0; i < startTagNode.childCount; i++) {
    const attr = startTagNode.child(i);
    if (attr.type !== 'attribute') continue;
    let attrName = null;
    let attrValue = null;
    for (let j = 0; j < attr.childCount; j++) {
      const part = attr.child(j);
      if (part.type === 'attribute_name') attrName = getNodeText(part);
      else if (part.type === 'quoted_attribute_value') attrValue = getNodeText(part);
    }
    if (attrName === 'lang' && attrValue) {
      return attrValue.replace(/['"]/g, '').trim().toLowerCase();
    }
  }
  return 'js';
}

function collectScriptBlocks(rootNode) {
  const blocks = [];
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (child.type !== 'script_element') continue;
    const startTag = child.children.find((c) => c.type === 'start_tag');
    const rawText = child.children.find((c) => c.type === 'raw_text');
    blocks.push({
      lang: startTag ? getStartTagLang(startTag) : 'js',
      content: rawText ? getNodeText(rawText) : '',
    });
  }
  return blocks;
}

function getDirectiveAttributeValue(startOrSelfClosingTag, directiveName) {
  for (let i = 0; i < startOrSelfClosingTag.childCount; i++) {
    const attr = startOrSelfClosingTag.child(i);
    if (attr.type !== 'directive_attribute') continue;
    let name = null;
    let argument = null;
    let value = null;
    for (let j = 0; j < attr.childCount; j++) {
      const part = attr.child(j);
      if (part.type === 'directive_name') name = getNodeText(part);
      else if (part.type === 'directive_argument') argument = getNodeText(part);
      else if (part.type === 'quoted_attribute_value') value = getNodeText(part);
    }
    if (name === ':' && argument === directiveName && value) {
      // Strip quotes.
      return value.replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return null;
}

function collectTemplateComponentRefs(node, out) {
  if (!node) return;
  if (node.type === 'start_tag' || node.type === 'self_closing_tag') {
    const tagNameNode = node.children.find((c) => c.type === 'tag_name');
    if (tagNameNode) {
      out.push(getNodeText(tagNameNode));
    }
    // Dynamic component: <component :is="DynamicComp" />
    const isValue = getDirectiveAttributeValue(node, 'is');
    if (isValue) out.push(isValue);
  }
  for (let i = 0; i < node.childCount; i++) {
    collectTemplateComponentRefs(node.child(i), out);
  }
}

function extractTemplateComponentNames(rootNode) {
  const names = [];
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (child.type === 'template_element') {
      collectTemplateComponentRefs(child, names);
    }
  }
  return [...new Set(names)];
}

function extractScriptImportBindings(scriptContent, filePath) {
  if (!babelParser) return new Map();
  const ext = filePath.toLowerCase().endsWith('.ts') ? '.ts' : '.js';
  try {
    const ast = babelParser.parse(scriptContent, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        'jsx',
        'dynamicImport',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'importMeta',
        ...(ext === '.ts' ? ['typescript'] : []),
      ],
    });
    const bindings = new Map();
    for (const node of ast.program.body || []) {
      if (node.type !== 'ImportDeclaration' || !node.source?.value) continue;
      const source = node.source.value;
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportDefaultSpecifier') {
          if (spec.local?.name) {
            bindings.set(spec.local.name, { source, importedName: 'default' });
          }
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          if (spec.local?.name) {
            bindings.set(spec.local.name, { source, importedName: '*' });
          }
        } else if (spec.type === 'ImportSpecifier') {
          if (spec.local?.name) {
            const importedName = spec.imported?.name || spec.imported?.value || spec.local.name;
            bindings.set(spec.local.name, { source, importedName });
          }
        }
      }
    }
    return bindings;
  } catch {
    return new Map();
  }
}

function buildTemplateUsageRecords(templateBindings) {
  const records = [];
  for (const [tagName, { source, importedName }] of templateBindings.entries()) {
    const record = createImportRecord(source, { imported: [importedName] });
    record.isTemplateUsage = true;
    record.usedComponentName = tagName;
    records.push(record);
  }
  return records;
}

async function parseVueAst(content, filePath = '') {
  try {
    const mod = await getParserModule();
    if (!mod) return null;
    const lang = await loadLanguage('vue');
    if (!lang) return null;

    const parser = new mod.Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    const rootNode = tree.rootNode;

    const scriptBlocks = collectScriptBlocks(rootNode);
    if (scriptBlocks.length === 0) {
      return {
        imports: [],
        exports: [],
        importRecords: [],
        exportRecords: [],
        functionRecords: [],
        parseMode: 'regex',
      };
    }

    const hasTs = scriptBlocks.some((b) => b.lang === 'ts');
    // The JS parser uses the extension to decide TypeScript plugins.
    const effectivePath = hasTs && filePath.toLowerCase().endsWith('.vue')
      ? `${filePath.slice(0, -4)}.ts`
      : filePath;
    const mergedScript = scriptBlocks.map((b) => b.content).join('\n');

    const baseResult = parseJavaScript(mergedScript, effectivePath);
    if (!baseResult) return null;

    // Extract local import bindings so template tags can be mapped back to sources.
    const importBindings = extractScriptImportBindings(mergedScript, effectivePath);

    // Build template usage records for PascalCase component tags that match imports.
    const templateTagNames = extractTemplateComponentNames(rootNode);
    const usedBindings = new Map();
    for (const tagName of templateTagNames) {
      if (!isComponentTagName(tagName)) continue;
      if (importBindings.has(tagName)) {
        usedBindings.set(tagName, importBindings.get(tagName));
      }
    }
    const templateRecords = buildTemplateUsageRecords(usedBindings);

    // Merge template usage records into the base result.
    const importRecords = [...(baseResult.importRecords || []), ...templateRecords];
    const imports = [...(baseResult.imports || [])];
    for (const record of templateRecords) {
      if (!imports.includes(record.source)) imports.push(record.source);
    }

    return {
      imports,
      exports: baseResult.exports || [],
      importRecords,
      exportRecords: baseResult.exportRecords || [],
      functionRecords: baseResult.functionRecords || [],
      parseMode: baseResult.parseMode || 'ast',
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[vue-ast] parse failed for ${filePath}:`, err.message);
    }
    return null;
  }
}

module.exports = { parseVueAst };
