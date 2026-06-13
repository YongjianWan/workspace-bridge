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
  assert.strictEqual(detectFrameworkFromPath('/project/core/signals.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/signals.py').reason, 'django-signals-file');
  assert.strictEqual(detectFrameworkFromPath('/project/core/management/commands/cleanup.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/management/commands/cleanup.py').reason, 'django-management-command');
  assert.strictEqual(detectFrameworkFromPath('/project/core/views/login.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/views/login.py').reason, 'django-views-dir');
  assert.strictEqual(detectFrameworkFromPath('/project/task_management/views_coordination.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/task_management/views_coordination.py').reason, 'django-views-prefix');
  assert.strictEqual(detectFrameworkFromPath('/project/api/routers/users.py').framework, 'fastapi');
  // Django REST framework
  assert.strictEqual(detectFrameworkFromPath('/project/core/serializers.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/serializers.py').reason, 'django-rest-serializers');
  assert.strictEqual(detectFrameworkFromPath('/project/core/viewsets.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/viewsets.py').reason, 'django-rest-viewsets');
  assert.strictEqual(detectFrameworkFromPath('/project/core/permissions.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/permissions.py').reason, 'django-rest-permissions');
  assert.strictEqual(detectFrameworkFromPath('/project/core/authentication.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/authentication.py').reason, 'django-rest-authentication');
  assert.strictEqual(detectFrameworkFromPath('/project/core/throttling.py').framework, 'django');
  assert.strictEqual(detectFrameworkFromPath('/project/core/throttling.py').reason, 'django-rest-throttling');

  // Java Spring
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/controllers/UserController.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/UserController.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/repositories/UserRepository.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/repositories/UserRepository.java').reason, 'spring-repository');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/config/AppConfig.java').framework, 'spring-boot');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/config/AppConfig.java').reason, 'spring-boot-config');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/client/UserClient.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/client/UserClient.java').reason, 'spring-feign-client');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/listener/EventListener.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/scheduler/TaskScheduler.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/task/BackgroundTask.java').framework, 'spring');

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

