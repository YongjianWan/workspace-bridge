function stats(_args, container, _filePath) {
  return {
    ok: true,
    stats: container.snapshot.graph.getStats(),
  };
}

module.exports = stats;
