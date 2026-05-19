function dependencies(args, container, filePath) {
  const deps = container.depGraph.getDependencies(filePath);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.depGraph._displayPath?.(filePath) || filePath,
    dependenciesCount: deps.length,
    dependencies: deps.map((d) => container.depGraph._displayPath?.(d) || d),
  };
}

module.exports = dependencies;