async function testDetectFrameworkFromContent() {
  // NestJS decorator
  const nestjsContent = `@Controller('users')\nexport class UserController {\n  @Get()\n  findAll() {}\n}`;
  const nestjsHint = await detectFrameworkFromContent('/project/src/users.controller.ts', nestjsContent);
  assert.strictEqual(nestjsHint.framework, 'nestjs');

  // Express routes
  const expressContent = `app.get('/users', (req, res) => {});`;
  const expressHint = await detectFrameworkFromContent('/project/src/expr.ts', expressContent);
  assert.strictEqual(expressHint.framework, 'express');

  // FastAPI
  const fastapiContent = `@app.get("/items/")\nasync def read_items():\n    return []`;
  const fastapiHint = await detectFrameworkFromContent('/project/main.py', fastapiContent);
  assert.strictEqual(fastapiHint.framework, 'fastapi');
  assert.strictEqual(fastapiHint.reason, 'fastapi-decorator');

  // Flask
  const flaskContent = `@app.route('/')\ndef hello():\n    return 'Hello'`;
  const flaskHint = await detectFrameworkFromContent('/project/app.py', flaskContent);
  assert.strictEqual(flaskHint.framework, 'flask');
  assert.strictEqual(flaskHint.reason, 'flask-decorator');

  // Flask blueprint route (verifies AST-Query pre-filter handles arbitrary object names)
  const flaskBlueprintContent = `from flask import Blueprint\nbp = Blueprint('api', __name__)\n\n@bp.route('/users')\ndef users():\n    return []`;
  const flaskBlueprintHint = await detectFrameworkFromContent('/project/routes.py', flaskBlueprintContent);
  assert.strictEqual(flaskBlueprintHint.framework, 'flask');
  assert.strictEqual(flaskBlueprintHint.reason, 'flask-decorator');

  // Spring annotation
  const springContent = `@RestController\npublic class UserController {\n  @GetMapping("/users")\n}`;
  const springHint = await detectFrameworkFromContent('/project/MyApi.java', springContent);
  assert.strictEqual(springHint.framework, 'spring');

  // Spring Boot annotations
  const springBootContent = `@SpringBootApplication\npublic class DemoApplication {\n  public static void main(String[] args) {}\n}`;
  const springBootHint = await detectFrameworkFromContent('/project/Demo.java', springBootContent);
  assert.strictEqual(springBootHint.framework, 'spring-boot');

  const configContent = `@Configuration\npublic class AppConfig {\n  @Bean\n}`;
  const configHint = await detectFrameworkFromContent('/project/App.java', configContent);
  assert.strictEqual(configHint.framework, 'spring-boot');

  const adviceContent = `@ControllerAdvice\npublic class GlobalExceptionHandler {}`;
  const adviceHint = await detectFrameworkFromContent('/project/GlobalException.java', adviceContent);
  assert.strictEqual(adviceHint.framework, 'spring-boot');

  // Spring Cloud / Task annotations (P7)
  const feignContent = `@FeignClient(name = "user-service", url = "${'${user.service.url}'})
public interface UserClient {
  @GetMapping("/users/{id}")
}`;
  const feignHint = await detectFrameworkFromContent('/project/UserConnector.java', feignContent);
  assert.strictEqual(feignHint.framework, 'spring');
  assert.strictEqual(feignHint.reason, 'spring-annotation');

  const scheduledContent = `@Scheduled(fixedRate = 5000)
public void reportCurrentTime() {}`;
  const scheduledHint = await detectFrameworkFromContent('/project/ScheduledJobs.java', scheduledContent);
  assert.strictEqual(scheduledHint.framework, 'spring');
  assert.strictEqual(scheduledHint.reason, 'spring-annotation');

  // Spring extended annotations
  const requestMappingContent = `@RequestMapping("/api")
public class ApiController {}`;
  const requestMappingHint = await detectFrameworkFromContent('/project/Api.java', requestMappingContent);
  assert.strictEqual(requestMappingHint.framework, 'spring');
  assert.strictEqual(requestMappingHint.reason, 'spring-annotation');

  const asyncContent = `@Async
public void asyncTask() {}`;
  const asyncHint = await detectFrameworkFromContent('/project/AsyncRun.java', asyncContent);
  assert.strictEqual(asyncHint.framework, 'spring');
  assert.strictEqual(asyncHint.reason, 'spring-annotation');

  const eventListenerContent = `@EventListener
public void onEvent(MyEvent event) {}`;
  const eventListenerHint = await detectFrameworkFromContent('/project/EventReceiver.java', eventListenerContent);
  assert.strictEqual(eventListenerHint.framework, 'spring');
  assert.strictEqual(eventListenerHint.reason, 'spring-annotation');

  const kafkaListenerContent = `@KafkaListener(topics = "orders")
public void handleOrder(Order order) {}`;
  const kafkaListenerHint = await detectFrameworkFromContent('/project/OrderReceiver.java', kafkaListenerContent);
  assert.strictEqual(kafkaListenerHint.framework, 'spring');
  assert.strictEqual(kafkaListenerHint.reason, 'spring-annotation');

  // Go Gin
  const ginContent = `func handler(c *gin.Context) {\n  c.JSON(200, gin.H{})\n}`;
  const ginHint = await detectFrameworkFromContent('/project/handlers.go', ginContent);
  assert.strictEqual(ginHint.framework, 'gin');

  // Rust Actix
  const actixContent = `#[get("/")]\nasync fn index() -> impl Responder {\n  HttpResponse::Ok()\n}`;
  const actixHint = await detectFrameworkFromContent('/project/src/routes.rs', actixContent);
  assert.strictEqual(actixHint.framework, 'actix-web');

  // Django management command (use a non-special path so content detection is exercised)
  const djangoCommandContent = `from django.core.management.base import BaseCommand\n\nclass Command(BaseCommand):\n    help = 'Cleanup'`;
  const djangoCommandHint = await detectFrameworkFromContent('/project/core/cmd_cleanup.py', djangoCommandContent);
  assert.strictEqual(djangoCommandHint.framework, 'django');
  assert.strictEqual(djangoCommandHint.reason, 'django-command');

  // Django admin (use a non-special path so content detection is exercised)
  const djangoAdminContent = `from django.contrib import admin\nfrom .models import User\n\nadmin.site.register(User)`;
  const djangoAdminHint = await detectFrameworkFromContent('/project/core/site_admin.py', djangoAdminContent);
  assert.strictEqual(djangoAdminHint.framework, 'django');
  assert.strictEqual(djangoAdminHint.reason, 'django-admin');

  // Celery task
  const celeryContent = `from celery import shared_task\n\n@shared_task\ndef add(x, y):\n    return x + y`;
  const celeryHint = await detectFrameworkFromContent('/project/core/celery_tasks.py', celeryContent);
  assert.strictEqual(celeryHint.framework, 'celery');
  assert.strictEqual(celeryHint.reason, 'celery-task');

  // Celery app.task (attribute decorator)
  const celeryAppTaskContent = `from celery import Celery\napp = Celery('tasks')\n\n@app.task\ndef add(x, y):\n    return x + y`;
  const celeryAppTaskHint = await detectFrameworkFromContent('/project/worker.py', celeryAppTaskContent);
  assert.strictEqual(celeryAppTaskHint.framework, 'celery');
  assert.strictEqual(celeryAppTaskHint.reason, 'celery-task');

  // Django signals (P8)
  const signalContent = `from django.dispatch import receiver\nfrom django.db.models.signals import post_save\n\n@receiver(post_save, sender=User)\ndef user_post_save(sender, instance, created, **kwargs):\n    pass`;
  const signalHint = await detectFrameworkFromContent('/project/core/sig.py', signalContent);
  assert.strictEqual(signalHint.framework, 'django');
  assert.strictEqual(signalHint.reason, 'django-signal');

  const connectContent = `post_save.connect(user_post_save, sender=User)`;
  const connectHint = await detectFrameworkFromContent('/project/core/hnd.py', connectContent);
  assert.strictEqual(connectHint.framework, 'django');
  assert.strictEqual(connectHint.reason, 'django-signal');

  // Django REST framework
  const drfViewsetContent = `from rest_framework import viewsets
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()`;
  const drfViewsetHint = await detectFrameworkFromContent('/project/core/users.py', drfViewsetContent);
  assert.strictEqual(drfViewsetHint.framework, 'django');
  assert.strictEqual(drfViewsetHint.reason, 'django-rest-framework');

  const drfSerializerContent = `from rest_framework import serializers
class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User`;
  const drfSerializerHint = await detectFrameworkFromContent('/project/core/user_serialization.py', drfSerializerContent);
  assert.strictEqual(drfSerializerHint.framework, 'django');
  assert.strictEqual(drfSerializerHint.reason, 'django-rest-framework');

  const drfPermissionContent = `from rest_framework.permissions import BasePermission
class IsOwner(BasePermission):`;
  const drfPermissionHint = await detectFrameworkFromContent('/project/core/user_auth.py', drfPermissionContent);
  assert.strictEqual(drfPermissionHint.framework, 'django');
  assert.strictEqual(drfPermissionHint.reason, 'django-rest-framework');

  // Vue script setup compiler macros
  const vueMacroContent = `<script setup>\nconst props = defineProps({ foo: String });\nconst emit = defineEmits(['click']);\ndefineExpose({ bar: 1 });\n</script>`;
  const vueMacroHint = await detectFrameworkFromContent('/project/comp.js', vueMacroContent);
  assert.strictEqual(vueMacroHint.framework, 'vue');
  assert.strictEqual(vueMacroHint.reason, 'vue-script-setup-macro');
  assert.strictEqual(vueMacroHint.isEntry, true);

  // No match
  const plainContent = `function add(a, b) { return a + b; }`;
  assert.strictEqual(await detectFrameworkFromContent('/project/utils.ts', plainContent), null);
}

