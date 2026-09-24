// @semantic
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _readTsconfigPaths } = require('../src/services/dep-graph/resolvers/base');
const { tryAlias } = require('../src/services/dep-graph/resolvers/javascript');

function testSingleLevelExtends() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tsconfig-extends-'));
  try {
    // Base config
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.base.json'), JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@base/*': ['src/base/*']
        }
      }
    }));

    // Child config extending base
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: {
        paths: {
          '@app/*': ['src/app/*']
        }
      }
    }));

    fs.mkdirSync(path.join(tmpDir, 'src', 'base'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'app'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'base', 'util.ts'), 'export const util = 1;');
    fs.writeFileSync(path.join(tmpDir, 'src', 'app', 'main.ts'), 'export const main = 2;');

    const config = _readTsconfigPaths(tmpDir);
    assert.ok(config, 'should load config');
    assert.ok(config.paths['@base/*'], 'should inherit @base/* from parent');
    assert.ok(config.paths['@app/*'], 'should have @app/* from child');

    const ctx = { root: tmpDir, outMeta: {} };
    const resolvedBase = tryAlias('@base/util', path.join(tmpDir, 'src/app/main.ts'), ctx);
    assert.strictEqual(resolvedBase, path.join(tmpDir, 'src/base/util.ts'), 'should resolve inherited alias');

    const resolvedApp = tryAlias('@app/main', path.join(tmpDir, 'src/app/main.ts'), ctx);
    assert.strictEqual(resolvedApp, path.join(tmpDir, 'src/app/main.ts'), 'should resolve local alias');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testMonorepoSubpackageExtends() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tsconfig-monorepo-'));
  try {
    // Root base config
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.base.json'), JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@shared/*': ['packages/shared/src/*']
        }
      }
    }));

    // Package A
    const pkgADir = path.join(tmpDir, 'packages', 'pkg-a');
    fs.mkdirSync(path.join(pkgADir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgADir, 'tsconfig.json'), JSON.stringify({
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['src/*']
        }
      }
    }));
    fs.writeFileSync(path.join(pkgADir, 'src', 'button.tsx'), 'export const Button = null;');
    fs.writeFileSync(path.join(pkgADir, 'src', 'index.ts'), 'import { Button } from "@/button";');

    // Package Shared
    const sharedDir = path.join(tmpDir, 'packages', 'shared', 'src');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'math.ts'), 'export const add = (a, b) => a + b;');

    const fileInA = path.join(pkgADir, 'src', 'index.ts');
    const ctx = { root: tmpDir, outMeta: {} };

    // Resolve local @/ in pkg-a
    const resolvedLocal = tryAlias('@/button', fileInA, ctx);
    assert.strictEqual(resolvedLocal, path.join(pkgADir, 'src', 'button.tsx'), 'should resolve local subpackage alias');

    // Resolve shared @shared/ from root base
    const resolvedShared = tryAlias('@shared/math', fileInA, ctx);
    assert.strictEqual(resolvedShared, path.join(sharedDir, 'math.ts'), 'should resolve shared alias from base tsconfig');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testCircularExtendsProtection() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tsconfig-circular-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.a.json'), JSON.stringify({
      extends: './tsconfig.b.json',
      compilerOptions: { paths: { '@a/*': ['src/a/*'] } }
    }));
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.b.json'), JSON.stringify({
      extends: './tsconfig.a.json',
      compilerOptions: { paths: { '@b/*': ['src/b/*'] } }
    }));
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      extends: './tsconfig.a.json'
    }));

    // Should not throw or stack overflow
    const config = _readTsconfigPaths(tmpDir);
    assert.ok(config, 'should handle circular extends gracefully');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

testSingleLevelExtends();
testMonorepoSubpackageExtends();
testCircularExtendsProtection();

console.log('tsconfig-extends-test.js: all passed');
