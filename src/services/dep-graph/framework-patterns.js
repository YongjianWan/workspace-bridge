/**
 * Framework pattern detection — path-based only.
 *
 * Translated from GitNexus framework-detection.ts, trimmed to
 * workspace-bridge's 9 supported languages.
 *
 * Value:
 *   1. Eliminate dead-export false positives on framework entry files.
 *   2. Provide framework context to formatters (audit-diff / audit-file).
 *
 * DESIGN: Returns null for unknown frameworks — callers fall back to
 * existing regex-based entry-file detection.
 */

const path = require('path');

/**
 * @typedef {Object} FrameworkHint
 * @property {string} framework
 * @property {string} reason
 * @property {boolean} isEntry — whether this file is a framework-managed entry point
 */

// ============================================================================
// PATH-BASED FRAMEWORK DETECTION
// ============================================================================

/**
 * Detect framework from file path patterns.
 * @param {string} filePath
 * @returns {FrameworkHint | null}
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
        return { framework: 'nextjs-app', reason: 'nextjs-app-page', isEntry: true };
      }
      if (basename === 'layout.tsx' || basename === 'layout.ts' || basename === 'layout.jsx' || basename === 'layout.js') {
        return { framework: 'nextjs-app', reason: 'nextjs-layout', isEntry: true };
      }
      if (basename === 'route.ts' || basename === 'route.js') {
        return { framework: 'nextjs-api', reason: 'nextjs-api-route', isEntry: true };
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
      return { framework: 'nextjs-pages', reason: 'nextjs-page', isEntry: true };
    }
    if (p.includes('/pages/api/')) {
      return { framework: 'nextjs-api', reason: 'nextjs-api-route', isEntry: true };
    }

    // Express / generic routes & controllers
    if (p.includes('/routes/')) {
      return { framework: 'express', reason: 'routes-folder', isEntry: true };
    }
    if (p.includes('/controllers/')) {
      return { framework: 'mvc', reason: 'controllers-folder', isEntry: true };
    }
    if (p.includes('/handlers/')) {
      return { framework: 'handlers', reason: 'handlers-folder', isEntry: true };
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
      return { framework: 'django', reason: 'django-views', isEntry: true };
    }
    if (basename === 'urls.py') {
      return { framework: 'django', reason: 'django-urls', isEntry: true };
    }
    if (basename === 'manage.py') {
      return { framework: 'django', reason: 'django-manage', isEntry: true };
    }
    if (
      (p.includes('/routers/') || p.includes('/endpoints/') || p.includes('/routes/')) &&
      !basename.startsWith('__')
    ) {
      return { framework: 'fastapi', reason: 'api-routers', isEntry: true };
    }
    if (p.includes('/api/') && !basename.startsWith('__')) {
      return { framework: 'python-api', reason: 'api-folder', isEntry: true };
    }
  }

  // ========== JAVA ==========
  if (ext === '.java') {
    if (p.includes('/controller/') || p.includes('/controllers/')) {
      return { framework: 'spring', reason: 'spring-controller', isEntry: true };
    }
    if (basename.endsWith('controller.java')) {
      return { framework: 'spring', reason: 'spring-controller-file', isEntry: true };
    }
    if (p.includes('/service/') || p.includes('/services/')) {
      return { framework: 'java-service', reason: 'java-service', isEntry: false };
    }
  }

  // ========== KOTLIN ==========
  if (ext === '.kt') {
    if (p.includes('/controller/') || p.includes('/controllers/')) {
      return { framework: 'spring-kotlin', reason: 'spring-kotlin-controller', isEntry: true };
    }
    if (basename.endsWith('controller.kt')) {
      return { framework: 'spring-kotlin', reason: 'spring-kotlin-controller-file', isEntry: true };
    }
    if (p.includes('/routes/') && basename.endsWith('.kt')) {
      return { framework: 'ktor', reason: 'ktor-routes', isEntry: true };
    }
    if (basename === 'main.kt') {
      return { framework: 'kotlin', reason: 'kotlin-main', isEntry: true };
    }
  }

  // ========== GO ==========
  if (ext === '.go') {
    if (p.includes('/handlers/') || p.includes('/handler/')) {
      return { framework: 'go-http', reason: 'go-handlers', isEntry: true };
    }
    if (p.includes('/routes/')) {
      return { framework: 'go-http', reason: 'go-routes', isEntry: true };
    }
    if (p.includes('/controllers/')) {
      return { framework: 'go-mvc', reason: 'go-controller', isEntry: true };
    }
    if (basename === 'main.go') {
      return { framework: 'go', reason: 'go-main', isEntry: true };
    }
  }

  // ========== RUST ==========
  if (ext === '.rs') {
    if (p.includes('/handlers/') || p.includes('/routes/')) {
      return { framework: 'rust-web', reason: 'rust-handlers', isEntry: true };
    }
    if (basename === 'main.rs') {
      return { framework: 'rust', reason: 'rust-main', isEntry: true };
    }
    if (p.includes('/bin/')) {
      return { framework: 'rust', reason: 'rust-bin', isEntry: true };
    }
  }

  // ========== C / C++ ==========
  if (ext === '.c' || ext === '.cpp' || ext === '.cc') {
    if (basename === 'main.c' || basename === 'main.cpp' || basename === 'main.cc') {
      return { framework: 'c-cpp', reason: 'c-main', isEntry: true };
    }
  }

  // ========== PRISMA ==========
  if (basename === 'schema.prisma' && p.includes('/prisma/')) {
    return { framework: 'prisma', reason: 'prisma-schema', isEntry: false };
  }

  // ========== VUE / SVELTE ==========
  if (ext === '.vue') {
    if ((p.includes('/pages/') || p.includes('/views/')) && !basename.startsWith('_')) {
      return { framework: 'vue-router', reason: 'vue-page', isEntry: true };
    }
    return { framework: 'vue', reason: 'vue-component', isEntry: false };
  }
  if (ext === '.svelte') {
    if (p.includes('/routes/')) {
      return { framework: 'sveltekit', reason: 'sveltekit-route', isEntry: true };
    }
    return { framework: 'svelte', reason: 'svelte-component', isEntry: false };
  }

  return null;
}

// ============================================================================
// AST-BASED FRAMEWORK DETECTION (lightweight — text scan, no full AST)
// ============================================================================

const AST_PATTERNS = {
  js: [
    { framework: 'nestjs', reason: 'nestjs-decorator', patterns: ['@Controller', '@Get(', '@Post(', '@Put(', '@Delete('] },
    { framework: 'express', reason: 'express-route', patterns: ['app.get(', 'app.post(', 'router.get(', 'router.post('] },
  ],
  py: [
    { framework: 'fastapi', reason: 'fastapi-decorator', patterns: ['@app.get', '@app.post', '@router.get'] },
    { framework: 'flask', reason: 'flask-decorator', patterns: ['@app.route', '@blueprint.route'] },
  ],
  java: [
    { framework: 'spring', reason: 'spring-annotation', patterns: ['@RestController', '@Controller', '@GetMapping', '@PostMapping'] },
  ],
  kt: [
    { framework: 'spring-kotlin', reason: 'spring-annotation', patterns: ['@RestController', '@Controller', '@GetMapping'] },
    { framework: 'ktor', reason: 'ktor-routing', patterns: ['routing {', 'embeddedServer', 'Application.module'] },
  ],
  go: [
    { framework: 'gin', reason: 'gin-handler', patterns: ['gin.Context', 'gin.Default()', 'gin.New()'] },
    { framework: 'echo', reason: 'echo-handler', patterns: ['echo.Context', 'echo.New()'] },
    { framework: 'fiber', reason: 'fiber-handler', patterns: ['fiber.Ctx', 'fiber.New()'] },
  ],
  rs: [
    { framework: 'actix-web', reason: 'actix-attribute', patterns: ['#[get(', '#[post(', '#[actix_web'] },
    { framework: 'axum', reason: 'axum-routing', patterns: ['Router::new', 'axum::extract'] },
    { framework: 'rocket', reason: 'rocket-attribute', patterns: ['#[get(', '#[post(', '#[launch]'] },
  ],
};

/**
 * Lightweight framework detection from file content.
 * Only scans first ~800 bytes (where imports/decorators live).
 * @param {string} filePath
 * @param {string} content
 * @returns {FrameworkHint | null}
 */
function detectFrameworkFromContent(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  let key = null;
  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx' || ext === '.vue' || ext === '.svelte') key = 'js';
  else if (ext === '.py') key = 'py';
  else if (ext === '.java') key = 'java';
  else if (ext === '.kt') key = 'kt';
  else if (ext === '.go') key = 'go';
  else if (ext === '.rs') key = 'rs';

  const configs = AST_PATTERNS[key];
  if (!configs || configs.length === 0) return null;

  // Only scan first 800 bytes — decorators/annotations live at top of file
  const sample = content.slice(0, 800).toLowerCase();
  for (const cfg of configs) {
    for (const pat of cfg.patterns) {
      if (sample.includes(pat.toLowerCase())) {
        return { framework: cfg.framework, reason: cfg.reason, isEntry: true };
      }
    }
  }
  return null;
}

module.exports = {
  detectFrameworkFromPath,
  detectFrameworkFromContent,
};
