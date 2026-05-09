const assert = require('assert');
const { detectFrameworkFromPath, detectFrameworkFromContent } = require('../src/services/dep-graph/framework-patterns');

function testDetectFrameworkFromPath() {
  // Next.js App Router
  assert.strictEqual(detectFrameworkFromPath('/project/app/page.tsx').framework, 'nextjs-app');
  assert.strictEqual(detectFrameworkFromPath('/project/app/layout.tsx').framework, 'nextjs-app');
  assert.strictEqual(detectFrameworkFromPath('/project/app/api/route.ts').framework, 'nextjs-api');
  assert.strictEqual(detectFrameworkFromPath('/project/app/loading.tsx').framework, 'nextjs-app');

  // Next.js Pages Router
  assert.strictEqual(detectFrameworkFromPath('/project/pages/index.tsx').framework, 'nextjs-pages');
  assert.strictEqual(detectFrameworkFromPath('/project/pages/api/users.ts').framework, 'nextjs-api');

  // Express / MVC
  assert.strictEqual(detectFrameworkFromPath('/project/src/routes/user.ts').framework, 'express');
  assert.strictEqual(detectFrameworkFromPath('/project/src/controllers/user.ts').framework, 'mvc');
  assert.strictEqual(detectFrameworkFromPath('/project/src/handlers/auth.ts').framework, 'handlers');

  // React components
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Button.tsx').framework, 'react');
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/button.tsx'), null);

  // Python Django / FastAPI
  assert.strictEqual(detectFrameworkFromPath('/project/blog/views.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/blog/urls.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/blog/admin.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/blog/admin.py').reason, 'django-admin');
  assert.strictEqual(detectFrameworkFromPath('/project/blog/tasks.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/blog/tasks.py').reason, 'django-tasks');
  assert.strictEqual(detectFrameworkFromPath('/project/core/management/commands/cleanup.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/management/commands/cleanup.py').reason, 'django-management-command');
  assert.strictEqual(detectFrameworkFromPath('/project/core/views/login.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/views/login.py').reason, 'django-views-dir');
  assert.strictEqual(detectFrameworkFromPath('/project/task_management/views_coordination.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/task_management/views_coordination.py').reason, 'django-views-prefix');
  assert.strictEqual(detectFrameworkFromPath('/project/api/routers/users.py').framework, 'fastapi');

  // Java Spring
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/controllers/UserController.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/UserController.java').framework, 'spring');

  // Spring Boot
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/DemoApplication.java').framework, 'spring-boot');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/Application.java').framework, 'spring-boot');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/ServletInitializer.java').framework, 'spring-boot');

  // Kotlin
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/kotlin/controllers/UserController.kt').framework, 'spring-kotlin');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/kotlin/routes/api.kt').framework, 'ktor');

  // Go
  assert.strictEqual(detectFrameworkFromPath('/project/cmd/server/main.go').framework, 'go');
  assert.strictEqual(detectFrameworkFromPath('/project/handlers/user.go').framework, 'go-http');
  assert.strictEqual(detectFrameworkFromPath('/project/routes/api.go').framework, 'go-http');

  // Rust
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.rs').framework, 'rust');
  assert.strictEqual(detectFrameworkFromPath('/project/src/handlers/user.rs').framework, 'rust-web');

  // C/C++
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.cpp').framework, 'c-cpp');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.c').framework, 'c-cpp');

  // Vue / Svelte
  assert.strictEqual(detectFrameworkFromPath('/project/src/pages/Home.vue').framework, 'vue-router');
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Button.vue').framework, 'vue');
  assert.strictEqual(detectFrameworkFromPath('/project/src/routes/+page.svelte').framework, 'sveltekit');
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Card.svelte').framework, 'svelte');

  // Unknown
  assert.strictEqual(detectFrameworkFromPath('/project/src/utils/helpers.ts'), null);
  assert.strictEqual(detectFrameworkFromPath('/project/README.md'), null);
}

