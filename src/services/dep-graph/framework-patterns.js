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
 * @property {number} [entryPointWeight] — 1.0–3.0 gradient for hotspot scoring (undefined if isEntry=false)
 */

// P103: Entry-point weight constants (adapted from GitNexus entryPointMultiplier)
const ENTRY_WEIGHT = {
  HIGH: 3.0,        // page, controller, views, main, application
  MEDIUM_HIGH: 2.5, // layout, routes, URLs, handlers
  MEDIUM: 2.0,      // admin, middleware, plugins, api-folder
  LOW: 1.5,         // components, prisma, service
  MINIMAL: 1.0,     // manage.py
};

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

// ============================================================================
// AST-BASED FRAMEWORK DETECTION (lightweight — text scan, no full AST)
// ============================================================================

// P103: Framework → entryPointWeight map for content-based detection
const FRAMEWORK_WEIGHTS = {
  'nestjs': ENTRY_WEIGHT.HIGH,
  'express': ENTRY_WEIGHT.MEDIUM_HIGH,
  'vue': ENTRY_WEIGHT.MEDIUM,
  'django': ENTRY_WEIGHT.MEDIUM,
  'celery': ENTRY_WEIGHT.MEDIUM,
  'fastapi': ENTRY_WEIGHT.MEDIUM_HIGH,
  'flask': ENTRY_WEIGHT.MEDIUM_HIGH,
  'spring-boot': ENTRY_WEIGHT.HIGH,
  'spring': ENTRY_WEIGHT.MEDIUM_HIGH,
  'quartz': ENTRY_WEIGHT.MEDIUM,
  'mybatis': ENTRY_WEIGHT.MEDIUM,
  'spring-kotlin': ENTRY_WEIGHT.HIGH,
  'ktor': ENTRY_WEIGHT.MEDIUM_HIGH,
  'gin': ENTRY_WEIGHT.MEDIUM_HIGH,
  'echo': ENTRY_WEIGHT.MEDIUM_HIGH,
  'fiber': ENTRY_WEIGHT.MEDIUM_HIGH,
  'actix-web': ENTRY_WEIGHT.HIGH,
  'axum': ENTRY_WEIGHT.MEDIUM_HIGH,
  'rocket': ENTRY_WEIGHT.HIGH,
};

const AST_PATTERNS = {
  js: [
    { framework: 'nestjs', reason: 'nestjs-decorator', patterns: ['@Controller', '@Get(', '@Post(', '@Put(', '@Delete('] },
    { framework: 'express', reason: 'express-route', patterns: ['app.get(', 'app.post(', 'router.get(', 'router.post('] },
    { framework: 'vue', reason: 'vue-script', patterns: ["from 'vue'", 'from "vue"', 'createapp(', 'definecomponent(', 'vue-router', 'pinia'] },
    { framework: 'vue', reason: 'vue-script-setup-macro', patterns: ['defineProps(', 'defineEmits(', 'defineExpose(', 'defineOptions(', 'defineSlots(', 'defineModel('] },
  ],
  py: [
    { framework: 'django', reason: 'django-command', patterns: ['BaseCommand', 'class Command('] },
    { framework: 'django', reason: 'django-admin', patterns: ['admin.site.register'] },
    { framework: 'django', reason: 'django-middleware', patterns: ['MiddlewareMixin', 'class Middleware', 'def process_request', 'def process_response'] },
    { framework: 'django', reason: 'django-router', patterns: ['class DatabaseRouter', 'allow_migrate', 'db_for_read', 'db_for_write'] },
    { framework: 'django', reason: 'django-context-processors', patterns: ['def context_processors', 'def processor('] },
    { framework: 'django', reason: 'django-templatetags', patterns: ['@register.filter', '@register.simple_tag', '@register.inclusion_tag'] },
    { framework: 'django', reason: 'django-forms', patterns: ['class Form(', 'class ModelForm(', 'from django import forms'] },
    { framework: 'django', reason: 'django-signal', patterns: ['@receiver', '.connect('] },
    { framework: 'celery', reason: 'celery-task', patterns: ['@shared_task', '@app.task'] },
    { framework: 'fastapi', reason: 'fastapi-decorator', patterns: ['@app.get', '@app.post', '@router.get'] },
    { framework: 'flask', reason: 'flask-decorator', patterns: ['@app.route', '@blueprint.route'] },
  ],
  java: [
    // Spring Boot annotations must come BEFORE plain Spring annotations
    // to avoid substring false matches (e.g. @Controller matching inside @ControllerAdvice)
    { framework: 'spring-boot', reason: 'spring-boot-annotation', patterns: ['@SpringBootApplication', '@Configuration', '@ControllerAdvice', '@Component', '@Service', '@Repository', '@EnableAutoConfiguration', '@Aspect'] },
    { framework: 'spring', reason: 'spring-annotation', patterns: ['@RestController', '@Controller', '@GetMapping', '@PostMapping', '@FeignClient', '@Scheduled'] },
    // P79/P80/P81: runtime-assembly framework components
    { framework: 'spring', reason: 'spring-component', patterns: ['@Component', '@Service', '@Repository', '@Bean', 'FilterRegistrationBean', 'implements Filter', 'extends HttpServletRequestWrapper', 'implements Validator', 'implements HandlerInterceptor', 'implements ApplicationListener'] },
    { framework: 'quartz', reason: 'quartz-job', patterns: ['org.quartz.Job', '@DisallowConcurrentExecution', 'extends AbstractQuartzJob', 'QuartzJobExecution', 'JobInvokeUtil'] },
    { framework: 'mybatis', reason: 'mybatis-typehandler', patterns: ['implements TypeHandler', 'extends BaseTypeHandler', 'TypeHandler<'] },
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

  // Use the full provided content sample (callers already cap at ENTRY_SCAN_BYTES)
  const sample = content.slice(0, 4096).toLowerCase();
  for (const cfg of configs) {
    for (const pat of cfg.patterns) {
      if (sample.includes(pat.toLowerCase())) {
        return { framework: cfg.framework, reason: cfg.reason, isEntry: true, entryPointWeight: FRAMEWORK_WEIGHTS[cfg.framework] || ENTRY_WEIGHT.MEDIUM };
      }
    }
  }
  return null;
}

module.exports = {
  detectFrameworkFromPath,
  detectFrameworkFromContent,
};
