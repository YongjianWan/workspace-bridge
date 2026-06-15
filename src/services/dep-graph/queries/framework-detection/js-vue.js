/**
 * Vue framework detection query — tree-sitter query for content-based detection.
 * Matches: defineProps / defineEmits / createApp / defineComponent / import from 'vue'
 * Grammar: TypeScript (tree-sitter-typescript).
 */

const QUERY = `
[
  (import_statement source: (string) @source)
  (call_expression function: (identifier) @func)
]
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  for (const match of matches) {
    const source = match.source?.text;
    const func = match.func?.text;

    if (source && /['"](vue|vue-router|pinia)['"]/.test(source)) {
      return {
        framework: 'vue',
        reason: 'vue-script',
        isEntry: false,
      };
    }
    if (
      func &&
      /^(defineProps|defineEmits|defineExpose|defineOptions|defineSlots|defineModel|createApp|defineComponent)$/.test(func)
    ) {
      const isEntry = func === 'createApp';
      return {
        framework: 'vue',
        reason: isEntry ? 'vue-script' : 'vue-script-setup-macro',
        isEntry,
        entryPointWeight: isEntry ? 2.0 : undefined,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'typescript',
  framework: 'vue',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
