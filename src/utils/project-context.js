const fs = require('fs');
const path = require('path');
const { pathExists, readJsonSafe, toPosixPath } = require('./path');

const ROLE_PRIORITY = ['generated', 'archive', 'reference', 'active'];
const DEFAULT_DIRECTORY_HINTS = {
  active: [],
  reference: [
    'reference', 'references', 'example', 'examples', 'sample', 'samples', 'demo', 'demos',
    'benchmark', 'benchmarks', 'e2e', 'fixtures', 'mocks', 'mock', '__mocks__',
  ],
  archive: ['archive', 'archives', 'attic', 'deprecated', 'legacy', 'prototype', 'prototypes'],
  generated: ['dist', 'build', 'coverage', '.next', 'out', 'generated', '.turbo'],
};

// Framework-specific entry files checked before generic config/entry rules.
const FRAMEWORK_ENTRY_FILES = new Set([
  'manage.py',
]);

// P103: Entry-point weight constants (adapted from GitNexus entryPointMultiplier)
const ENTRY_WEIGHT = {
  HIGH: 3.0,        // page, controller, views, main, application
  MEDIUM_HIGH: 2.5, // layout, routes, URLs, handlers
  MEDIUM: 2.0,      // admin, middleware, plugins, api-folder
  LOW: 1.5,         // components, prisma, service
  MINIMAL: 1.0,     // manage.py
};

/**
 * Detect framework from file path patterns.
 * Pure path inference — belongs to project-context layer.
 * @param {string} filePath
 * @returns {{framework: string, reason: string, isEntry: boolean, entryPointWeight?: number} | null}
 */
function detectFrameworkFromPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  let p = normalized.toLowerCase();
  if (!p.startsWith('/')) p = '/' + p;

  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // ========== JAVASCRIPT / TYPESCRIPT ==========
  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs') {
    // Next.js App Router
    if (p.includes('/app/')) {
      if (basename === 'page.tsx' || basename === 'page.ts' || basename === 'page.jsx' || basename === 'page.js') {
        return { framework: 'nextjs-app', reason: 'nextjs-app-page', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
      }
      if (basename === 'layout.tsx' || basename === 'layout.ts' || basename === 'layout.jsx' || basename === 'layout.js') {
        return { framework: 'nextjs-app', reason: 'nextjs-layout', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
      }
      if (basename === 'route.ts' || basename === 'route.js') {
        return { framework: 'nextjs-api', reason: 'nextjs-api-route', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
      }
      if (basename === 'loading.tsx' || basename === 'loading.ts') {
        return { framework: 'nextjs-app', reason: 'nextjs-loading', isEntry: false };
      }
      if (basename === 'error.tsx' || basename === 'error.ts') {
        return { framework: 'nextjs-app', reason: 'nextjs-error', isEntry: false };
      }
    }

    // Next.js Pages Router
    if (p.includes('/pages/') && !p.includes('/_') && !p.includes('/api/')) {
      return { framework: 'nextjs-pages', reason: 'nextjs-page', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (p.includes('/pages/api/')) {
      return { framework: 'nextjs-api', reason: 'nextjs-api-route', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }

    // Express / generic routes & controllers
    if (p.includes('/routes/')) {
      return { framework: 'express', reason: 'routes-folder', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (p.includes('/controllers/')) {
      return { framework: 'mvc', reason: 'controllers-folder', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (p.includes('/handlers/')) {
      return { framework: 'handlers', reason: 'handlers-folder', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }

    // React components (PascalCase filename)
    if ((p.includes('/components/') || p.includes('/views/')) && /^[A-Z]/.test(path.basename(filePath))) {
      return { framework: 'react', reason: 'react-component', isEntry: false };
    }

    // Prisma schema
    if (p.includes('/prisma/') && basename === 'schema.prisma') {
      return { framework: 'prisma', reason: 'prisma-schema', isEntry: false };
    }
  }

  // ========== PYTHON ==========
  if (ext === '.py') {
    if (basename === 'views.py') {
      return { framework: 'django', reason: 'django-views', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (p.includes('/views/') && !basename.startsWith('__')) {
      return { framework: 'django', reason: 'django-views-dir', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (basename.startsWith('views_') && ext === '.py') {
      return { framework: 'django', reason: 'django-views-prefix', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (basename === 'urls.py') {
      return { framework: 'django', reason: 'django-urls', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (basename === 'admin.py') {
      return { framework: 'django', reason: 'django-admin', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'manage.py') {
      return { framework: 'django', reason: 'django-manage', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MINIMAL };
    }
    if (p.includes('/management/commands/')) {
      return { framework: 'django', reason: 'django-management-command', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (basename === 'tasks.py') {
      return { framework: 'django', reason: 'django-tasks', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    // P71: Django configuration-driven entry points
    if (basename === 'middleware.py' || /middleware.*\.py$/.test(basename)) {
      return { framework: 'django', reason: 'django-middleware', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'database_router.py' || /router.*\.py$/.test(basename)) {
      return { framework: 'django', reason: 'django-router', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'context_processors.py') {
      return { framework: 'django', reason: 'django-context-processors', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/templatetags/') && !basename.startsWith('__')) {
      return { framework: 'django', reason: 'django-templatetags', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'forms.py') {
      return { framework: 'django', reason: 'django-forms', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'celery.py') {
      return { framework: 'django', reason: 'django-celery-config', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'signals.py') {
      return { framework: 'django', reason: 'django-signals-file', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    // Django REST framework
    if (basename === 'serializers.py') {
      return { framework: 'django', reason: 'django-rest-serializers', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'viewsets.py') {
      return { framework: 'django', reason: 'django-rest-viewsets', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'permissions.py') {
      return { framework: 'django', reason: 'django-rest-permissions', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'authentication.py') {
      return { framework: 'django', reason: 'django-rest-authentication', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'throttling.py') {
      return { framework: 'django', reason: 'django-rest-throttling', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (
      (p.includes('/routers/') || p.includes('/endpoints/') || p.includes('/routes/')) &&
      !basename.startsWith('__')
    ) {
      return { framework: 'fastapi', reason: 'api-routers', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (p.includes('/api/') && !basename.startsWith('__')) {
      return { framework: 'python-api', reason: 'api-folder', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
  }

  // ========== JAVA ==========
  if (ext === '.java') {
    if (p.includes('/controller/') || p.includes('/controllers/')) {
      return { framework: 'spring', reason: 'spring-controller', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (basename.endsWith('controller.java')) {
      return { framework: 'spring', reason: 'spring-controller-file', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    // Spring Boot application entry classes
    if (basename.endsWith('application.java')) {
      return { framework: 'spring-boot', reason: 'spring-boot-application', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (basename.endsWith('servletinitializer.java')) {
      return { framework: 'spring-boot', reason: 'spring-boot-servlet-initializer', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    // P79: Spring runtime-assembly components (Filter/Wrapper/Validator/Serializer/Interceptor/Listener)
    if (/filter/i.test(basename) || /wrapper/i.test(basename) || /validator/i.test(basename) ||
        /serializer/i.test(basename) || /interceptor/i.test(basename) || /listener/i.test(basename)) {
      return { framework: 'spring', reason: 'spring-component', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    // P80: Quartz scheduler classes
    if (/quartz/i.test(basename)) {
      return { framework: 'quartz', reason: 'quartz-job', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (basename === 'jobinvokeutil.java') {
      return { framework: 'quartz', reason: 'quartz-util', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    // P81: MyBatis TypeHandler
    if (/typehandler/i.test(basename)) {
      return { framework: 'mybatis', reason: 'mybatis-typehandler', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/service/') || p.includes('/services/')) {
      return { framework: 'java-service', reason: 'java-service', isEntry: false };
    }
    if (p.includes('/repository/') || p.includes('/repositories/')) {
      return { framework: 'spring', reason: 'spring-repository', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/config/') || p.includes('/configuration/')) {
      return { framework: 'spring-boot', reason: 'spring-boot-config', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/mapper/')) {
      return { framework: 'mybatis', reason: 'mybatis-mapper', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/client/') || p.includes('/clients/')) {
      return { framework: 'spring', reason: 'spring-feign-client', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/listener/') || p.includes('/listeners/')) {
      return { framework: 'spring', reason: 'spring-listener', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/scheduler/') || p.includes('/schedulers/')) {
      return { framework: 'spring', reason: 'spring-scheduler', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
    if (p.includes('/task/') || p.includes('/tasks/')) {
      return { framework: 'spring', reason: 'spring-task', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM };
    }
  }

  // ========== KOTLIN ==========
  if (ext === '.kt') {
    if (p.includes('/controller/') || p.includes('/controllers/')) {
      return { framework: 'spring-kotlin', reason: 'spring-kotlin-controller', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (basename.endsWith('controller.kt')) {
      return { framework: 'spring-kotlin', reason: 'spring-kotlin-controller-file', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (p.includes('/routes/') && basename.endsWith('.kt')) {
      return { framework: 'ktor', reason: 'ktor-routes', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (basename === 'main.kt') {
      return { framework: 'kotlin', reason: 'kotlin-main', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
  }

  // ========== GO ==========
  if (ext === '.go') {
    if (p.includes('/handlers/') || p.includes('/handler/')) {
      return { framework: 'go-http', reason: 'go-handlers', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (p.includes('/routes/')) {
      return { framework: 'go-http', reason: 'go-routes', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (p.includes('/controllers/')) {
      return { framework: 'go-mvc', reason: 'go-controller', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (basename === 'main.go') {
      return { framework: 'go', reason: 'go-main', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
  }

  // ========== RUST ==========
  if (ext === '.rs') {
    if (p.includes('/handlers/') || p.includes('/routes/')) {
      return { framework: 'rust-web', reason: 'rust-handlers', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH };
    }
    if (basename === 'main.rs') {
      return { framework: 'rust', reason: 'rust-main', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if (p.includes('/bin/')) {
      return { framework: 'rust', reason: 'rust-bin', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
  }

  // ========== C / C++ ==========
  if (ext === '.c' || ext === '.cpp' || ext === '.cc') {
    if (basename === 'main.c' || basename === 'main.cpp' || basename === 'main.cc') {
      return { framework: 'c-cpp', reason: 'c-main', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
  }

  // ========== PRISMA ==========
  if (basename === 'schema.prisma' && p.includes('/prisma/')) {
    return { framework: 'prisma', reason: 'prisma-schema', isEntry: false };
  }

  // ========== VUE / SVELTE ==========
  if (ext === '.vue') {
    if (basename === 'app.vue') {
      return { framework: 'vue', reason: 'vue-app-entry', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    if ((p.includes('/pages/') || p.includes('/views/')) && !basename.startsWith('_')) {
      return { framework: 'vue-router', reason: 'vue-page', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    return { framework: 'vue', reason: 'vue-component', isEntry: false };
  }
  if (ext === '.svelte') {
    if (p.includes('/routes/')) {
      return { framework: 'sveltekit', reason: 'sveltekit-route', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH };
    }
    return { framework: 'svelte', reason: 'svelte-component', isEntry: false };
  }

  return null;
}

// Exact config file names.
const CONFIG_EXACT_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'settings.local.json',
]);

// Config patterns tested against basename.
const CONFIG_PATTERNS = [
  /\.config\./, /^\.env(\.|$)/,
  /^\.babelrc/, /^\.editorconfig/, /^\.gitignore/, /^\.gitattributes/,
  /^\.npmrc/, /^\.yarnrc/, /^\.prettierrc/, /^\.eslintrc/, /^eslint\.config\./, /^\.mocharc/,
  /tailwind\.config\./, /postcss\.config\./, /vite\.config\./, /webpack\.config\./, /rollup\.config\./, /tsup\.config\./,
  /jest\.config\./, /prettier\.config\./,
  /^docker/i, /^docker-compose/i, /^makefile/i,
  /^\.nvmrc/, /^\.node-version/,
  /^requirements/, /pyproject/,
];

// Common entry file basenames.
const ENTRY_BASE_NAMES = new Set([
  'index.js', 'index.ts', 'main.js', 'main.ts',
  'app.js', 'app.ts', 'cli.js', 'server.ts',
  'app.vue',
]);

const ROLE_RULES = [
  {
    role: 'test',
    test: (relPath, base) =>
      relPath.startsWith('test/') ||
      relPath.startsWith('tests/') ||
      relPath.startsWith('__tests__/') ||
      relPath.startsWith('benchmark/') ||
      relPath.startsWith('benchmarks/') ||
      relPath.startsWith('e2e/') ||
      relPath.startsWith('fixtures/') ||
      relPath.startsWith('mocks/') ||
      relPath.startsWith('mock/') ||
      relPath.startsWith('__mocks__/') ||
      relPath.includes('/test/') ||
      relPath.includes('/tests/') ||
      relPath.includes('/__tests__/') ||
      relPath.includes('/benchmark/') ||
      relPath.includes('/benchmarks/') ||
      relPath.includes('/e2e/') ||
      relPath.includes('/fixtures/') ||
      relPath.includes('/mocks/') ||
      relPath.includes('/mock/') ||
      relPath.includes('/__mocks__/') ||
      /\.test\./.test(base) ||
      /\.spec\./.test(base) ||
      /^test_/.test(base) ||
      /_test\./.test(base) ||
      base === 'tests.py',
  },
  {
    role: 'entry',
    test: (_relPath, base) => {
      if (FRAMEWORK_ENTRY_FILES.has(base)) return true;
      // P70: Spring Boot application entry classes
      if (/application.*\.java$/i.test(base)) return true;
      if (/.*servletinitializer\.java$/i.test(base)) return true;
      return false;
    },
  },
  {
    role: 'config',
    test: (_relPath, base) => {
      if (CONFIG_EXACT_NAMES.has(base)) return true;
      if (CONFIG_PATTERNS.some((p) => p.test(base))) return true;
      if (/\.(xml|properties|yml|yaml|ini|cfg|conf|toml)$/.test(base)) return true;
      return false;
    },
  },
  {
    role: 'migration',
    test: (relPath, base) =>
      relPath.includes('/migrations/') ||
      base === 'alembic.ini' ||
      base === 'manage.py',
  },
  {
    role: 'script',
    test: (relPath, base) => {
      const ext = path.extname(base).slice(1);
      if (
        relPath.startsWith('scripts/') ||
        relPath.startsWith('bin/') ||
        relPath.startsWith('tools/') ||
        relPath.includes('/scripts/') ||
        relPath.includes('/bin/') ||
        relPath.includes('/tools/') ||
        ext === 'sh' ||
        ext === 'bash' ||
        ext === 'ps1' ||
        ext === 'sql'
      ) return true;
      // P100: root-level Python files are typically standalone scripts
      if (ext === 'py') {
        const depth = relPath.split('/').filter(Boolean).length;
        if (depth === 1) return true;
      }
      return false;
    },
  },
  {
    role: 'entry',
    test: (relPath, base) => {
      if (!ENTRY_BASE_NAMES.has(base)) return false;
      // L2-18: index.js/index.ts deep in the tree are typically barrel files, not entries.
      // Only treat them as entry at root level or directly under src/.
      if (base === 'index.js' || base === 'index.ts') {
        const depth = relPath.split('/').filter(Boolean).length;
        return depth <= 2;
      }
      return true;
    },
  },
  {
    role: 'docs',
    test: (_relPath, base) =>
      /\.(md|mdx|txt|rst)$/.test(base) ||
      base.toLowerCase().includes('license') ||
      base.toLowerCase().includes('changelog') ||
      base.toLowerCase().includes('contributing') ||
      base.toLowerCase().includes('readme'),
  },
  {
    role: 'style',
    test: (_relPath, base) =>
      /\.(css|scss|sass|less|styl|stylus)$/.test(base),
  },
  {
    role: 'asset',
    test: (_relPath, base) =>
      /\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp3|mp4|wav|avi|mov|pdf|zip|tar\.gz?)$/.test(base),
  },
];

function normalizeRelativePath(input) {
  return toPosixPath(String(input || ''))
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim()
    .toLowerCase();
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pathMatchesRule(relativePath, rulePath) {
  if (!rulePath) return false;
  return relativePath === rulePath || relativePath.startsWith(`${rulePath}/`);
}

function hasEffectiveConfig(config) {
  if (!config || typeof config !== 'object') return false;
  return Object.keys(config).some((k) => k !== '$schema');
}

function loadWorkspaceConfig(root, options = {}) {
  const configPath = path.join(root, '.workspace-bridge.json');
  if (!pathExists(configPath)) return null;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in config file ${configPath}: ${err.message}`);
  }

  // Lightweight schema validation: warn on unknown keys / wrong types,
  // but still load the file so the user isn't blocked.
  if (!options.quiet) {
    const validTopKeys = new Set(['directories']);
    for (const key of Object.keys(config)) {
      if (!validTopKeys.has(key)) {
        console.error(`[Config] Warning: unknown top-level key "${key}" in ${configPath}`);
      }
    }

    const dirs = config.directories;
    if (dirs !== undefined && (typeof dirs !== 'object' || Array.isArray(dirs))) {
      console.error(`[Config] Warning: "directories" must be an object in ${configPath}`);
    } else if (dirs) {
      const validDirKeys = new Set(['active', 'reference', 'archive', 'generated']);
      for (const [key, value] of Object.entries(dirs)) {
        if (!validDirKeys.has(key)) {
          console.error(`[Config] Warning: unknown directories key "${key}" in ${configPath}`);
        } else if (!Array.isArray(value)) {
          console.error(`[Config] Warning: directories.${key} must be an array in ${configPath}`);
        } else if (!value.every((v) => typeof v === 'string')) {
          console.error(`[Config] Warning: directories.${key} must be an array of strings in ${configPath}`);
        }
      }
    }
  }

  return {
    directories: {
      active: ensureArray(config.directories?.active),
      reference: ensureArray(config.directories?.reference),
      archive: ensureArray(config.directories?.archive),
      generated: ensureArray(config.directories?.generated),
    },
  };
}

function inferFileRole(relativePath, context = null) {
  const normalized = normalizeRelativePath(relativePath);
  const base = path.basename(normalized);

  for (const rule of ROLE_RULES) {
    if (rule.test(normalized, base, context)) {
      return rule.role;
    }
  }

  // Context-aware fallback: respect dynamic directory classification.
  // If the file lives in a non-active directory (reference, archive, generated),
  // do not blindly label it as productive library code.
  if (context) {
    const directory = path.dirname(normalized);
    const dirInfo = context.classifyDirectory(directory === '.' ? '' : directory);
    if (dirInfo.role !== 'active') {
      return 'library';
    }
  }

  return 'library';
}

class ProjectContext {
  constructor(root, options = {}) {
    this.root = root;
    this.configPath = path.join(root, '.workspace-bridge.json');
    if (pathExists(this.configPath)) {
      try {
        this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) || {};
      } catch (err) {
        throw new Error(`Invalid JSON in config file ${this.configPath}: ${err.message}`);
      }
    } else {
      this.config = {};
    }
    this.cliExcludes = ensureArray(options.excludeDirs).map(normalizeRelativePath).filter(Boolean);
    this.directoryRules = this.buildDirectoryRules();
  }

  buildDirectoryRules() {
    const configured = this.config?.directories || {};
    const rules = [];

    for (const role of ROLE_PRIORITY) {
      const configuredPaths = ensureArray(configured[role]).map(normalizeRelativePath).filter(Boolean);
      for (const rulePath of configuredPaths) {
        rules.push({ role, path: rulePath, source: 'config' });
      }
    }

    for (const role of ROLE_PRIORITY) {
      const hints = DEFAULT_DIRECTORY_HINTS[role] || [];
      for (const hint of hints) {
        rules.push({ role, path: normalizeRelativePath(hint), source: 'default' });
      }
    }

    for (const excludePath of this.cliExcludes) {
      rules.push({ role: 'reference', path: excludePath, source: 'cli' });
    }

    return rules;
  }

  getRelativePath(filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.root, filePath);
    return normalizeRelativePath(path.relative(this.root, absolutePath));
  }

  classifyDirectory(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      return { role: 'active', matchedRule: null };
    }

    // User-configured rules take precedence over default hints.
    const configuredMatch = this.directoryRules.find(
      (rule) => rule.source === 'config' && pathMatchesRule(normalized, rule.path)
    );
    if (configuredMatch) {
      return { role: configuredMatch.role, matchedRule: configuredMatch };
    }

    for (const role of ROLE_PRIORITY) {
      const match = this.directoryRules.find((rule) => rule.role === role && pathMatchesRule(normalized, rule.path));
      if (match) {
        return { role, matchedRule: match };
      }
    }

    return { role: 'active', matchedRule: null };
  }

  classifyFile(filePath) {
    const relativePath = this.getRelativePath(filePath);
    const directory = path.dirname(relativePath);
    const directoryInfo = this.classifyDirectory(directory === '.' ? '' : directory);
    const fileRole = inferFileRole(relativePath, this);
    const isMainline = directoryInfo.role === 'active';

    return {
      relativePath,
      directoryRole: directoryInfo.role,
      fileRole,
      isMainline,
      matchedRule: directoryInfo.matchedRule,
    };
  }

  isActiveSourceFile(filePath) {
    return this.classifyFile(filePath).isMainline;
  }

  isNotGeneratedFile(filePath) {
    return this.classifyFile(filePath).directoryRole !== 'generated';
  }

  summarizeFiles(files, isImportedFn) {
    const summary = {
      configPath: pathExists(this.configPath) ? this.configPath : null,
      hasWorkspaceBridgeConfig: pathExists(this.configPath) && hasEffectiveConfig(this.config),
      counts: {
        totalFiles: 0,
        mainlineFiles: 0,
        nonMainlineFiles: 0,
        testFiles: 0,
      },
      directoryRoles: {
        active: 0,
        reference: 0,
        archive: 0,
        generated: 0,
      },
      fileRoles: {
        entry: 0,
        library: 0,
        config: 0,
        test: 0,
        migration: 0,
        script: 0,
        docs: 0,
        style: 0,
        asset: 0,
        unknown: 0,
      },
      entryFiles: [],
    };

    for (const filePath of files) {
      const classification = this.classifyFile(filePath);
      summary.counts.totalFiles += 1;
      summary.directoryRoles[classification.directoryRole] += 1;
      let fileRole = classification.fileRole;
      // P41: a file cannot simultaneously be 'library' and 'orphan'
      if (fileRole === 'library' && isImportedFn && !isImportedFn(filePath)) {
        fileRole = 'unknown';
      }
      summary.fileRoles[fileRole] += 1;
      // L2-26: tests and docs are active (still indexed) but not mainline
      const isTrulyMainline = classification.isMainline && fileRole !== 'test' && fileRole !== 'docs' && fileRole !== 'style' && fileRole !== 'asset';
      if (isTrulyMainline) {
        summary.counts.mainlineFiles += 1;
      } else {
        summary.counts.nonMainlineFiles += 1;
      }
      if (fileRole === 'entry') {
        summary.entryFiles.push(classification.relativePath);
      }
    }

    summary.counts.testFiles = summary.fileRoles.test;
    summary.entryFiles = Array.from(new Set(summary.entryFiles)).sort();
    return summary;
  }
}

module.exports = {
  ProjectContext,
  normalizeRelativePath,
  loadWorkspaceConfig,
  ENTRY_BASE_NAMES,
  ENTRY_WEIGHT,
  detectFrameworkFromPath,
};
