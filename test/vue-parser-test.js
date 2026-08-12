// @contract
const assert = require('assert');
const { parseVue } = require('../src/services/dep-graph/parsers/vue');
const { parseVueAst } = require('../src/services/dep-graph/parsers/vue-ast');

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
  const result = await parseVueAst(source);
  assert(result.imports.includes('vue'), 'Should import vue');
  assert(result.exports.includes('msg'), 'Should export msg');
  assert.strictEqual(result.parseMode, 'ast', 'Should use AST parse mode');
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
  const result = await parseVueAst(source, 'Test.vue');
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
  const result = await parseVueAst(source, 'Comp.vue');
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
  const result = await parseVueAst(source);
  assert(result.imports.includes('./foo'), 'Should import from ./foo');
  assert(result.exports.includes('bar'), 'Should export bar');
}

async function testNoScript() {
  const result = await parseVueAst('<template><div>hi</div></template>');
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
  const result = await parseVueAst(source);
  assert(result.imports.includes('./baz'), 'Should import from ./baz');
  assert(result.exports.includes('msg'), 'Should export msg');
  assert(!result.imports.some(i => i.includes('color')), 'Should not pick up style content as imports');
}

async function testTypeScriptScriptBlock() {
  const source = `
<script setup lang="ts">
import { ref } from 'vue';
const count = ref<number>(0);
export { count };
</script>
`;
  const result = await parseVueAst(source, 'Comp.vue');
  assert(result.imports.includes('vue'), 'Should import vue');
  assert.strictEqual(result.parseMode, 'ast', 'TS script block should be AST parsed');
}

async function testTemplateComponentUsageCreatesRecord() {
  const source = `
<template>
  <div>
    <MyComponent :foo="bar" />
  </div>
</template>

<script setup>
import MyComponent from './MyComponent.vue';
</script>
`;
  const result = await parseVueAst(source, 'App.vue');
  assert(result.imports.includes('./MyComponent.vue'), 'Should import MyComponent.vue');
  const templateRecords = result.importRecords.filter((r) => r.isTemplateUsage);
  assert.strictEqual(templateRecords.length, 1, 'Should create one template usage record');
  assert.strictEqual(templateRecords[0].source, './MyComponent.vue');
  assert.deepStrictEqual(templateRecords[0].imported, ['default']);
  assert.strictEqual(templateRecords[0].usedComponentName, 'MyComponent');
}

async function testTemplateDynamicComponentUsage() {
  const source = `
<template>
  <component :is="DynamicComp" />
</template>

<script setup>
import { DynamicComp } from './dynamic';
</script>
`;
  const result = await parseVueAst(source, 'App.vue');
  const templateRecords = result.importRecords.filter((r) => r.isTemplateUsage);
  assert.strictEqual(templateRecords.length, 1, 'Should create one template usage record for :is');
  assert.strictEqual(templateRecords[0].source, './dynamic');
  assert.deepStrictEqual(templateRecords[0].imported, ['DynamicComp']);
  assert.strictEqual(templateRecords[0].usedComponentName, 'DynamicComp');
}

async function testTemplateNativeTagsDoNotCreateRecords() {
  const source = `
<template>
  <div>
    <span>text</span>
    <component :is="'literal'" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
const msg = ref('hi');
</script>
`;
  const result = await parseVueAst(source, 'App.vue');
  const templateRecords = result.importRecords.filter((r) => r.isTemplateUsage);
  assert.strictEqual(templateRecords.length, 0, 'Native tags and literal :is should not create records');
}

async function testTemplateUnimportedComponentDoesNotCreateRecord() {
  const source = `
<template>
  <div>
    <UnimportedComponent />
  </div>
</template>

<script setup>
import { ref } from 'vue';
const msg = ref('hi');
</script>
`;
  const result = await parseVueAst(source, 'App.vue');
  const templateRecords = result.importRecords.filter((r) => r.isTemplateUsage);
  assert.strictEqual(templateRecords.length, 0, 'Unimported component should not create record');
}

async function testLegacyParserStillWorksAsFallback() {
  const source = `
<template>
  <div>{{ msg }}</div>
</template>

<script setup>
import { ref } from 'vue';
export const msg = ref('hello');
</script>
`;
  const result = await parseVue(source, 'App.vue');
  assert(result.imports.includes('vue'), 'Legacy parser should still import vue');
  assert(result.exports.includes('msg'), 'Legacy parser should still export msg');
}

(async () => {
  await testScriptSetup();
  await testScriptSetupMacroExportsFiltered();
  await testScriptSetupMacroDeclarationFiltered();
  await testMultipleScripts();
  await testNoScript();
  await testTemplateAndStyleIgnored();
  await testTypeScriptScriptBlock();
  await testTemplateComponentUsageCreatesRecord();
  await testTemplateDynamicComponentUsage();
  await testTemplateNativeTagsDoNotCreateRecords();
  await testTemplateUnimportedComponentDoesNotCreateRecord();
  await testLegacyParserStillWorksAsFallback();
})();
