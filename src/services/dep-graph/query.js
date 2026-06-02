const { bfsTraverse, CONFIG } = require('./shared');

class GraphNotReadyError extends Error {
  constructor(state) {
    super(`DependencyGraph is not ready (state: ${state}). Call build() first.`);
    this.name = 'GraphNotReadyError';
    this.state = state;
  }
}

class GraphQuery {
  constructor(depGraph) {
    this.dg = depGraph;
  }

  _ensureReady() {
    if (this.dg.state !== 'READY') {
      throw new GraphNotReadyError(this.dg.state);
    }
  }

  getDependencies(filePath) {
    this._ensureReady();
    return this.dg.getFileInfo(filePath)?.imports || [];
  }

  getDependents(filePath) {
    this._ensureReady();
    return this.dg.reverseGraph.get(this.dg.normalizeFilePath(filePath)) || [];
  }

  getImpactRadius(filePath, depth = 3) {
    this._ensureReady();
    const start = this.dg.normalizeFilePath(filePath);

    // Fast path: use precomputed impact radius if available and deep enough.
    const precomputed = this.dg.analyzer?.getPrecomputedImpact?.(start);
    if (precomputed?.impactRadius && CONFIG.DEFAULT_MAX_DEPTH >= depth) {
      const results = precomputed.impactRadius.filter((r) => r.level <= depth);
      return results.map((r) => ({
        ...r,
        file: this.dg._displayPath(r.file),
        via: r.via ? r.via.map((f) => this.dg._displayPath(f)) : r.via,
      }));
    }

    const results = bfsTraverse(start, (file) => {
      // Stop diffusion at entry files: every module eventually converges to
      // cli.js / app.vue / index.js, which provides zero actionable info.
      if (file !== start && this.dg.isKnownEntryFile(file)) return [];
      return this.getDependents(file);
    }, {
      maxDepth: depth,
      onVisit: (file, level, via) => {
        if (level === 0 || file === start) return undefined;
        const currentInfo = this.dg.getFileInfo(file);

        let importedSymbols = [];
        let importedSymbolsAvailable = false;
        if (currentInfo?.importRecords) {
          const parentFile = via[via.length - 1];
          const matchingImports = currentInfo.importRecords.filter((r) => r.resolved === parentFile);
          for (const record of matchingImports) {
            if (record.imported) importedSymbols.push(...record.imported);
          }
          importedSymbolsAvailable = matchingImports.length > 0 && matchingImports.some((r) => r.imported && r.imported.length > 0);
        }

        return {
          file,
          level,
          via: [...via],
          importedSymbols: [...new Set(importedSymbols)],
          importedSymbolsAvailable,
          reason: level === 1 ? 'direct-import' : 'transitive-dependency',
        };
      },
    });
    // P89: convert internal graph keys back to original-casing paths for output.
    return results.map((r) => ({
      ...r,
      file: this.dg._displayPath(r.file),
      via: r.via ? r.via.map((f) => this.dg._displayPath(f)) : r.via,
    }));
  }
}
module.exports = { GraphQuery };