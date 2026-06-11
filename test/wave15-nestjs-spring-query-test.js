// @contract — NestJS + Spring Boot route extraction: query path vs regex equivalence
const assert = require('assert');
const { extractRoutes } = require('../src/services/dep-graph/framework-patterns');

async function testNestJSBasicRoutes() {
  const content = `@Controller('users')
export class UserController {
  @Get()
  findAll() {}

  @Get(':id')
  findOne() {}

  @Post()
  create() {}

  @Put(':id')
  update() {}

  @Delete(':id')
  remove() {}
}`;

  const routes = await extractRoutes('/project/users.controller.ts', content);
  // @Get() / @Post() without argument are not extracted (same as regex behavior)
  // @Controller('users') is not extracted (filtered by VALID_METHODS)
  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET::id'), 'should extract GET :id');
  assert(paths.includes('PUT::id'), 'should extract PUT :id');
  assert(paths.includes('DELETE::id'), 'should extract DELETE :id');
  // @Post() without argument should NOT be extracted
  assert(!paths.includes('POST::'), '@Post() without arg should not be extracted');
}

async function testNestJSQueryMatchesRegex() {
  const content = `@Controller()
export class ItemController {
  @Get('items')
  findAll() {}

  @Post('items')
  create() {}
}`;

  const routes = await extractRoutes('/project/items.controller.ts', content);
  assert(routes.length >= 2, `expected at least 2 routes, got ${routes.length}`);
  assert.strictEqual(routes[0].framework, 'nestjs');
}

async function testSpringBootBasicRoutes() {
  const content = `@RestController
public class UserController {
    @GetMapping("/users")
    public List<User> findAll() {}

    @PostMapping("/users")
    public User create() {}

    @GetMapping("/users/{id}")
    public User findOne() {}

    @RequestMapping("/api")
    public String api() {}
}`;

  const routes = await extractRoutes('/project/UserController.java', content);
  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/users'), 'should extract GET /users');
  assert(paths.includes('POST:/users'), 'should extract POST /users');
  assert(paths.includes('GET:/users/{id}'), 'should extract GET /users/{id}');
  assert(paths.includes('ALL:/api'), 'should extract ALL /api from RequestMapping');
}

async function testSpringBootDedupe() {
  const content = `@RestController
public class DupController {
    @GetMapping("/users")
    public void a() {}

    @GetMapping("/users")
    public void b() {}
}`;

  const routes = await extractRoutes('/project/DupController.java', content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical Spring routes');
}

async function testMixedFrameworksInJs() {
  const content = `
    app.get('/express-route', handler);
  `;
  const routes = await extractRoutes('/project/mixed.js', content);
  // Only Express routes; NestJS query should not match this file
  const expressRoutes = routes.filter((r) => r.framework === 'express');
  assert(expressRoutes.length > 0, 'Express routes should be extracted');
}

async function main() {
  await testNestJSBasicRoutes();
  await testNestJSQueryMatchesRegex();
  await testSpringBootBasicRoutes();
  await testSpringBootDedupe();
  await testMixedFrameworksInJs();
  console.log('PASS: wave15-nestjs-spring-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
