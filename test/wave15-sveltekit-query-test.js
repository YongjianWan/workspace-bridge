// @contract — SvelteKit route extraction: HTTP method exports in server files
const assert = require('assert');
const frameworkPatterns = require('../src/services/dep-graph/framework-patterns');
const { patchExtractRoutesWithQuery } = require('./test-helpers');
const sveltekitQuery = require('../src/services/dep-graph/queries/route-extraction/js-sveltekit');

patchExtractRoutesWithQuery(frameworkPatterns, sveltekitQuery, '.ts');

async function testSvelteKitServerMethods() {
  const content = `
    export const GET = async ({ request }) => {
      return new Response(JSON.stringify({ ok: true }));
    };
    export const POST = async ({ request }) => {
      return new Response(JSON.stringify({ created: true }));
    };
  `;

  const routes = await frameworkPatterns.extractRoutes('/project/src/routes/api/users/+server.ts', content);
  assert(routes.length >= 2, `expected at least 2 routes, got ${routes.length}`);
  const methods = routes.map((r) => r.method);
  assert(methods.includes('GET'), 'should extract GET');
  assert(methods.includes('POST'), 'should extract POST');
  assert(routes.every((r) => r.framework === 'sveltekit'), 'all routes should be sveltekit');
  assert(routes.every((r) => r.path === ''), 'SvelteKit path is directory-layout derived');
}

async function testSvelteKitFunctionExport() {
  const content = `
    export function GET() {
      return new Response('hello');
    }
  `;

  const routes = await frameworkPatterns.extractRoutes('/project/src/routes/hello/+server.ts', content);
  assert.strictEqual(routes.length, 1, 'should extract function export route');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].framework, 'sveltekit');
}

async function testSvelteKitAllMethods() {
  const content = `
    export const GET = () => {};
    export const POST = () => {};
    export const PUT = () => {};
    export const DELETE = () => {};
    export const PATCH = () => {};
  `;

  const routes = await frameworkPatterns.extractRoutes('/project/src/routes/all/+server.ts', content);
  const methods = routes.map((r) => r.method).sort();
  assert.deepStrictEqual(methods, ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'], 'should extract all supported methods');
}

async function testSvelteKitNoRoutes() {
  const content = 'export const load = async () => ({ data: [] });';
  const routes = await frameworkPatterns.extractRoutes('/project/src/routes/page/+page.ts', content);
  assert.strictEqual(routes.length, 0, 'load export should not be treated as route');
}

async function testSvelteKitNoCrossFrameworkPollution() {
  const content = `
    app.get('/express-route', handler);
  `;
  const routes = await frameworkPatterns.extractRoutes('/project/app.ts', content);
  const sveltekitRoutes = routes.filter((r) => r.framework === 'sveltekit');
  assert.strictEqual(sveltekitRoutes.length, 0, 'Express patterns should not match SvelteKit');
  const expressRoutes = routes.filter((r) => r.framework === 'express');
  assert(expressRoutes.length > 0, 'Express routes should still be extracted');
}

async function main() {
  await testSvelteKitServerMethods();
  await testSvelteKitFunctionExport();
  await testSvelteKitAllMethods();
  await testSvelteKitNoRoutes();
  await testSvelteKitNoCrossFrameworkPollution();
  console.log('PASS: wave15-sveltekit-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
