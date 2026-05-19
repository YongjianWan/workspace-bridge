function dependents(args, container, filePath) {
  const dents = container.depGraph.getDependents(filePath);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.depGraph._displayPath?.(filePath) || filePath,
    dependentsCount: dents.length,
    dependents: dents.map((d) => container.depGraph._displayPath?.(d) || d),
  };
}

module.exports = dependents;
