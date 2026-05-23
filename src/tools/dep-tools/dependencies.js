function dependencies(args, container, filePath) {
  const deps = container.snapshot.graph.getDependencies(filePath);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    dependenciesCount: deps.length,
    dependencies: deps.map((d) => container.snapshot.graph._displayPath?.(d) || d),
  };
}

module.exports = dependencies;
