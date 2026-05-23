function dependents(args, container, filePath) {
  const dents = container.snapshot.graph.getDependents(filePath);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    dependentsCount: dents.length,
    dependents: dents.map((d) => container.snapshot.graph._displayPath?.(d) || d),
  };
}

module.exports = dependents;
