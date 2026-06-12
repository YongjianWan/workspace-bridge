function dependencies(args, container, filePath) {
  const deps = container.snapshot.graph.getDependencies(filePath);
  // Wave 12-5: --max-files caps direct dependencies.
  const limit = Number.isFinite(args?.maxFiles) ? args.maxFiles : deps.length;
  const trunc = deps.slice(0, limit);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    dependenciesCount: deps.length,
    dependencies: trunc.map((d) => container.snapshot.graph._displayPath?.(d) || d),
    truncated: trunc.length < deps.length,
  };
}

module.exports = dependencies;
