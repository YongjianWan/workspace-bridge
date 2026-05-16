#!/usr/bin/env node
/**
 * Regression test for #40: REPL double Ctrl+C leak.
 * Verifies that container.shutdown() is called exactly once and is
 * protected by a shuttingDown guard and try-catch.
 */
const assert = require('assert');

async function testShutdownGuardAndErrorHandling() {
  const replPath = require.resolve('../src/cli/repl');
  const containerPath = require.resolve('../src/services/container');
  const readlinePath = require.resolve('readline');

  // Remove cached repl module so our patches take effect before it requires deps.
  delete require.cache[replPath];

  const originalIsTTY = process.stdin.isTTY;
  process.stdin.isTTY = true;

  const OriginalContainer = require(containerPath).ServiceContainer;
  let shutdownCount = 0;
  require(containerPath).ServiceContainer = class MockContainer {
    async initialize() {
      return true;
    }
    async shutdown() {
      shutdownCount++;
      await new Promise((r) => setTimeout(r, 50));
    }
    get workspaceRoot() {
      return '/tmp';
    }
    get depGraph() {
      return {
        workspaceRoot: '/tmp',
        graph: new Map(),
        entryFiles: new Set(),
        getImpactRadius: () => [],
        findAffectedTests: () => [],
        findDeadExports: () => [],
        findUnresolvedImports: () => [],
        findCircularDependencies: () => [],
        getDependents: () => [],
        getDependencies: () => [],
        getStats: () => ({ files: 0, totalImports: 0, totalExports: 0, cycles: 0 }),
      };
    }
  };

  const originalCreateInterface = require(readlinePath).createInterface;
  let sigintHandler = null;
  let closeResolver = null;
  require(readlinePath).createInterface = function () {
    return {
      on(event, handler) {
        if (event === 'SIGINT') sigintHandler = handler;
      },
      close() {
        if (closeResolver) closeResolver();
      },
      prompt() {},
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise((resolve) => {
              closeResolver = () => resolve({ done: true });
            });
          },
        };
      },
    };
  };

  const { startRepl } = require(replPath);

  try {
    const replPromise = startRepl({ cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 30));

    // Simulate readline SIGINT (first Ctrl+C)
    if (sigintHandler) sigintHandler();

    // Simulate process SIGINT during shutdown (second Ctrl+C)
    process.emit('SIGINT');

    await replPromise;

    assert.strictEqual(shutdownCount, 1, 'shutdown should be called exactly once');
  } finally {
    require(containerPath).ServiceContainer = OriginalContainer;
    require(readlinePath).createInterface = originalCreateInterface;
    delete require.cache[replPath];
    process.stdin.isTTY = originalIsTTY;
  }
}

async function testShutdownErrorCaught() {
  const replPath = require.resolve('../src/cli/repl');
  const containerPath = require.resolve('../src/services/container');
  const readlinePath = require.resolve('readline');

  delete require.cache[replPath];

  const originalIsTTY = process.stdin.isTTY;
  process.stdin.isTTY = true;

  const OriginalContainer = require(containerPath).ServiceContainer;
  let shutdownCalled = false;
  require(containerPath).ServiceContainer = class MockContainer {
    async initialize() {
      return true;
    }
    async shutdown() {
      shutdownCalled = true;
      throw new Error('shutdown explosion');
    }
    get workspaceRoot() {
      return '/tmp';
    }
    get depGraph() {
      return {
        workspaceRoot: '/tmp',
        graph: new Map(),
        entryFiles: new Set(),
        getImpactRadius: () => [],
        findAffectedTests: () => [],
        findDeadExports: () => [],
        findUnresolvedImports: () => [],
        findCircularDependencies: () => [],
        getDependents: () => [],
        getDependencies: () => [],
        getStats: () => ({ files: 0, totalImports: 0, totalExports: 0, cycles: 0 }),
      };
    }
  };

  const originalCreateInterface = require(readlinePath).createInterface;
  let closeResolver = null;
  require(readlinePath).createInterface = function () {
    return {
      on() {},
      close() {
        if (closeResolver) closeResolver();
      },
      prompt() {},
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise((resolve) => {
              closeResolver = () => resolve({ done: true });
            });
          },
        };
      },
    };
  };

  const { startRepl } = require(replPath);

  try {
    const replPromise = startRepl({ cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 30));
    if (closeResolver) closeResolver();
    await replPromise;

    assert(shutdownCalled, 'shutdown should have been called');
    // If we reach here, the uncaught exception did not crash the process.
  } finally {
    require(containerPath).ServiceContainer = OriginalContainer;
    require(readlinePath).createInterface = originalCreateInterface;
    delete require.cache[replPath];
    process.stdin.isTTY = originalIsTTY;
  }
}

async function main() {
  await testShutdownGuardAndErrorHandling();
  await testShutdownErrorCaught();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
