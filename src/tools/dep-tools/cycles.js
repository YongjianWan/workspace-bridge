function cycles(_args, container, _filePath) {
  const cycles = container.depGraph.findCircularDependencies();
  return {
    ok: true,
    cyclesCount: cycles.length,
    cycles,
  };
}

module.exports = cycles;
