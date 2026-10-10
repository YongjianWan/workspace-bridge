const { bfsTraverse } = require('./shared');
const {
  isConftestFile,
  expandConftestAnchors,
  selfConftestAnchor,
  conftestAnchorsFromImpactRows,
} = require('./conftest-implicit');

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

  /**
   * Impact radius around a file.
   * @param {Object} [options]
   * @param {string} [options.direction='dependents'] - dependents | dependencies
   *   | neighbors | all. dependents = 谁引用了输入（原行为）；dependencies = 输入
   *   自己引用的文件；neighbors = 同层邻居（和输入被同一文件直接引用）；
   *   all = 双向 BFS + 同层邻居。
   * @param {boolean} [options.stopAtEntry=true] - 遇到入口文件停止扩散
   *   （入口文件本身仍作为一行出现）。
   */
  getImpactRadius(filePath, depth = 3, options = {}) {
    this._ensureReady();
    const start = this.dg.normalizeFilePath(filePath);
    const direction = options.direction || 'dependents';
    const stopAtEntry = options.stopAtEntry !== false;
    // dependencies 只沿正向走；all 双向；其余（含缺省）保持原 dependents 语义
    const includeDeps = direction === 'dependencies' || direction === 'all';
    const includeDependents = direction !== 'dependencies';

    let results;
    if (direction === 'neighbors') {
      results = this._sameImporterRows(start, stopAtEntry, null);
    } else {
      results = bfsTraverse(start, (file) => {
        // Stop diffusion at entry files: every module eventually converges to
        // cli.js / app.vue / index.js, which provides zero actionable info.
        if (stopAtEntry && file !== start && this.dg.isKnownEntryFile(file)) return [];
        const neighbors = [];
        if (includeDependents) neighbors.push(...this.getDependents(file));
        if (includeDeps) neighbors.push(...this.getDependencies(file));
        return neighbors;
      }, {
        maxDepth: depth,
        onVisit: (file, level, via) => {
          if (level === 0 || file === start) return undefined;
          const currentInfo = this.dg.getFileInfo(file);
          const parentFile = via[via.length - 1];

          let importedSymbols = [];
          let importedSymbolsAvailable = false;
          let reason = level === 1 ? 'direct-import' : 'transitive-dependency';
          if (currentInfo?.importRecords) {
            const matchingImports = currentInfo.importRecords.filter((r) => r.resolved === parentFile);
            for (const record of matchingImports) {
              if (record.imported) importedSymbols.push(...record.imported);
            }
            importedSymbolsAvailable = matchingImports.length > 0 && matchingImports.some((r) => r.imported && r.imported.length > 0);
            if (matchingImports.some((r) => r.tier === 'tier3')) {
              reason = 'implicit-same-package';
            }
          }
          // 正向边（父节点 import 当前节点）没有 import 符号可展示——符号挂在
          // 父节点的 importRecords 上——但 reason 要如实标注方向。
          if (includeDeps && reason !== 'implicit-same-package') {
            const parentInfo = this.dg.getFileInfo(parentFile);
            const forwardEdge = parentInfo?.importRecords?.some((r) => r.resolved === file);
            if (forwardEdge) {
              reason = level === 1 ? 'direct-reference' : 'transitive-reference';
            }
          }

          return {
            file,
            level,
            via: [...via],
            importedSymbols: [...new Set(importedSymbols)],
            importedSymbolsAvailable,
            reason,
          };
        },
      });
      if (direction === 'all') {
        results = [...results, ...this._sameImporterRows(start, stopAtEntry, results)];
      }
    }

    // Pytest loads conftest.py for every test in its directory and
    // below — append those tests as implicit dependents. Rows are labeled, not
    // disguised as imports.
    results = this._appendConftestImplicitRows(start, results, depth);

    // Convert internal graph keys back to original-casing paths for output.
    return results.map((r) => ({
      ...r,
      file: this.dg._displayPath(r.file),
      via: r.via ? r.via.map((f) => this.dg._displayPath(f)) : r.via,
    }));
  }

  /**
   * 同层邻居行：和 start 被同一个文件直接引用的文件（via = 共同 importer）。
   * 不沿任何方向继续扩散。已有行（真实边）优先，existing 为 null 时返回全集。
   */
  _sameImporterRows(start, stopAtEntry, existing) {
    // start 必须始终在 seen 里：existing（BFS 行）已滤掉 level-0 的 start，
    // 不补上的话，start 经循环边会作为自己的同层邻居漏进结果，白占一个输出名额。
    const seen = new Set(existing ? [...existing.map((r) => r.file), start] : [start]);
    const rows = [];
    for (const importer of this.getDependents(start)) {
      if (stopAtEntry && importer !== start && this.dg.isKnownEntryFile(importer)) continue;
      for (const sibling of this.getDependencies(importer)) {
        if (seen.has(sibling)) continue;
        seen.add(sibling);
        rows.push({
          file: sibling,
          level: 1,
          via: [importer],
          importedSymbols: [],
          importedSymbolsAvailable: false,
          reason: 'same-importer',
        });
      }
    }
    return rows;
  }

  /**
   * Append conftest → subtree-test rows to an impact-radius result.
   * Anchors: the queried file itself (if it is a conftest) plus every conftest
   * already present in the radius. One implicit hop past the conftest,
   * capped by depth, deduped against real rows (real edges win).
   */
  _appendConftestImplicitRows(start, results, depth) {
    const anchors = [];
    if (isConftestFile(start)) anchors.push(selfConftestAnchor(start));
    anchors.push(...conftestAnchorsFromImpactRows(results));
    if (anchors.length === 0) return results;

    const seen = new Set(results.map((r) => r.file));
    const extra = expandConftestAnchors(this.dg, anchors, depth)
      .filter((r) => !seen.has(r.file))
      .map((r) => ({
        file: r.file,
        level: r.distance,
        via: r.via,
        importedSymbols: [],
        importedSymbolsAvailable: false,
        reason: 'implicit-conftest',
      }));
    return [...results, ...extra];
  }

  _routeToOutput(file, r, isDirect, hasImplicit) {
    return {
      file: this.dg._displayPath(file),
      method: r.method,
      path: r.path,
      framework: r.framework,
      handler: r.handler || null,
      source: this.dg.isTestLikeFile(file) ? 'test' : 'src',
      routeType: isDirect ? 'direct' : 'indirect',
      hasImplicit: !!hasImplicit,
    };
  }

  _isPathImplicit(pathNodes) {
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const prevNode = pathNodes[i];
      const currNode = pathNodes[i + 1];
      const currentInfo = this.dg.getFileInfo(currNode);
      if (currentInfo?.importRecords) {
        const matchingImports = currentInfo.importRecords.filter((rec) => rec.resolved === prevNode);
        const isImplicitEdge = matchingImports.some(
          (rec) => rec.confidence != null && rec.confidence < 0.5
        );
        if (isImplicitEdge) {
          return true;
        }
      }
    }
    return false;
  }

  findAffectedHttpRoutes(filePath, depth = 3) {
    this._ensureReady();
    const start = this.dg.normalizeFilePath(filePath);

    const affected = [];

    bfsTraverse(start, (file) => this.getDependents(file), {
      maxDepth: depth,
      onVisit: (file, level, via) => {
        const info = this.dg.getFileInfo(file);
        if (info && info.routes && info.routes.length > 0) {
          const isDirect = (level === 0 || file === start);
          const hasImplicit = this._isPathImplicit([...via, file]);
          for (const r of info.routes) {
            affected.push(this._routeToOutput(file, r, isDirect, hasImplicit));
          }
        }
      }
    });

    const seen = new Map();
    for (const r of affected) {
      const key = `${r.file}:${r.method}:${r.path}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, r);
      } else {
        if (existing.hasImplicit && !r.hasImplicit) {
          seen.set(key, r);
        }
      }
    }
    const uniqueRoutes = Array.from(seen.values());
    uniqueRoutes.sort((a, b) => {
      if (a.routeType === 'direct' && b.routeType !== 'direct') return -1;
      if (a.routeType !== 'direct' && b.routeType === 'direct') return 1;
      if (!a.hasImplicit && b.hasImplicit) return -1;
      if (a.hasImplicit && !b.hasImplicit) return 1;
      return 0;
    });
    return uniqueRoutes;
  }
}
module.exports = { GraphQuery };