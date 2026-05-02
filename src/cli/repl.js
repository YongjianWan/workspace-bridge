/**
 * workspace-bridge REPL
 * Interactive query shell for large projects.
 * Dep-graph stays hot in memory — no full rebuild per query.
 */
const readline = require('readline');
const { ServiceContainer } = require('../services/container');

function formatImpact(result) {
  const lines = [`impactCount: ${result.length}`];
  for (const entry of result) {
    lines.push(`  level-${entry.level}: ${entry.file}`);
  }
  return lines.join('\n');
}

function formatAffectedTests(result) {
  const lines = [`affectedTestCount: ${result.length}`];
  for (const entry of result) {
    lines.push(`  distance-${entry.distance}: ${entry.file}`);
  }
  return lines.join('\n');
}

function formatDeadExports(result) {
  const lines = [`deadExportCount: ${result.length}`];
  for (const entry of result) {
    lines.push(`  ${entry.file}: ${entry.exports.join(', ')} (${entry.confidence})`);
  }
  return lines.join('\n');
}

function formatUnresolved(result) {
  const lines = [`unresolvedCount: ${result.length}`];
  for (const entry of result) {
    lines.push(`  ${entry.file}: ${entry.import}`);
  }
  return lines.join('\n');
}

function formatCycles(result) {
  const lines = [`cycleCount: ${result.length}`];
  for (const cycle of result) {
    lines.push(`  ${cycle.join(' -> ')}`);
  }
  return lines.join('\n');
}

function formatDependents(result) {
  const lines = [`dependentCount: ${result.length}`];
  for (const d of result) {
    lines.push(`  ← ${d}`);
  }
  return lines.join('\n');
}

function formatDependencies(result) {
  const lines = [`dependencyCount: ${result.length}`];
  for (const d of result) {
    lines.push(`  → ${d}`);
  }
  return lines.join('\n');
}

function formatStats(result) {
  return [
    `files: ${result.files}`,
    `totalImports: ${result.totalImports}`,
    `totalExports: ${result.totalExports}`,
    `cycles: ${result.cycles}`,
  ].join('\n');
}

async function executeCommand(container, line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const [cmd, ...args] = tokens;

  switch (cmd) {
    case 'help':
      return `Commands:
  impact <file> [--max-depth <n>]
  affected-tests <file> [--max-depth <n>]
  dead-exports
  unresolved
  cycles
  dependents <file>
  dependencies <file>
  stats
  help
  exit`;

    case 'impact': {
      const file = args[0];
      if (!file) return 'Usage: impact <file>';
      let maxDepth = 3;
      const depthIdx = args.indexOf('--max-depth');
      if (depthIdx !== -1 && args[depthIdx + 1]) {
        maxDepth = Number.parseInt(args[depthIdx + 1], 10);
      }
      const result = container.depGraph.getImpactRadius(file, maxDepth);
      return formatImpact(result);
    }

    case 'affected-tests': {
      const file = args[0];
      if (!file) return 'Usage: affected-tests <file>';
      let maxDepth = 5;
      const depthIdx = args.indexOf('--max-depth');
      if (depthIdx !== -1 && args[depthIdx + 1]) {
        maxDepth = Number.parseInt(args[depthIdx + 1], 10);
      }
      const result = container.depGraph.findAffectedTests(file, maxDepth);
      return formatAffectedTests(result);
    }

    case 'dead-exports': {
      const result = container.depGraph.findDeadExports();
      return formatDeadExports(result);
    }

    case 'unresolved': {
      const result = container.depGraph.findUnresolvedImports();
      return formatUnresolved(result);
    }

    case 'cycles': {
      const result = container.depGraph.findCircularDependencies();
      return formatCycles(result);
    }

    case 'dependents': {
      const file = args[0];
      if (!file) return 'Usage: dependents <file>';
      const result = container.depGraph.getDependents(file);
      return formatDependents(result);
    }

    case 'dependencies': {
      const file = args[0];
      if (!file) return 'Usage: dependencies <file>';
      const result = container.depGraph.getDependencies(file);
      return formatDependencies(result);
    }

    case 'stats': {
      const result = container.depGraph.getStats();
      return formatStats(result);
    }

    default:
      return `Unknown command: ${cmd}. Type "help" for available commands.`;
  }
}

async function startRepl(options) {
  const container = new ServiceContainer();

  try {
    const initialized = await container.initialize(options.cwd, 60000, {
      watch: true,
      excludeDirs: options.exclude || [],
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    console.error(`workspace-bridge REPL — ${container.workspaceRoot}`);
    console.error('Type "help" for commands, "exit" to quit.\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    rl.setPrompt('> ');

    rl.setPrompt('> ');
    rl.prompt();

    for await (const line of rl) {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        continue;
      }

      const [cmd] = input.split(/\s+/);
      if (cmd === 'exit' || cmd === 'quit') {
        break;
      }

      const startTime = Date.now();
      try {
        const output = await executeCommand(container, input);
        if (output !== null) {
          console.log(output);
        }
        if (process.env.DEBUG) {
          console.error(`[REPL] ${input} completed in ${Date.now() - startTime}ms`);
        }
      } catch (e) {
        console.error(`Error: ${e.message}`);
      }

      rl.prompt();
    }

    rl.close();
    console.error('\nGoodbye.');
    await container.shutdown();
  } catch (err) {
    console.error('REPL failed:', err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  startRepl,
  executeCommand,
};
