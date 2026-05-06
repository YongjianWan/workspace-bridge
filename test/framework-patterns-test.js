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
  assert.strictEqual(detectFrameworkFromPath('/project/api/routers/users.py').framework, 'fastapi');

  // Java Spring
  assert.strictEqual(detectFrameworkFromPath('/project/src/main/java/com/example/controllers/UserController.java').framework, 'spring');
  assert.strictEqual(detectFrameworkFromPath('/project/UserController.java').framework, 'spring');

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

  // Go Gin
  const ginContent = `func handler(c *gin.Context) {\n  c.JSON(200, gin.H{})\n}`;
  const ginHint = detectFrameworkFromContent('/project/handlers.go', ginContent);
  assert.strictEqual(ginHint.framework, 'gin');

  // Rust Actix
  const actixContent = `#[get("/")]\nasync fn index() -> impl Responder {\n  HttpResponse::Ok()\n}`;
  const actixHint = detectFrameworkFromContent('/project/src/routes.rs', actixContent);
  assert.strictEqual(actixHint.framework, 'actix-web');

  // No match
  const plainContent = `function add(a, b) { return a + b; }`;
  assert.strictEqual(detectFrameworkFromContent('/project/utils.ts', plainContent), null);
}

function testIsEntryFlag() {
  // Entry files
  assert.strictEqual(detectFrameworkFromPath('/project/app/page.tsx').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.go').isEntry, true);
  assert.strictEqual(detectFrameworkFromPath('/project/src/main.rs').isEntry, true);

  // Non-entry files
  assert.strictEqual(detectFrameworkFromPath('/project/src/components/Button.tsx').isEntry, false);
  assert.strictEqual(detectFrameworkFromPath('/project/prisma/schema.prisma').isEntry, false);
}

function run() {
  testDetectFrameworkFromPath();
  testDetectFrameworkFromContent();
  testIsEntryFlag();
  console.log('framework-patterns-test.js: all passed');
}

run();
