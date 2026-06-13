// @contract — Django route extraction: URLconf query semantics
const assert = require('assert');
const { compileQuery, runQuery } = require('../src/services/dep-graph/query-compiler');
const { getParserModule, loadLanguage } = require('../src/services/dep-graph/parsers/tree-sitter');
const djangoQuery = require('../src/services/dep-graph/queries/route-extraction/py-django');

async function runQueryRoutes(queryModule, content) {
  const mod = await getParserModule();
  if (!mod) throw new Error('tree-sitter WASM unavailable');
  const lang = await loadLanguage(queryModule.language);
  if (!lang) throw new Error(`language ${queryModule.language} unavailable`);

  const parser = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const compiled = await compileQuery(queryModule.language, queryModule.query);
  if (!compiled) throw new Error('query compilation failed');

  const matches = runQuery(tree, compiled);
  const routes = queryModule.postProcess(matches || []);

  tree.delete();
  parser.delete();
  return routes;
}

async function testDjangoPathRoutes() {
  const content = `
from django.urls import path
from . import views

urlpatterns = [
    path('users/', views.users),
    path('users/<int:pk>', views.user_detail),
    path('items/', views.ItemList.as_view()),
]
`;
  const routes = await runQueryRoutes(djangoQuery, content);
  const paths = routes.map((r) => r.path);
  assert.strictEqual(routes.length, 3, `expected 3 routes, got ${routes.length}`);
  assert(paths.includes('users/'), 'should extract path users/');
  assert(paths.includes('users/<int:pk>'), 'should extract path users/<int:pk>');
  assert(paths.includes('items/'), 'should extract path items/');
  assert(routes.every((r) => r.method === 'ALL' && r.framework === 'django'));
}

async function testDjangoRePathRoutes() {
  const content = `
from django.urls import re_path
from . import views

urlpatterns = [
    re_path(r'^orders/(?P<id>\\d+)/$', views.orders),
    re_path(r'^legacy/(?P<slug>[\\w-]+)/$', views.legacy),
]
`;
  const routes = await runQueryRoutes(djangoQuery, content);
  const paths = routes.map((r) => r.path);
  assert.strictEqual(routes.length, 2, `expected 2 routes, got ${routes.length}`);
  assert(paths.includes('^orders/(?P<id>\\d+)/$'), 'should extract raw regex route');
  assert(paths.includes('^legacy/(?P<slug>[\\w-]+)/$'), 'should extract raw regex route');
}

async function testDjangoMixedPathAndRePath() {
  const content = `
from django.urls import path, re_path
from . import views

urlpatterns = [
    path('users/', views.users),
    re_path(r'^orders/$', views.orders),
]
`;
  const routes = await runQueryRoutes(djangoQuery, content);
  const paths = routes.map((r) => r.path);
  assert.strictEqual(routes.length, 2, `expected 2 routes, got ${routes.length}`);
  assert(paths.includes('users/'), 'should extract path route');
  assert(paths.includes('^orders/$'), 'should extract re_path route');
}

async function testDjangoOnlyMatchesUrlPatterns() {
  const content = `
other_list = [
    path('users/', views.users),
]
`;
  const routes = await runQueryRoutes(djangoQuery, content);
  assert.strictEqual(routes.length, 0, 'should ignore non-urlpatterns assignments');
}

async function testDjangoDedupe() {
  const content = `
from django.urls import path
from . import views

urlpatterns = [
    path('users/', views.users_a),
    path('users/', views.users_b),
]
`;
  const routes = await runQueryRoutes(djangoQuery, content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical Django routes');
}

async function testDjangoNoRoutesInPlainFile() {
  const content = `
def helper():
    pass
`;
  const routes = await runQueryRoutes(djangoQuery, content);
  assert.strictEqual(routes.length, 0, 'plain Python file should have no routes');
}

async function main() {
  await testDjangoPathRoutes();
  await testDjangoRePathRoutes();
  await testDjangoMixedPathAndRePath();
  await testDjangoOnlyMatchesUrlPatterns();
  await testDjangoDedupe();
  await testDjangoNoRoutesInPlainFile();
  console.log('PASS: wave15-django-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
