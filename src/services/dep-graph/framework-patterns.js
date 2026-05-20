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
const { DEFAULTS } = require('../../config/constants');
const { ENTRY_WEIGHT, detectFrameworkFromPath } = require('../../utils/project-context');

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
  const sample = content.slice(0, DEFAULTS.ENTRY_SCAN_BYTES).toLowerCase();
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
