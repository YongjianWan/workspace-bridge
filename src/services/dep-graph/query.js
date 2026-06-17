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

  getDependencies(filePath, options = {}) {
    this._ensureReady();
    const deps = this.dg.getFileInfo(filePath)?.imports || [];
    if (options.architectureOnly) {
      return deps.filter((dep) => !this.dg.isTestLikeFile(filePath) && !this.dg.isTestLikeFile(dep));
    }
    return deps;
  }

  getDependents(filePath, options = {}) {
    this._ensureReady();
    const dependents = this.dg.reverseGraph.get(this.dg.normalizeFilePath(filePath)) || [];
    if (options.architectureOnly) {
      return dependents.filter((dep) => !this.dg.isTestLikeFile(filePath) && !this.dg.isTestLikeFile(dep));
    }
    return dependents;
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

  findAffectedHttpRoutes(filePath, depth = 3) {
    this._ensureReady();
    const start = this.dg.normalizeFilePath(filePath);

    // Graph-first: try direct SQLite query first if cache supports it
    if (this.dg.cache && typeof this.dg.cache.findAffectedHttpRoutes === 'function') {
      try {
        const dbRoutes = this.dg.cache.findAffectedHttpRoutes(start, depth);
        if (dbRoutes) {
          return dbRoutes.map((r) => ({
            file: this.dg._displayPath(r.file),
            method: r.method,
            path: r.path,
            framework: r.framework,
            handler: r.handler || null,
          }));
        }
      } catch (err) {
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.error('[GraphQuery] findAffectedHttpRoutes SQLite fallback:', err.message);
        }
      }
    }

    const affected = [];

    bfsTraverse(start, (file) => this.getDependents(file), {
      maxDepth: depth,
      onVisit: (file, level) => {
        const info = this.dg.getFileInfo(file);
        if (info && info.routes && info.routes.length > 0) {
          for (const r of info.routes) {
            affected.push({
              file: this.dg._displayPath(file),
              method: r.method,
              path: r.path,
              framework: r.framework,
              handler: r.handler || null,
            });
          }
        }
      }
    });

    const seen = new Set();
    return affected.filter(r => {
      const key = `${r.file}:${r.method}:${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
module.exports = { GraphQuery };