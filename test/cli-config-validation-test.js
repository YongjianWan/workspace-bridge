// @contract
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ProjectContext, loadWorkspaceConfig } = require('../src/utils/project-context');
const { runCliInProcess } = require('../cli');

function setupTempWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-config-val-'));
  const configPath = path.join(tmpDir, '.workspace-bridge.json');
  return { tmpDir, configPath };
}

function cleanupTempWorkspace(tmpDir) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}

function testValidConfig() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const validConfig = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      directories: {
        active: ['src', 'lib'],
        reference: ['test'],
        archive: ['legacy'],
        generated: ['dist']
      },
      directoryRoles: {
        'src/utils': 'active'
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(validConfig), 'utf8');

    // Should load successfully
    const wsConfig = loadWorkspaceConfig(tmpDir);
    assert.ok(wsConfig);
    assert.deepStrictEqual(wsConfig.directories.active, ['src', 'lib', 'src/utils']);

    const ctx = new ProjectContext(tmpDir);
    assert.ok(ctx);
    assert.deepStrictEqual(ctx.config.directories.active, ['src', 'lib']);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testUnknownTopLevelKey() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directories: { active: ['src'] },
      invalidKey: 'what'
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /Unknown top-level key "invalidKey"/);

    assert.throws(() => {
      new ProjectContext(tmpDir);
    }, /Unknown top-level key "invalidKey"/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testInvalidDirectoriesType() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directories: 'not-an-object'
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /"directories" must be an object/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testInvalidDirectoryArrayType() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directories: {
        active: 'not-an-array'
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /directories\.active must be an array/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testInvalidDirectoryArrayContents() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directories: {
        active: ['src', 123]
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /directories\.active must be an array of strings/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testInvalidDirectoryRolesType() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directoryRoles: 'not-an-object'
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /"directoryRoles" must be an object/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testInvalidDirectoryRolesContents() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directoryRoles: {
        'src/utils': 123
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /directoryRoles keys and values must be strings/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

function testInvalidDirectoryRoleValue() {
  const { tmpDir, configPath } = setupTempWorkspace();
  try {
    const invalidConfig = {
      directoryRoles: {
        'src/utils': 'invalid-role'
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig), 'utf8');

    assert.throws(() => {
      loadWorkspaceConfig(tmpDir);
    }, /Unknown role "invalid-role"/);
  } finally {
    cleanupTempWorkspace(tmpDir);
  }
}

async function testJsonCliArgErrors() {
  // Test runCliInProcess returns JSON error when validation fails and JSON is requested
  const result = await runCliInProcess(['audit-summary', '--severity', 'invalid-severity', '--json']);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stdout);
  assert.strictEqual(result.stderr, '');

  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.ok, false);
  assert.ok(payload.error.includes('Invalid --severity value'));
}

async function testJsonCliFormatArgErrors() {
  // Test runCliInProcess returns JSON error when validation fails and --format json is requested
  const result = await runCliInProcess(['audit-summary', '--severity', 'invalid-severity', '--format', 'json']);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stdout);
  assert.strictEqual(result.stderr, '');

  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.ok, false);
  assert.ok(payload.error.includes('Invalid --severity value'));
}

async function main() {
  testValidConfig();
  testUnknownTopLevelKey();
  testInvalidDirectoriesType();
  testInvalidDirectoryArrayType();
  testInvalidDirectoryArrayContents();
  testInvalidDirectoryRolesType();
  testInvalidDirectoryRolesContents();
  testInvalidDirectoryRoleValue();
  await testJsonCliArgErrors();
  await testJsonCliFormatArgErrors();
  console.log('cli-config-validation-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
