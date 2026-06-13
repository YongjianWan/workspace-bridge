// @contract — Nuxt 3 route extraction: definePageMeta paths + Nitro event handlers
const assert = require('assert');
const frameworkPatterns = require('../src/services/dep-graph/framework-patterns');
const { patchExtractRoutesWithQuery } = require('./test-helpers');
const nuxtQuery = require('../src/services/dep-graph/queries/route-extraction/js-nuxt');

patchExtractRoutesWithQuery(frameworkPatterns, nuxtQuery, '.ts');

async function testNuxtEventHandler() {
  const content = `
    export default defineEventHandler(async (event) => {
      return { ok: true };
    });
  `;

  const routes = await frameworkPatterns.extractRoutes('/project/server/api/users.ts', content);
  assert(routes.length > 0, 'should detect Nuxt event handler');
  const nuxtRoutes = routes.filter((r) => r.framework === 'nuxt');
  assert(nuxtRoutes.length > 0, 'should emit Nuxt routes');
  assert(nuxtRoutes.some((r) => r.method === 'ALL'), 'should emit ALL method for event handler');
  assert(nuxtRoutes.every((r) => r.path === ''), 'event handler path is content-unavailable');
}

async function testNuxtEventHandlerAlias() {
  const content = `
    export default eventHandler((event) => {
      return { ok: true };
    });
  `;

  const routes = await frameworkPatterns.extractRoutes('/project/server/api/items.ts', content);
  assert(routes.some((r) => r.framework === 'nuxt' && r.method === 'ALL'), 'should detect eventHandler alias');
}

async function testNuxtPageMetaPath() {
  const content = `
    definePageMeta({
      path: '/custom-page',
      middleware: 'auth',
    });
  `;

  const routes = await frameworkPatterns.extractRoutes('/project/pages/custom.ts', content);
  assert.strictEqual(routes.length, 1, 'should extract one definePageMeta route');
  assert.strictEqual(routes[0].method, 'ALL');
  assert.strictEqual(routes[0].path, '/custom-page');
  assert.strictEqual(routes[0].framework, 'nuxt');
}

async function testNuxtNoVueFileRoutes() {
  // .vue files map to the 'vue' tree-sitter language, which treats script
  // content as raw_text; Nuxt route extraction currently focuses on .ts files.
  const content = `
    <script setup>
    definePageMeta({ path: '/vue-page' });
    </script>
  `;
  const routes = await frameworkPatterns.extractRoutes('/project/pages/vue-page.vue', content);
  assert.strictEqual(routes.length, 0, 'Vue SFC should not yet extract Nuxt routes');
}

async function testNuxtNoRoutes() {
  const content = 'function add(a, b) { return a + b; }';
  const routes = await frameworkPatterns.extractRoutes('/project/utils.ts', content);
  assert.strictEqual(routes.length, 0, 'plain TS file should have no Nuxt routes');
}

async function testNuxtDedupe() {
  const content = `
    definePageMeta({ path: '/dup' });
    definePageMeta({ path: '/dup' });
  `;
  const routes = await frameworkPatterns.extractRoutes('/project/pages/dup.ts', content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical definePageMeta routes');
}

async function main() {
  await testNuxtEventHandler();
  await testNuxtEventHandlerAlias();
  await testNuxtPageMetaPath();
  await testNuxtNoVueFileRoutes();
  await testNuxtNoRoutes();
  await testNuxtDedupe();
  console.log('PASS: wave15-nuxt-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
