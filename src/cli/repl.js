/**
 * workspace-bridge REPL
 * Interactive query shell for large projects.
 * Dep-graph stays hot in memory — no full rebuild per query.
 */
const readline = require('readline');
const path = require('path');
const { ServiceContainer } = require('../services/container');
const { TIMEOUTS, DEFAULTS, SCORING } = require('../config/constants');
const { buildProjectMap, countTreeFiles } = require('./formatters/project-map');
const { parseArgs } = require('../utils/parse-args');

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

function countDirectories(tree) {
  if (!Array.isArray(tree)) return 0;
  let count = 0;
  for (const node of tree) {
    if (node.type === 'directory') {
      count += 1;
      count += countDirectories(node.children || []);
    }
  }
  return count;
}

function formatProjectMap(result, compact) {
  const lines = [];
  if (compact) {
    lines.push(`directories: ${countDirectories(result.tree)}`);
    lines.push(`files: ${countTreeFiles(result.tree)}`);
    lines.push(`edges: ${result.edges?.length ?? 0}`);
    lines.push(`highlightedFiles: ${result.highlightedFiles?.length ?? 0}`);
  } else {
    lines.push(`workspaceRoot: ${result.workspaceRoot}`);
    lines.push(`files: ${countTreeFiles(result.tree)}`);
    lines.push(`edges: ${result.edges?.length ?? 0}`);
  }
  const overlay = result.issueOverlay || {};
  lines.push(`deadExports: ${overlay.deadExports?.length ?? 0}`);
  lines.push(`unresolved: ${overlay.unresolved?.length ?? 0}`);
  lines.push(`cycles: ${overlay.cycles?.length ?? 0}`);
  lines.push(`orphans: ${overlay.orphans?.length ?? 0}`);
  if (!compact) {
    lines.push(`hotspots: ${overlay.hotspots?.length ?? 0}`);
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
  audit-map [--compact]
  issues                  Summary of structural issues (dead-exports, unresolved, cycles)
  top                     Top 5 hotspot files by dependent count
  dead-exports
  unresolved
  cycles
  dependents <file>
  dependencies <file>
  stats
  help
  exit / quit`;

    case 'impact': {
      const parsed = parseArgs(['node', 'repl', ...args], {
        '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
      });
      const file = parsed._[0];
      if (!file) return 'Usage: impact <file>';
      const maxDepth = Number.isFinite(parsed.maxDepth) && parsed.maxDepth > 0 ? parsed.maxDepth : 3;
      const result = container.depGraph.getImpactRadius(file, maxDepth);
      return formatImpact(result);
    }

    case 'affected-tests': {
      const parsed = parseArgs(['node', 'repl', ...args], {
        '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
      });
      const file = parsed._[0];
      if (!file) return 'Usage: affected-tests <file>';
      const maxDepth = Number.isFinite(parsed.maxDepth) && parsed.maxDepth > 0 ? parsed.maxDepth : 5;
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

    case 'audit-map': {
      const parsed = parseArgs(['node', 'repl', ...args], { '--compact': true });
      const compact = Boolean(parsed['--compact']);
      const result = buildProjectMap(container.depGraph, { compact });
      if (!result.ok) return `Error: ${result.error}`;
      return formatProjectMap(result, compact);
    }

    case 'issues': {
      const deadExports = container.depGraph.findDeadExports?.() || [];
      const unresolved = container.depGraph.findUnresolvedImports?.() || [];
      const cycles = container.depGraph.findCircularDependencies?.() || [];

      let severity = 'low';
      if (unresolved.length > 0 || cycles.length > 0) severity = 'high';
      else if (deadExports.length > 0) severity = 'medium';

      const lines = [`severity: ${severity}`];
      lines.push(`deadExports: ${deadExports.length}`);
      lines.push(`unresolved: ${unresolved.length}`);
      lines.push(`cycles: ${cycles.length}`);

      if (deadExports.length > 0) {
        const list = deadExports.slice(0, DEFAULTS.REPL_ISSUES_LIMIT).map((d) => d.file).join(', ');
        lines.push(`  → ${list}${deadExports.length > 3 ? ' + more' : ''}`);
      }
      if (unresolved.length > 0) {
        const list = unresolved.slice(0, DEFAULTS.REPL_ISSUES_LIMIT).map((u) => `${u.file}: ${u.import}`).join(', ');
        lines.push(`  → ${list}${unresolved.length > 3 ? ' + more' : ''}`);
      }
      if (cycles.length > 0) {
        const list = cycles.slice(0, DEFAULTS.REPL_TOP_LIMIT).map((c) => c.join(' -> ')).join('; ');
        lines.push(`  → ${list}${cycles.length > 2 ? ' + more' : ''}`);
      }

      const nextSteps = [];
      if (unresolved.length > 0) nextSteps.push(`Inspect ${unresolved.length} unresolved import(s) first — likely broken code path`);
      if (cycles.length > 0) nextSteps.push(`Break ${cycles.length} dependency cycle(s) before broad refactors`);
      if (deadExports.length > 0) nextSteps.push(`Review ${deadExports.length} dead export(s) as deletion candidates (verify dynamic loading)`);
      if (nextSteps.length === 0) nextSteps.push('No immediate structural issues detected.');

      lines.push('nextSteps:');
      for (const step of nextSteps.slice(0, DEFAULTS.REPL_ISSUES_LIMIT)) {
        lines.push(`  - ${step}`);
      }

      return lines.join('\n');
    }

    case 'top': {
      const allFiles = Array.from(container.depGraph.graph?.keys() || []);
      const hotspots = [];
      for (const file of allFiles) {
        const dependents = container.depGraph.getDependents?.(file) || [];
        if (dependents.length >= SCORING.HOTSPOT_MIN_DEPENDENTS) {
          hotspots.push({ file, dependentCount: dependents.length });
        }
      }
      hotspots.sort((a, b) => b.dependentCount - a.dependentCount);

      if (hotspots.length === 0) {
        return `No hotspots detected (threshold: ${SCORING.HOTSPOT_MIN_DEPENDENTS} dependents).`;
      }

      const lines = [];
      const root = container.depGraph.workspaceRoot || '';
      for (let i = 0; i < Math.min(hotspots.length, 5); i++) {
        const h = hotspots[i];
        const rel = path.relative(root, h.file) || h.file;
        lines.push(`hotspot-${i + 1}: ${rel} (${h.dependentCount} dependents)`);
      }
      return lines.join('\n');
    }

    default:
      return `Unknown command: ${cmd}. Type "help" for available commands.`;
  }
}

async function startRepl(options) {
  const container = new ServiceContainer();
  let rl = null;

  try {
    const initialized = await container.initialize(options.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: true,
      excludeDirs: options.exclude || [],
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    console.error(`workspace-bridge REPL — ${container.workspaceRoot}`);
    console.error('Type "help" for commands, "exit" or "quit" to quit.\n');

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    rl.on('SIGINT', () => {
      rl.close();
      // for await...of loop naturally ends, enters finally
    });

    // Defensive: fast double Ctrl+C may bypass rl's SIGINT handler
    const sigintHandler = () => {
      if (rl) rl.close();
    };
    process.on('SIGINT', sigintHandler);

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

    console.error('\nGoodbye.');
  } catch (err) {
    console.error('REPL failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (rl) rl.close();
    process.removeListener('SIGINT', sigintHandler);
    await container.shutdown();
  }
}

module.exports = {
  startRepl,
  executeCommand,
};
