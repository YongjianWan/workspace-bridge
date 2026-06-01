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
const { resolveWorkspaceFilePath } = require('../utils/path');
const { buildTree } = require('../tools/tree-tools');

function formatImpact(result) {
  const lines = [`impactCount: ${result.length}`];
  for (const entry of result) {
    lines.push(`  level-${entry.level}: ${entry.file}`);
  }
  return lines.join('\n');
}

function formatAffectedTests(result) {
  const lines = [`affectedTestsCount: ${result.length}`];
  for (const entry of result) {
    lines.push(`  distance-${entry.distance}: ${entry.file}`);
  }
  return lines.join('\n');
}

function formatDeadExports(result) {
  const lines = [`deadExportsCount: ${result.length}`];
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
  const lines = [`cyclesCount: ${result.length}`];
  for (const cycle of result) {
    lines.push(`  ${cycle.join(' -> ')}`);
  }
  return lines.join('\n');
}

function formatDependents(result) {
  const lines = [`dependentsCount: ${result.length}`];
  for (const d of result) {
    lines.push(`  ← ${d}`);
  }
  return lines.join('\n');
}

function formatDependencies(result) {
  const lines = [`dependenciesCount: ${result.length}`];
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

function formatTreeNode(node, prefix = '') {
  const lines = [];
  if (node.imports) {
    for (const imp of node.imports) {
      const tag = imp.external ? ' [external]' : (imp.circular ? ' [circular]' : '');
      lines.push(`${prefix}→ ${imp.file}${tag}`);
      if (imp.imports || imp.dependents) {
        lines.push(...formatTreeNode(imp, prefix + '  '));
      }
    }
  }
  if (node.dependents) {
    for (const dep of node.dependents) {
      const tag = dep.circular ? ' [circular]' : '';
      lines.push(`${prefix}← ${dep.file}${tag}`);
      if (dep.imports || dep.dependents) {
        lines.push(...formatTreeNode(dep, prefix + '  '));
      }
    }
  }
  return lines;
}

function formatTree(tree) {
  const lines = [];
  if (tree) {
    lines.push(`file: ${tree.file}`);
    lines.push(...formatTreeNode(tree, '  '));
  }
  return lines.join('\n');
}

async function executeCommand(container, line, options = {}) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const [cmd, ...args] = tokens;
  const graph = container.snapshot?.graph || container.depGraph || null;
  if (!graph) return options.structured ? { error: 'dependency graph not available' } : 'Error: dependency graph not available';

  switch (cmd) {
    case 'help':
      return options.structured
        ? { commands: ['impact', 'affected-tests', 'tree', 'audit-map', 'issues', 'top', 'dead-exports', 'unresolved', 'cycles', 'dependents', 'dependencies', 'stats', 'help', 'exit / quit'] }
        : `Commands:
  impact <file> [--max-depth <n>]
  affected-tests <file> [--max-depth <n>]
  tree <file> [--max-depth <n>]
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
      const file = resolveWorkspaceFilePath(parsed._[0], container.workspaceRoot || graph?.root);
      if (!file) return options.structured ? { error: 'Usage: impact <file>' } : 'Usage: impact <file>';
      if (!graph.hasFile(file)) return options.structured ? { error: `File not found in graph: ${parsed._[0]}` } : `Error: File not found in graph: ${parsed._[0]}`;
      const maxDepth = parsed.maxDepth ?? DEFAULTS.WATCH_IMPACT_DEPTH;
      const result = graph.getImpactRadius(file, maxDepth);
      return options.structured ? { impactCount: result.length, impact: result } : formatImpact(result);
    }

    case 'affected-tests': {
      const parsed = parseArgs(['node', 'repl', ...args], {
        '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
      });
      const file = resolveWorkspaceFilePath(parsed._[0], container.workspaceRoot || graph?.root);
      if (!file) return options.structured ? { error: 'Usage: affected-tests <file>' } : 'Usage: affected-tests <file>';
      if (!graph.hasFile(file)) return options.structured ? { error: `File not found in graph: ${parsed._[0]}` } : `Error: File not found in graph: ${parsed._[0]}`;
      const maxDepth = parsed.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH;
      const result = graph.findAffectedTests(file, maxDepth);
      return options.structured ? { affectedTestsCount: result.length, affectedTests: result } : formatAffectedTests(result);
    }

    case 'dead-exports': {
      const result = graph.findDeadExports();
      return options.structured ? { deadExportsCount: result.length, deadExports: result } : formatDeadExports(result);
    }

    case 'unresolved': {
      const result = graph.findUnresolvedImports();
      return options.structured ? { unresolvedCount: result.length, unresolved: result } : formatUnresolved(result);
    }

    case 'cycles': {
      const result = graph.findCircularDependencies();
      return options.structured ? { cyclesCount: result.length, cycles: result } : formatCycles(result);
    }

    case 'dependents': {
      const file = resolveWorkspaceFilePath(args[0], container.workspaceRoot || graph?.root);
      if (!file) return options.structured ? { error: 'Usage: dependents <file>' } : 'Usage: dependents <file>';
      if (!graph.hasFile(file)) return options.structured ? { error: `File not found in graph: ${args[0]}` } : `Error: File not found in graph: ${args[0]}`;
      const result = graph.getDependents(file);
      return options.structured ? { dependentsCount: result.length, dependents: result } : formatDependents(result);
    }

    case 'dependencies': {
      const file = resolveWorkspaceFilePath(args[0], container.workspaceRoot || graph?.root);
      if (!file) return options.structured ? { error: 'Usage: dependencies <file>' } : 'Usage: dependencies <file>';
      if (!graph.hasFile(file)) return options.structured ? { error: `File not found in graph: ${args[0]}` } : `Error: File not found in graph: ${args[0]}`;
      const result = graph.getDependencies(file);
      return options.structured ? { dependenciesCount: result.length, dependencies: result } : formatDependencies(result);
    }

    case 'stats': {
      const result = graph.getStats();
      return options.structured ? result : formatStats(result);
    }

    case 'audit-map': {
      const parsed = parseArgs(['node', 'repl', ...args], { '--compact': true });
      const compact = Boolean(parsed['--compact']);
      const result = buildProjectMap(graph, { compact });
      if (!result.ok) return options.structured ? { error: result.error } : `Error: ${result.error}`;
      return options.structured ? result : formatProjectMap(result, compact);
    }

    case 'issues': {
      const deadExports = graph.findDeadExports?.() || [];
      const unresolved = graph.findUnresolvedImports?.() || [];
      const cycles = graph.findCircularDependencies?.() || [];

      let severity = 'low';
      if (unresolved.length > 0 || cycles.length > 0) severity = 'high';
      else if (deadExports.length > 0) severity = 'medium';

      if (options.structured) {
        return { severity, deadExports, unresolved, cycles };
      }

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

    case 'tree': {
      const parsed = parseArgs(['node', 'repl', ...args], {
        '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
      });
      const file = resolveWorkspaceFilePath(parsed._[0], container.workspaceRoot || graph?.root);
      if (!file) return options.structured ? { error: 'Usage: tree <file> [--max-depth <n>]' } : 'Usage: tree <file> [--max-depth <n>]';
      if (!graph.hasFile(file)) return options.structured ? { error: `File not found in graph: ${parsed._[0]}` } : `Error: File not found in graph: ${parsed._[0]}`;
      const maxDepth = parsed.maxDepth ?? 3;
      const tree = buildTree(file, graph, { maxDepth, direction: 'both' });
      return options.structured ? { file, tree } : formatTree(tree);
    }

    case 'top': {
      const allFiles = graph.getAllFilePaths?.() || [];
      const hotspots = [];
      for (const file of allFiles) {
        const dependents = graph.getDependents?.(file) || [];
        if (dependents.length >= SCORING.HOTSPOT_MIN_DEPENDENTS) {
          hotspots.push({ file: graph._displayPath?.(file) || file, dependentsCount: dependents.length });
        }
      }
      hotspots.sort((a, b) => b.dependentsCount - a.dependentsCount);

      if (options.structured) {
        return { hotspots: hotspots.slice(0, 5) };
      }

      if (hotspots.length === 0) {
        return `No hotspots detected (threshold: ${SCORING.HOTSPOT_MIN_DEPENDENTS} dependents).`;
      }

      const lines = [];
      const root = graph.root || '';
      for (let i = 0; i < Math.min(hotspots.length, 5); i++) {
        const h = hotspots[i];
        const rel = path.relative(root, h.file) || h.file;
        lines.push(`hotspot-${i + 1}: ${rel} (${h.dependentsCount} dependents)`);
      }
      return lines.join('\n');
    }

    case 'exit':
    case 'quit':
      return options.structured
        ? { ok: true, message: 'Exiting REPL.' }
        : null;

    default:
      return options.structured
        ? { error: `Unknown command: ${cmd}. Type "help" for available commands.` }
        : `Unknown command: ${cmd}. Type "help" for available commands.`;
  }
}

async function startRepl(options) {
  const evalMode = options.eval || null;

  if (!evalMode && !process.stdin.isTTY) {
    console.error('Error: REPL requires an interactive terminal (TTY).');
    process.exitCode = 1;
    return;
  }
  const container = new ServiceContainer({ quiet: options.quiet });
  let rl = null;
  let shuttingDown = false;

  // Defensive: fast double Ctrl+C should not bypass container.shutdown().
  // The handler stays registered until shutdown completes so that the
  // default process exit is suppressed during cleanup.
  const sigintHandler = () => {
    if (shuttingDown) return;
    if (rl) rl.close();
  };
  if (!evalMode) {
    process.on('SIGINT', sigintHandler);
  }

  try {
    const initialized = await container.initialize(options.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: !evalMode,
      excludeDirs: options.exclude || [],
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    if (evalMode) {
      const startTime = Date.now();
      const commands = evalMode.split(';').map((c) => c.trim()).filter(Boolean);
      const results = [];
      let hasError = false;

      for (const cmdLine of commands) {
        try {
          const output = await executeCommand(container, cmdLine, { structured: options.json });
          results.push({ command: cmdLine, output });
          if (output && output.error) {
            hasError = true;
          }
        } catch (e) {
          results.push({ command: cmdLine, error: e.message });
          hasError = true;
        }
      }

      if (options.json) {
        if (commands.length === 1) {
          const single = results[0];
          if (single.error || (single.output && single.output.error)) {
            console.log(JSON.stringify({ ok: false, error: single.error || single.output.error }));
            const errStr = String(single.error || (single.output && single.output.error) || '');
            const isUnknown = errStr.includes('Unknown command') || errStr.includes('Usage:');
            process.exitCode = isUnknown ? 2 : 1;
          } else {
            console.log(JSON.stringify({ ok: true, result: single.output }));
          }
        } else {
          const formattedResults = results.map((r) => {
            if (r.error || (r.output && r.output.error)) {
              return { command: r.command, ok: false, error: r.error || r.output.error };
            }
            return { command: r.command, ok: true, result: r.output };
          });
          console.log(JSON.stringify({ ok: !hasError, results: formattedResults }));
          if (hasError) {
            const hasUnknown = results.some((r) => {
              const errStr = String(r.error || (r.output && r.output.error) || '');
              return errStr.includes('Unknown command') || errStr.includes('Usage:');
            });
            process.exitCode = hasUnknown ? 2 : 1;
          }
        }
      } else {
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (commands.length > 1) {
            console.log(`=== Command: ${r.command} ===`);
          }
          if (r.error) {
            console.error(`Error: ${r.error}`);
            const isUnknown = r.error.includes('Unknown command') || r.error.includes('Usage:');
            process.exitCode = isUnknown ? 2 : 1;
          } else if (r.output !== null) {
            console.log(r.output);
            if (typeof r.output === 'string') {
              if (r.output.startsWith('Unknown command:') || r.output.startsWith('Usage:')) {
                process.exitCode = 2;
              } else if (r.output.startsWith('Error:')) {
                process.exitCode = 1;
              }
            }
          }
          if (commands.length > 1 && i < results.length - 1) {
            console.log('');
          }
        }
      }

      if (!options.quiet && process.env.DEBUG) {
        console.error(`[REPL] ${evalMode} completed in ${Date.now() - startTime}ms`);
      }
      return;
    }

    if (!options.quiet) {
      console.error(`workspace-bridge REPL — ${container.workspaceRoot}`);
      console.error('Type "help" for commands, "exit" or "quit" to quit.\n');
    }

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    rl.on('SIGINT', () => {
      rl.close();
      // for await...of loop naturally ends, enters finally
    });

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

    if (!options.quiet) {
      console.error('\nGoodbye.');
    }
  } catch (err) {
    console.error('REPL failed:', err.message);
    process.exitCode = 1;
  } finally {
    shuttingDown = true;
    if (rl) {
      rl.close();
      rl = null;
    }
    try {
      await container.shutdown();
    } catch (e) {
      if (process.env.DEBUG) console.error('[REPL] shutdown failed:', e.message);
    }
    if (!evalMode) {
      process.removeListener('SIGINT', sigintHandler);
    }
  }
}

module.exports = {
  startRepl,
  executeCommand,
};
