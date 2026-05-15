const assert = require('assert');
const { parseVue } = require('../src/services/dep-graph/parsers/vue');

async function testScriptSetup() {
  const source = `
<template>
  <div>{{ msg }}</div>
</template>

<script setup>
import { ref } from 'vue';
export const msg = ref('hello');
</script>
`;
  const result = await parseVue(source);
  assert(result.imports.includes('vue'), 'Should import vue');
  assert(result.exports.includes('msg'), 'Should export msg');
}

// P6: Vue compiler macro re-exports should be filtered from dead-export detection
async function testScriptSetupMacroExportsFiltered() {
  const source = `
<script setup>
import { defineProps, defineEmits, defineExpose } from 'vue';
export { defineProps, defineEmits, defineExpose };
export const helper = 'ok';
</script>
`;
  const result = await parseVue(source, 'Test.vue');
  assert(!result.exports.includes('defineProps'), 'Should filter defineProps export');
  assert(!result.exports.includes('defineEmits'), 'Should filter defineEmits export');
  assert(!result.exports.includes('defineExpose'), 'Should filter defineExpose export');
  assert(result.exports.includes('helper'), 'Should keep non-macro export');
}

async function testScriptSetupMacroDeclarationFiltered() {
  const source = `
<script setup>
export function defineProps(props) { return props; }
export const defineEmits = (emits) => emits;
export const realExport = 1;
</script>
`;
  const result = await parseVue(source, 'Comp.vue');
  assert(!result.exports.includes('defineProps'), 'Should filter defineProps declaration export');
  assert(!result.exports.includes('defineEmits'), 'Should filter defineEmits declaration export');
  assert(result.exports.includes('realExport'), 'Should keep real export');
}

async function testMultipleScripts() {
  const source = `
<script>
import { foo } from './foo';
</script>

<script setup>
export const bar = 1;
</script>
`;
  const result = await parseVue(source);
  assert(result.imports.includes('./foo'), 'Should import from ./foo');
  assert(result.exports.includes('bar'), 'Should export bar');
}

async function testNoScript() {
  const result = await parseVue('<template><div>hi</div></template>');
  assert.deepStrictEqual(result.imports, []);
  assert.deepStrictEqual(result.exports, []);
  assert.deepStrictEqual(result.importRecords, []);
  assert.deepStrictEqual(result.exportRecords, []);
  assert.deepStrictEqual(result.functionRecords, []);
  assert.strictEqual(result.parseMode, 'regex');
}

async function testTemplateAndStyleIgnored() {
  const source = `
<template>
  <div>{{ msg }}</div>
</template>

<style scoped>
div { color: red; }
</style>

<script>
import { baz } from './baz';
export const msg = 'hello';
</script>
`;
  const result = await parseVue(source);
  assert(result.imports.includes('./baz'), 'Should import from ./baz');
  assert(result.exports.includes('msg'), 'Should export msg');
  assert(!result.imports.some(i => i.includes('color')), 'Should not pick up style content as imports');
}

(async () => {
  await testScriptSetup();
  await testScriptSetupMacroExportsFiltered();
  await testScriptSetupMacroDeclarationFiltered();
  await testMultipleScripts();
  await testNoScript();
  await testTemplateAndStyleIgnored();
  console.log('vue-parser-test: OK');
})();
