const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCli, makeTempDir, cleanupTempDir } = require('./test-helpers');
const {
  FRAMEWORK_USAGE_PATTERNS,
  scanAndExtractImplicitImports,
  resolveImplicitImports,
  buildImplicitImportRecord,
} = require('../src/services/dep-graph/framework-usage-patterns');

// --- scanAndExtractImplicitImports ---

function testVueRouterLazy() {
  const routerContent = `
    const routes = [
      { path: '/user', component: () => import('@/views/UserProfile') },
      { path: '/admin', component: () => import('@/views/AdminDashboard') },
    ];
  `;
  const results = scanAndExtractImplicitImports('/project/src/router/index.js', routerContent);
  assert.strictEqual(results.length, 2, 'should extract 2 lazy imports');
  assert.strictEqual(results[0].source, '@/views/UserProfile');
  assert.strictEqual(results[0].patternId, 'vue-router-lazy');
  assert.strictEqual(results[1].source, '@/views/AdminDashboard');

  // Scanner should match by path even without lazy syntax
  const plainContent = 'const routes = [];';
  const pathResults = scanAndExtractImplicitImports('/project/src/router/index.js', plainContent);
  assert.strictEqual(pathResults.length, 0, 'path-based scanner should not false-positive without syntax');
}

function testVueRouterLazyFunctionSyntax() {
  const content = `
    { path: '/x', component: function() { return import('@/views/X'); } }
  `;
  const results = scanAndExtractImplicitImports('/project/src/router/index.js', content);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].source, '@/views/X');
}

function testVueGlobalComponent() {
  const mainContent = `
    Vue.component('SvgIcon', SvgIcon);
    Vue.component('Breadcrumb', Breadcrumb);
  `;
  const results = scanAndExtractImplicitImports('/project/src/main.js', mainContent);
  assert.strictEqual(results.length, 4, 'should extract 2 components × 2 path candidates');
  assert(results.some((r) => r.source === '@/components/SvgIcon/index'));
  assert(results.some((r) => r.source === '@/components/SvgIcon'));
  assert(results.some((r) => r.source === '@/components/Breadcrumb/index'));
  assert(results.some((r) => r.source === '@/components/Breadcrumb'));
  assert.strictEqual(results[0].patternId, 'vue-global-component');
}

function testNoMatch() {
  const content = 'const a = 1;';
  const results = scanAndExtractImplicitImports('/project/src/utils.js', content);
  assert.strictEqual(results.length, 0);
}

function testNonJsExtensionSkipped() {
  const content = "Vue.component('X', X);";
  const results = scanAndExtractImplicitImports('/project/src/styles.css', content);
  assert.strictEqual(results.length, 0, 'non-JS extensions should be skipped');
}

function testVueCustomDirective() {
  const content = "Vue.directive('focus', {}); Vue.directive('hasPermi', hasPermiDirective);";
  const results = scanAndExtractImplicitImports('/project/src/main.js', content);
  assert(results.some((r) => r.source === '@/directive/focus/index'), 'should map focus directive');
  assert(results.some((r) => r.source === '@/directive/hasPermi/index'), 'should map hasPermi directive');
  assert(results.every((r) => r.patternId === 'vue-custom-directive'));
}

function testDynamicStringCall() {
  const content = `
    const actions = ['fetchUser', 'deletePost'];
    actions.forEach(action => window[action]());
  `;
  const results = scanAndExtractImplicitImports('/project/src/utils/api.js', content);
  assert(results.some((r) => r.source === './fetchUser'), 'should extract fetchUser');
  assert(results.some((r) => r.source === './deletePost'), 'should extract deletePost');
  assert(results.every((r) => r.patternId === 'dynamic-string-call'));
}

function testDynamicStringCallLiteral() {
  const content = "window['refreshData'](); this['clearCache']();";
  const results = scanAndExtractImplicitImports('/project/src/app.js', content);
  assert(results.some((r) => r.source === './refreshData'), 'should extract refreshData');
  assert(results.some((r) => r.source === './clearCache'), 'should extract clearCache');
}

// --- resolveImplicitImports ---

function testResolveImplicitImports() {
  const tmpDir = path.join(__dirname, '..', 'fixture-temp-framework');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'views'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'views', 'UserProfile.vue'), '<template></template>');

  const sources = [{ source: '@/views/UserProfile', patternId: 'vue-router-lazy' }];
  const resolved = resolveImplicitImports(
    path.join(tmpDir, 'src', 'router', 'index.js'),
    sources,
    tmpDir
  );
  assert.strictEqual(resolved.length, 1);
  assert(resolved[0].resolved.includes('UserProfile.vue'));
  assert.strictEqual(resolved[0].patternId, 'vue-router-lazy');

  // Cleanup
  cleanupTempDir(tmpDir);
}

function testResolveImplicitImportsMissingFile() {
  const tmpDir = path.join(__dirname, '..', 'fixture-temp-framework-missing');
  fs.mkdirSync(tmpDir, { recursive: true });

  const sources = [{ source: '@/views/NonExistent', patternId: 'vue-router-lazy' }];
  const resolved = resolveImplicitImports(
    path.join(tmpDir, 'src', 'router', 'index.js'),
    sources,
    tmpDir
  );
  assert.strictEqual(resolved.length, 0, 'missing file should not resolve');

  cleanupTempDir(tmpDir);
}

// --- buildImplicitImportRecord ---

function testBuildImplicitImportRecord() {
  const record = buildImplicitImportRecord('@/views/Home', '/project/src/views/Home.vue', 'vue-router-lazy');
  assert.strictEqual(record.source, '@/views/Home');
  assert.strictEqual(record.resolved, '/project/src/views/Home.vue');
  assert.strictEqual(record.usesAllExports, true);
  assert.strictEqual(record.isImplicit, true);
  assert.strictEqual(record.patternId, 'vue-router-lazy');
  assert.deepStrictEqual(record.imported, []);
}

