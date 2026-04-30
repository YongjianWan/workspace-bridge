/**
 * Minimal argv parser shared across CLI entry points.
 * Eliminates the three independent parseArgs() implementations.
 *
 * Usage:
 *   const raw = parseArgs(process.argv, {
 *     '--json': true,                              // boolean flag
 *     '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
 *   });
 *   const command = raw._[0];
 *   const maxDepth = raw.maxDepth;
 */
function parseArgs(argv, handlers) {
  const args = argv.slice(2);
  const result = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const handler = handlers?.[arg];
    if (!handler) {
      if (arg.startsWith('-')) {
        throw new Error(`Unknown argument: ${arg}`);
      }
      result._.push(arg);
      continue;
    }
    if (handler === true) {
      result[arg] = true;
    } else {
      const rawValue = args[++i];
      const key = handler.key || arg;
      result[key] = handler.transform ? handler.transform(rawValue) : rawValue;
    }
  }
  return result;
}

module.exports = { parseArgs };
