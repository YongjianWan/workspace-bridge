function dependents(args, container, filePath) {
  const dents = container.snapshot.graph.getDependents(filePath);
  // Wave 12-5: --max-files caps direct dependents.
  const limit = Number.isFinite(args?.maxFiles) ? args.maxFiles : dents.length;
  const trunc = dents.slice(0, limit);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    dependentsCount: dents.length,
    dependents: trunc.map((d) => container.snapshot.graph._displayPath?.(d) || d),
    truncated: trunc.length < dents.length,
  };
}

module.exports = dependents;
