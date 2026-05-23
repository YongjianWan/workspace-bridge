function cycles(_args, container, _filePath) {
  const cycles = container.snapshot.graph.findCircularDependencies();
  return {
    ok: true,
    cyclesCount: cycles.length,
    cycles,
  };
}

module.exports = cycles;
