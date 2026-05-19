function stats(_args, container, _filePath) {
  return {
    ok: true,
    stats: container.depGraph.getStats(),
  };
}

module.exports = stats;
