/**
 * Framework content-hints — lightweight text-scan patterns for builder use.
 *
 * Path-based detection (detectFrameworkFromPath) lives in project-context.js
 * because it is pure file-path inference, not graph-building logic.
 *
 * This module only contains:
 *   1. AST_PATTERNS — content-based framework signatures.
 *   2. detectFrameworkFromContent — lightweight scan of file head bytes.
 *
 * Translated from GitNexus framework-detection.ts, trimmed to
 * workspace-bridge's 9 supported languages.
 */

const path = require('path');
const { DEFAULTS, LIMITS } = require('../../config/constants');
const { ENTRY_WEIGHT, detectFrameworkFromPath } = require('../../utils/project-context');
const { compileQuery, runQuery } = require('./query-compiler');
const { getParserModule, loadLanguage } = require('./parsers/tree-sitter');

/**
 * @typedef {Object} FrameworkHint
 * @property {string} framework
 * @property {string} reason
 * @property {boolean} isEntry — whether this file is a framework-managed entry point
 * @property {number} [entryPointWeight] — 1.0–3.0 gradient for hotspot scoring (undefined if isEntry=false)
 */

// Re-export path-based detector so consumers only need one require.
// This is a transitional compatibility shim — new code should require
// project-context directly.

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
    { framework: 'django', reason: 'django-command', patterns: ['BaseCommand', 'class Command('], preFilterRe: /BaseCommand|class\s+Command\s*\(/i },
    { framework: 'django', reason: 'django-admin', patterns: ['admin.site.register'], preFilterRe: /admin\.site\.register/i },
    { framework: 'django', reason: 'django-middleware', patterns: ['MiddlewareMixin', 'class Middleware', 'def process_request', 'def process_response'] },
    { framework: 'django', reason: 'django-router', patterns: ['class DatabaseRouter', 'allow_migrate', 'db_for_read', 'db_for_write'] },
    { framework: 'django', reason: 'django-context-processors', patterns: ['def context_processors', 'def processor('] },
    { framework: 'django', reason: 'django-templatetags', patterns: ['@register.filter', '@register.simple_tag', '@register.inclusion_tag'] },
    { framework: 'django', reason: 'django-forms', patterns: ['class Form(', 'class ModelForm(', 'from django import forms'] },
    { framework: 'django', reason: 'django-signal', patterns: ['@receiver', '.connect('], preFilterRe: /@receiver\s*\(|\.connect\s*\(/i },
    { framework: 'django', reason: 'django-rest-framework', patterns: ['@api_view', 'class APIView', 'class ModelViewSet', 'class ViewSet', 'class GenericAPIView', '@action', '@permission_classes', '@authentication_classes', '@throttle_classes', 'from rest_framework'], preFilterRe: /@api_view\s*\(|\b(APIView|ModelViewSet|ViewSet|GenericAPIView)\b/i },
    { framework: 'celery', reason: 'celery-task', patterns: ['@shared_task', '@app.task'], preFilterRe: /@shared_task|@\w+\.task/i },
    { framework: 'fastapi', reason: 'fastapi-decorator', patterns: ['@app.get', '@app.post', '@router.get'], preFilterRe: /@\w+\.(get|post|put|delete|patch)\s*\(/i },
    { framework: 'flask', reason: 'flask-decorator', patterns: ['@app.route', '@blueprint.route'], preFilterRe: /@\w+\.route\s*\(/i },
  ],
  java: [
    // Spring Boot annotations must come BEFORE plain Spring annotations
    // to avoid substring false matches (e.g. @Controller matching inside @ControllerAdvice)
    { framework: 'spring-boot', reason: 'spring-boot-annotation', patterns: ['@SpringBootApplication', '@Configuration', '@ControllerAdvice', '@Component', '@Service', '@Repository', '@EnableAutoConfiguration', '@Aspect'], preFilterRe: /@(SpringBootApplication|Configuration|ControllerAdvice|Component|Service|Repository|EnableAutoConfiguration|Aspect)\\b/i },
    { framework: 'spring', reason: 'spring-annotation', patterns: ['@RestController', '@Controller', '@RequestMapping', '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping', '@FeignClient', '@Scheduled', '@Async', '@EventListener', '@KafkaListener', '@RabbitListener', '@JmsListener', '@Retryable'], preFilterRe: /@(RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|FeignClient|Scheduled|Async|EventListener|KafkaListener|RabbitListener|JmsListener|Retryable)\\b/i },
    // P79/P80/P81: runtime-assembly framework components
    { framework: 'spring', reason: 'spring-component', patterns: ['@Component', '@Service', '@Repository', '@Bean', 'FilterRegistrationBean', 'implements Filter', 'extends HttpServletRequestWrapper', 'implements Validator', 'implements HandlerInterceptor', 'implements ApplicationListener'] },
    { framework: 'quartz', reason: 'quartz-job', patterns: ['org.quartz.Job', '@DisallowConcurrentExecution', 'extends AbstractQuartzJob', 'QuartzJobExecution', 'JobInvokeUtil'] },
    { framework: 'mybatis', reason: 'mybatis-typehandler', patterns: ['implements TypeHandler', 'extends BaseTypeHandler', 'TypeHandler<'] },
  ],
  kt: [
    { framework: 'spring-kotlin', reason: 'spring-annotation', patterns: ['@RestController', '@Controller', '@RequestMapping', '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping', '@FeignClient', '@Scheduled', '@Async', '@EventListener', '@KafkaListener', '@RabbitListener', '@JmsListener', '@Retryable'], preFilterRe: /@(RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|FeignClient|Scheduled|Async|EventListener|KafkaListener|RabbitListener|JmsListener|Retryable)\\b/i },
    { framework: 'ktor', reason: 'ktor-routing', patterns: ['routing {', 'embeddedServer', 'Application.module'], preFilterRe: /\\brouting\\b|\\bembeddedServer\\b|\\bApplication\\.module\\b|\\b(get|post|put|delete|patch)\\b/i },
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

// ============================================================================
// QUERY-BASED ROUTE EXTRACTION (Wave 15-2)
// Tree-sitter query declarations loaded from queries/route-extraction/
// ============================================================================

const EXT_TO_LANGUAGE = {
  '.js': 'typescript',
  '.ts': 'typescript',
  '.jsx': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.go': 'go',
  '.rs': 'rust',
  // C/C++ use a dedicated fallback key; query path reserved for future frameworks.
  '.c': 'cpp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
};

const ROUTE_QUERY_REGISTRY = new Map();

function registerRouteQuery(language, framework, queryModulePath) {
  ROUTE_QUERY_REGISTRY.set(`${language}:${framework}`, queryModulePath);
}

// Phase 2: Express (JS/TS)
registerRouteQuery('typescript', 'express', './queries/route-extraction/js-express');
// Phase 4: NestJS (JS/TS)
registerRouteQuery('typescript', 'nestjs', './queries/route-extraction/js-nestjs');
// Phase 4: Spring Boot (Java)
registerRouteQuery('java', 'spring', './queries/route-extraction/java-spring');
// Wave 11-15: Nuxt 3 (JS/TS Nitro handlers + explicit definePageMeta)
registerRouteQuery('typescript', 'nuxt', './queries/route-extraction/js-nuxt');
// Wave 11-15: SvelteKit (JS/TS server files)
registerRouteQuery('typescript', 'sveltekit', './queries/route-extraction/js-sveltekit');
// Wave 11-15: Python frameworks
registerRouteQuery('python', 'fastapi', './queries/route-extraction/py-fastapi');
// Wave 11-15: Django frameworks
registerRouteQuery('python', 'django', './queries/route-extraction/py-django');
// Wave 11-15: Go frameworks
registerRouteQuery('go', 'gin', './queries/route-extraction/go-gin');
// Wave 11-15: Fiber frameworks
registerRouteQuery('go', 'fiber', './queries/route-extraction/go-fiber');
// Wave 11-15: Rust frameworks
registerRouteQuery('rust', 'actix-web', './queries/route-extraction/rs-actix');
// Wave 11-15: Axum frameworks
registerRouteQuery('rust', 'axum', './queries/route-extraction/rs-axum');

const FRAMEWORK_QUERY_REGISTRY = new Map();

function registerFrameworkQuery(language, framework, queryModulePath) {
  FRAMEWORK_QUERY_REGISTRY.set(`${language}:${framework}`, queryModulePath);
}

registerFrameworkQuery('typescript', 'express', './queries/framework-detection/js-express');
registerFrameworkQuery('python', 'django', './queries/framework-detection/py-django');
registerFrameworkQuery('python', 'fastapi', './queries/framework-detection/py-fastapi');
registerFrameworkQuery('python', 'flask', './queries/framework-detection/py-flask');
registerFrameworkQuery('python', 'celery', './queries/framework-detection/py-celery');
registerFrameworkQuery('java', 'spring-boot', './queries/framework-detection/java-spring-boot');
registerFrameworkQuery('java', 'spring', './queries/framework-detection/java-spring');
registerFrameworkQuery('kotlin', 'spring-kotlin', './queries/framework-detection/kt-spring');
registerFrameworkQuery('kotlin', 'ktor', './queries/framework-detection/kt-ktor');

/**
 * Common helper to compile and run tree-sitter queries for a registered registry.
 */
async function runQueryRegistry(filePath, content, registryMap, onMatch) {
  const ext = path.extname(filePath).toLowerCase();
  const lang = EXT_TO_LANGUAGE[ext];
  if (!lang) return null;

  const queryDefs = [];
  for (const [key, queryPath] of registryMap) {
    if (!key.startsWith(`${lang}:`)) continue;
    try {
      queryDefs.push(require(queryPath));
    } catch {
      continue;
    }
  }
  if (queryDefs.length === 0) return null;

  let mod = null;
  let parser = null;
  let tree = null;

  try {
    mod = await getParserModule();
    if (!mod) return null;

    const langObj = await loadLanguage(lang);
    if (!langObj) return null;

    parser = new mod.Parser();
    parser.setLanguage(langObj);
    tree = parser.parse(content);

    return await onMatch(tree, lang, queryDefs);
  } catch {
    return null;
  } finally {
    try { tree?.delete(); } catch {}
    try { parser?.delete(); } catch {}
  }
}

/**
 * Try to extract routes using tree-sitter query.
 * Returns routes[] on success, null on any failure (caller falls back to regex).
 */
async function tryExtractRoutesWithQuery(filePath, content) {
  return runQueryRegistry(filePath, content, ROUTE_QUERY_REGISTRY, async (tree, lang, queryDefs) => {
    const allRoutes = [];
    for (const queryDef of queryDefs) {
      const compiled = await compileQuery(lang, queryDef.query);
      if (!compiled) continue;

      const matches = runQuery(tree, compiled);
      if (!matches) continue;

      const routes = queryDef.postProcess(matches);
      if (routes && routes.length > 0) {
        allRoutes.push(...routes);
      }
    }
    return allRoutes.length > 0 ? allRoutes : null;
  });
}

// ============================================================================
// ROUTE EXTRACTION PATTERNS (Wave 9-2)
// Only extracts static route declarations — no middleware chain / DI tracing.
// Regex fallback — kept as permanent safety net.
// ============================================================================

const ROUTE_PATTERNS = {
  js: [
    // Express / Koa-router: app.get('/path', ...) / router.post('/path', ...)
    { framework: 'express', re: /(?:app|router)\.(get|post|put|delete|patch|all)\s*\(\s*['"]([^'"]+)['"]/gi },
    // NestJS: @Get('/path') / @Post('/path')
    { framework: 'nestjs', re: /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]+)['"]/g },
  ],
  py: [
    // FastAPI: @app.get('/path') / @router.post('/path')
    { framework: 'fastapi', re: /@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi },
    // Flask: @app.route('/path') / @blueprint.route('/path')
    { framework: 'flask', re: /@(?:app|blueprint)\.route\s*\(\s*['"]([^'"]+)['"]/gi, methodIndex: null, pathIndex: 1 },
  ],
  java: [
    // Spring: @GetMapping("/path") / @PostMapping("/path") / @RequestMapping("/path")
    { framework: 'spring', re: /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g },
  ],
  kt: [
    // Spring Kotlin: same as Java
    { framework: 'spring-kotlin', re: /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g },
    // Ktor: get("/path") / post("/path")
    { framework: 'ktor', re: /\b(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi },
  ],
  go: [
    // Gin/Echo/Fiber: r.GET("/path", ...) / e.POST("/path", ...)
    { framework: 'gin', re: /\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']/g },
  ],
  rs: [
    // Actix-web / Rocket: #[get("/path")] / #[post("/path")]
    { framework: 'actix-web', re: /#\[(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi },
  ],
  cpp: [
    // Crow: CROWD_ROUTE(app, "/path") or app.route("/path").method(...)
    { framework: 'crow', re: /(?:CROWD_ROUTE\s*\(\s*\w+\s*,\s*|[\.\->]route\s*\(\s*)["']([^"']+)["']\s*\)/gi, methodIndex: null, pathIndex: 1 },
    // Pistache: Routes::Get(router, "/path", ...)
    { framework: 'pistache', re: /Routes::(Get|Post|Put|Delete|Patch)\s*\(\s*\w+\s*,\s*["']([^"']+)["']/gi },
    // Generic C/C++ HTTP libraries: mg_http_listen, httplib::Server::Get, etc.
    { framework: 'generic-cpp', re: /\.(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']/gi },
  ],
};

/**
 * Lightweight framework detection from file content (synchronous).
 */
function detectFrameworkFromContentSync(filePath, content) {
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

  const sample = content.slice(0, LIMITS.ENTRY_SCAN_BYTES).toLowerCase();
  for (const cfg of configs) {
    for (const pat of cfg.patterns) {
      if (sample.includes(pat.toLowerCase())) {
        return { framework: cfg.framework, reason: cfg.reason, isEntry: true, entryPointWeight: FRAMEWORK_WEIGHTS[cfg.framework] || ENTRY_WEIGHT.MEDIUM };
      }
    }
  }
  return null;
}

/**
 * Try to detect framework using tree-sitter query.
 */
async function tryDetectFrameworkWithQuery(filePath, content) {
  // Path-based pre-filtering
  const pathHint = detectFrameworkFromPath(filePath);
  if (pathHint) return pathHint;

  const ext = path.extname(filePath).toLowerCase();

  // Regex/cheap-signature pre-filtering mapping
  let langKey = null;
  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx' || ext === '.vue' || ext === '.svelte') langKey = 'js';
  else if (ext === '.py') langKey = 'py';
  else if (ext === '.java') langKey = 'java';
  else if (ext === '.kt') langKey = 'kt';
  else if (ext === '.go') langKey = 'go';
  else if (ext === '.rs') langKey = 'rs';

  const configs = AST_PATTERNS[langKey] || [];
  const sample = content.slice(0, LIMITS.ENTRY_SCAN_BYTES).toLowerCase();

  return runQueryRegistry(filePath, content, FRAMEWORK_QUERY_REGISTRY, async (tree, lang, queryDefs) => {
    const activeQueryDefs = [];
    for (const queryDef of queryDefs) {
      const cfg = configs.find(c => c.framework === queryDef.framework);
      if (cfg) {
        let hasMatch = false;
        if (cfg.preFilterRe) {
          cfg.preFilterRe.lastIndex = 0;
          hasMatch = cfg.preFilterRe.test(sample);
        } else {
          hasMatch = cfg.patterns.some(pat => sample.includes(pat.toLowerCase()));
        }
        if (!hasMatch) continue;
      }
      activeQueryDefs.push(queryDef);
    }

    if (activeQueryDefs.length === 0) return null;

    for (const queryDef of activeQueryDefs) {
      const compiled = await compileQuery(lang, queryDef.query);
      if (!compiled) continue;

      const matches = runQuery(tree, compiled);
      if (!matches) continue;

      const hint = queryDef.postProcess(matches);
      if (hint) {
        return hint;
      }
    }
    return null;
  });
}

/**
 * Asynchronous content-based framework detection.
 */
async function detectFrameworkFromContent(filePath, content) {
  const queryHint = await tryDetectFrameworkWithQuery(filePath, content);
  if (queryHint) return queryHint;

  return detectFrameworkFromContentSync(filePath, content);
}

/**
 * Extract HTTP route declarations from file content.
 * Only extracts static route strings — no middleware chain / DI tracing.
 * @param {string} filePath
 * @param {string} content
 * @returns {Array<{method:string, path:string, framework:string, handler:string|null}>}
 */
function extractRoutesWithRegex(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  let key = null;
  if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') key = 'js';
  else if (ext === '.py') key = 'py';
  else if (ext === '.java') key = 'java';
  else if (ext === '.kt' || ext === '.kts') key = 'kt';
  else if (ext === '.go') key = 'go';
  else if (ext === '.rs') key = 'rs';
  else if (ext === '.c' || ext === '.cpp' || ext === '.cc' || ext === '.h' || ext === '.hpp') key = 'cpp';

  const patterns = ROUTE_PATTERNS[key];
  if (!patterns || patterns.length === 0) return [];

  const ROUTE_SCAN_MULTIPLIER = 4;
  const sample = content.slice(0, LIMITS.ENTRY_SCAN_BYTES * ROUTE_SCAN_MULTIPLIER);
  const routes = [];
  const seen = new Set();

  for (const cfg of patterns) {
    cfg.re.lastIndex = 0;
    let match;
    while ((match = cfg.re.exec(sample)) !== null) {
      let method, routePath;
      if (cfg.pathIndex === 1) {
        method = 'ALL';
        routePath = match[1];
      } else {
        method = match[1].toUpperCase();
        routePath = match[2];
        if (method === 'REQUEST') method = 'ALL';
      }

      const dedup = `${method}:${routePath}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      routes.push({
        method,
        path: routePath,
        framework: cfg.framework,
        handler: null,
      });
    }
  }

  return routes;
}

async function extractRoutes(filePath, content) {
  // Wave 15-2: try tree-sitter query first
  const queryRoutes = await tryExtractRoutesWithQuery(filePath, content);
  if (queryRoutes && queryRoutes.length > 0) {
    return queryRoutes;
  }

  // Permanent regex fallback
  return extractRoutesWithRegex(filePath, content);
}

module.exports = {
  detectFrameworkFromPath,
  detectFrameworkFromContent,
  detectFrameworkFromContentSync,
  extractRoutes,
  FRAMEWORK_QUERY_REGISTRY,
};