function testDetectFrameworkFromContent() {
  // NestJS decorator
  const nestjsContent = `@Controller('users')\nexport class UserController {\n  @Get()\n  findAll() {}\n}`;
  const nestjsHint = detectFrameworkFromContent('/project/src/users.controller.ts', nestjsContent);
  assert.strictEqual(nestjsHint.framework, 'nestjs');

  // Express routes
  const expressContent = `app.get('/users', (req, res) => {});`;
  const expressHint = detectFrameworkFromContent('/project/src/routes.ts', expressContent);
  assert.strictEqual(expressHint.framework, 'express');

  // FastAPI
  const fastapiContent = `@app.get("/items/")\nasync def read_items():\n    return []`;
  const fastapiHint = detectFrameworkFromContent('/project/main.py', fastapiContent);
  assert.strictEqual(fastapiHint.framework, 'fastapi');

  // Flask
  const flaskContent = `@app.route('/')\ndef hello():\n    return 'Hello'`;
  const flaskHint = detectFrameworkFromContent('/project/app.py', flaskContent);
  assert.strictEqual(flaskHint.framework, 'flask');

  // Spring annotation
  const springContent = `@RestController\npublic class UserController {\n  @GetMapping("/users")\n}`;
  const springHint = detectFrameworkFromContent('/project/UserController.java', springContent);
  assert.strictEqual(springHint.framework, 'spring');

  // Spring Boot annotations
  const springBootContent = `@SpringBootApplication\npublic class DemoApplication {\n  public static void main(String[] args) {}\n}`;
  const springBootHint = detectFrameworkFromContent('/project/DemoApplication.java', springBootContent);
  assert.strictEqual(springBootHint.framework, 'spring-boot');

  const configContent = `@Configuration\npublic class AppConfig {\n  @Bean\n}`;
  const configHint = detectFrameworkFromContent('/project/AppConfig.java', configContent);
  assert.strictEqual(configHint.framework, 'spring-boot');

  const adviceContent = `@ControllerAdvice\npublic class GlobalExceptionHandler {}`;
  const adviceHint = detectFrameworkFromContent('/project/GlobalExceptionHandler.java', adviceContent);
  assert.strictEqual(adviceHint.framework, 'spring-boot');

  // Go Gin
  const ginContent = `func handler(c *gin.Context) {\n  c.JSON(200, gin.H{})\n}`;
  const ginHint = detectFrameworkFromContent('/project/handlers.go', ginContent);
  assert.strictEqual(ginHint.framework, 'gin');

  // Rust Actix
  const actixContent = `#[get("/")]\nasync fn index() -> impl Responder {\n  HttpResponse::Ok()\n}`;
  const actixHint = detectFrameworkFromContent('/project/src/routes.rs', actixContent);
  assert.strictEqual(actixHint.framework, 'actix-web');

  // Django management command
  const djangoCommandContent = `from django.core.management.base import BaseCommand\n\nclass Command(BaseCommand):\n    help = 'Cleanup'`;
  const djangoCommandHint = detectFrameworkFromContent('/project/core/management/commands/cleanup.py', djangoCommandContent);
  assert.strictEqual(djangoCommandHint.framework, 'django');

  // Django admin
  const djangoAdminContent = `from django.contrib import admin\nfrom .models import User\n\nadmin.site.register(User)`;
  const djangoAdminHint = detectFrameworkFromContent('/project/core/admin.py', djangoAdminContent);
  assert.strictEqual(djangoAdminHint.framework, 'django');

  // Celery task
  const celeryContent = `from celery import shared_task\n\n@shared_task\ndef add(x, y):\n    return x + y`;
  const celeryHint = detectFrameworkFromContent('/project/core/tasks.py', celeryContent);
  assert.strictEqual(celeryHint.framework, 'celery');

  // No match
  const plainContent = `function add(a, b) { return a + b; }`;
  assert.strictEqual(detectFrameworkFromContent('/project/utils.ts', plainContent), null);
}

function testIsEntryFlag() {
  // Entry files
  assert.strictEqual(detectFrameworkFromPath('/project/app/page.tsx').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.go').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.rs').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/DemoApplication.java').isEntry, true);
  assert.strictEqual(detectFrameworkFromContent('/project/DemoApplication.java', '@SpringBootApplication\npublic class DemoApplication {}').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/management/commands/cleanup.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/views/login.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/task_management/views_coordination.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/admin.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/tasks.py').isEntry, true);

  // Non-entry files
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Button.tsx').isEntry, false);
  assert.strictEqual(detectFrameworkFromPath('/project/prisma/schema.prisma').isEntry, false);
  const helperHint = detectFrameworkFromContent('/project/Helper.java', 'public class Helper {}');
  assert.strictEqual(helperHint?.isEntry ?? false, false);
}

function run() {
  testDetectFrameworkFromPath();
  testDetectFrameworkFromContent();
  testIsEntryFlag();
  console.log('framework-patterns-test.js: all passed');
}

run();