// --- FRAMEWORK_USAGE_PATTERNS registry ---

function testPatternRegistry() {
  assert(FRAMEWORK_USAGE_PATTERNS.length >= 4, 'should have at least 4 patterns');
  const ids = FRAMEWORK_USAGE_PATTERNS.map((p) => p.id);
  assert(ids.includes('vue-router-lazy'));
  assert(ids.includes('vue-global-component'));
  assert(ids.includes('vue-custom-directive'));
  assert(ids.includes('dynamic-string-call'));
}

// --- Integration test: end-to-end orphan / dead-export elimination ---

async function testVueImplicitDependenciesIntegration() {
  const root = makeTempDir('wb-vue-implicit-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('package.json', JSON.stringify({ name: 'vue-implicit-test', version: '1.0.0' }, null, 2));
    write('src/router/index.js', `
      const routes = [
        { path: '/user', component: () => import('@/views/UserProfile') },
        { path: '/admin', component: () => import('@/views/AdminDashboard') },
      ];
      export default routes;
    `);
    write('src/views/UserProfile.vue', '<template><div>User</div></template>\n<script>export default { name: "UserProfile" }</script>');
    write('src/views/AdminDashboard.vue', '<template><div>Admin</div></template>\n<script>export default { name: "AdminDashboard" }</script>');
    write('src/main.js', `
      import Vue from 'vue';
      import SvgIcon from '@/components/SvgIcon';
      Vue.component('SvgIcon', SvgIcon);
      new Vue({ el: '#app' });
    `);
    write('src/components/SvgIcon/index.vue', '<template><svg></svg></template>\n<script>export default { name: "SvgIcon" }</script>');

    // 1. Verify dead-exports: view components should NOT appear (they are implicitly used by router)
    const deadExports = runCli(['dead-exports', '--cwd', root, '--json', '--quiet'], { cwd: root });
    const deadFiles = deadExports.deadExports.map((d) => path.basename(d.file));
    assert(!deadFiles.includes('UserProfile.vue'), 'UserProfile should not be dead-export (router lazy-load)');
    assert(!deadFiles.includes('AdminDashboard.vue'), 'AdminDashboard should not be dead-export (router lazy-load)');
    assert(!deadFiles.includes('index.vue'), 'SvgIcon should not be dead-export (global component)');

    // 2. Verify orphans via audit-map compact
    const auditMap = runCli(['audit-map', '--cwd', root, '--compact', '--json', '--quiet'], { cwd: root });
    const orphanFiles = (auditMap.issueOverlay?.orphans || []).map((f) => path.basename(f));
    assert(!orphanFiles.includes('UserProfile.vue'), 'UserProfile should not be orphan (router implicit dep)');
    assert(!orphanFiles.includes('AdminDashboard.vue'), 'AdminDashboard should not be orphan (router implicit dep)');
    assert(!orphanFiles.includes('index.vue'), 'SvgIcon should not be orphan (global component implicit dep)');

    // 3. Verify impact radius includes implicit dependents
    const impact = runCli(['impact', '--cwd', root, '--file', 'src/views/UserProfile.vue', '--json', '--quiet'], { cwd: root });
    const impactedFiles = impact.impact.map((i) => path.basename(i.file));
    assert(impactedFiles.includes('index.js'), 'router should appear in impact radius of UserProfile');
  } finally {
    cleanupTempDir(root);
  }
}

// --- Runner ---

function testReactLazy() {
  const content = `
    const UserProfile = React.lazy(() => import('./UserProfile'));
    const AdminDashboard = lazy(() => import('./AdminDashboard'));
  `;
  const results = scanAndExtractImplicitImports('/project/src/App.jsx', content);
  assert.strictEqual(results.length, 2, 'should extract 2 React.lazy imports');
  assert(results.some((r) => r.source === './UserProfile'), 'should extract UserProfile');
  assert(results.some((r) => r.source === './AdminDashboard'), 'should extract AdminDashboard');
  assert(results.every((r) => r.patternId === 'react-lazy'));
}

function testNextjsDynamic() {
  const content = `
    const DynamicComponent = dynamic(() => import('./DynamicComponent'));
  `;
  const results = scanAndExtractImplicitImports('/project/src/pages/index.tsx', content);
  assert.strictEqual(results.length, 1, 'should extract 1 Next.js dynamic import');
  assert.strictEqual(results[0].source, './DynamicComponent');
  assert.strictEqual(results[0].patternId, 'nextjs-dynamic');
}

function testAngularLoadChildren() {
  const content = `
    const routes = [
      { path: 'admin', loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule) }
    ];
  `;
  const results = scanAndExtractImplicitImports('/project/src/app/app-routing.module.ts', content);
  assert.strictEqual(results.length, 1, 'should extract 1 Angular loadChildren import');
  assert.strictEqual(results[0].source, './admin/admin.module');
  assert.strictEqual(results[0].patternId, 'angular-loadchildren');
}

async function run() {
  testVueRouterLazy();
  testVueRouterLazyFunctionSyntax();
  testVueGlobalComponent();
  testNoMatch();
  testNonJsExtensionSkipped();
  testVueCustomDirective();
  testDynamicStringCall();
  testDynamicStringCallLiteral();
  testReactLazy();
  testNextjsDynamic();
  testAngularLoadChildren();
  testResolveImplicitImports();
  testResolveImplicitImportsMissingFile();
  testBuildImplicitImportRecord();
  testPatternRegistry();
  await testVueImplicitDependenciesIntegration();
  }

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
