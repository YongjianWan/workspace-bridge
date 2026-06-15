#!/usr/bin/env node
// @contract
const assert = require('assert');
const { parseSvelte } = require('../src/services/dep-graph/parsers/svelte');

async function testBasicScriptBlock() {
  const source = `<script>
  import { onMount } from 'svelte';
  export let count = 0;

  function increment() {
    count += 1;
  }
</script>

<button on:click={increment}>
  Clicks: {count}
</button>
`;
  const result = parseSvelte(source, 'Counter.svelte');
  assert(result.imports.includes('svelte'), 'Should detect svelte import');
  assert(result.exports.includes('count'), 'Should detect exported prop count');
  assert(result.functionRecords.some(r => r.name === 'increment'), 'Should detect function increment');
  assert(result.importRecords.some(r => r.source === 'svelte' && r.imported.includes('onMount')));
  assert(result.exportRecords.some(r => r.name === 'count'));
}

async function testMultipleScriptBlocks() {
  const source = `<script context="module">
  export const preload = () => {};
</script>

<script>
  import { onMount } from 'svelte';
  export let data;
</script>

<p>{data}</p>
`;
  const result = parseSvelte(source, 'Page.svelte');
  assert(result.imports.includes('svelte'), 'Should detect import from merged scripts');
  assert(result.exports.includes('preload'), 'Should detect preload export from module script');
  assert(result.exports.includes('data'), 'Should detect data export from instance script');
  assert(result.exports.includes('onMount') === false, 'onMount is an import, not an export');
}

async function testNoScriptBlock() {
  const source = `<div>
  <h1>Hello World</h1>
</div>
`;
  const result = parseSvelte(source, 'Static.svelte');
  assert.deepStrictEqual(result.imports, []);
  assert.deepStrictEqual(result.exports, []);
  assert.deepStrictEqual(result.importRecords, []);
  assert.deepStrictEqual(result.exportRecords, []);
  assert.deepStrictEqual(result.functionRecords, []);
  assert.strictEqual(result.parseMode, 'regex');
}

async function testTemplateSyntaxIgnored() {
  const source = `<script>
  import { fade } from 'svelte/transition';
  export let items = [];
</script>

{#if items.length > 0}
  <ul>
    {#each items as item}
      <li transition:fade>{@html item.html}</li>
    {/each}
  </ul>
{:else}
  <p>No items</p>
{/if}
`;
  const result = parseSvelte(source, 'List.svelte');
  assert(result.imports.includes('svelte/transition'), 'Should detect svelte/transition import');
  assert(result.exports.includes('items'), 'Should detect items export');
  assert(!result.imports.includes('item'), 'Template variable item should not be treated as import');
  assert(!result.imports.some(i => i.includes('fade') && i !== 'svelte/transition'), 'fade should only appear as import from svelte/transition');
}

(async () => {
  await testBasicScriptBlock();
  await testMultipleScriptBlocks();
  await testNoScriptBlock();
  await testTemplateSyntaxIgnored();
})();