async function testIsEntryFlag() {
  // Entry files
  assert.strictEqual(detectFrameworkFromPath('/project/app/page.tsx').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.go').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.rs').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/DemoApplication.java').isEntry, true);
  assert.strictEqual((await detectFrameworkFromContent('/project/Demo.java', '@SpringBootApplication\npublic class DemoApplication {}')).isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/management/commands/cleanup.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/views/login.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/task_management/views_coordination.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/admin.py').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/core/tasks.py').isEntry, true);

  // Non-entry files
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Button.tsx').isEntry, false);
  assert.strictEqual(detectFrameworkFromPath('/project/prisma/schema.prisma').isEntry, false);
  const helperHint = await detectFrameworkFromContent('/project/Helper.java', 'public class Helper {}');
  assert.strictEqual(helperHint?.isEntry ?? false, false);
}

async function testEntryPointWeight() {
  // P103: HIGH (3.0) — page, controller, views, main, application
  assert.strictEqual(detectFrameworkFromPath('/project/app/page.tsx').entryPointWeight, 3.0);
  assert.strictEqual(detectFrameworkFromPath('/project/pages/index.tsx').entryPointWeight, 3.0);
  assert.strictEqual(detectFrameworkFromPath('/project/blog/views.py').entryPointWeight, 3.0);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/DemoApplication.java').entryPointWeight, 3.0);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.go').entryPointWeight, 3.0);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.rs').entryPointWeight, 3.0);

  // MEDIUM_HIGH (2.5) — layout, routes, URLs, handlers
  assert.strictEqual(detectFrameworkFromPath('/project/app/layout.tsx').entryPointWeight, 2.5);
  assert.strictEqual(detectFrameworkFromPath('/project/src/routes/user.ts').entryPointWeight, 2.5);
  assert.strictEqual(detectFrameworkFromPath('/project/blog/urls.py').entryPointWeight, 2.5);

  // MEDIUM (2.0) — admin, middleware, etc.
  assert.strictEqual(detectFrameworkFromPath('/project/blog/admin.py').entryPointWeight, 2.0);
  assert.strictEqual(detectFrameworkFromPath('/project/blog/tasks.py').entryPointWeight, 2.0);

  // MINIMAL (1.0) — manage.py
  assert.strictEqual(detectFrameworkFromPath('/project/manage.py').entryPointWeight, 1.0);

  // Non-entry files have no weight
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Button.tsx').entryPointWeight, undefined);
  assert.strictEqual(detectFrameworkFromPath('/project/prisma/schema.prisma').entryPointWeight, undefined);

  // Content-based detection also carries weight
  const sbHint = await detectFrameworkFromContent('/project/Demo.java', '@SpringBootApplication\npublic class DemoApplication {}');
  assert.strictEqual(sbHint.entryPointWeight, 3.0);
}

async function run() {
  testDetectFrameworkFromPath();
  await testDetectFrameworkFromContent();
  await testIsEntryFlag();
  await testEntryPointWeight();
  console.log('framework-patterns-test.js PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
