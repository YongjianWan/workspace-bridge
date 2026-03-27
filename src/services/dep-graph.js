/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of file dependencies, computes impact radius
 */
const fs = require('fs');
const path = require('path');

class DependencyGraph {
  constructor(workspaceRoot, cache) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.graph = new Map(); // file -> {imports: [], exports: []}
    this.reverseGraph = new Map(); // file -> [files that import it]
  }

  /**
   * Build dependency graph from all indexed files
   */
  async build() {
    const startTime = Date.now();
    
    // Get all files from cache
    const files = Array.from(this.cache.fileMetadata.keys());
    
    for (const file of files) {
      await this.analyzeFile(file);
    }

    // Build reverse graph
    this.buildReverseGraph();

    console.error(`[DepGraph] Built in ${Date.now() - startTime}ms: ${this.graph.size} files`);
  }

  /**
   * Analyze a single file for imports/exports
   */
  async analyzeFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      let imports = [];
      let exports = [];

      if (ext === '.py') {
        ({ imports, exports } = this.parsePython(content));
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        ({ imports, exports } = this.parseJavaScript(content));
      }

      // Resolve relative imports to absolute paths
      const resolvedImports = imports
        .map(imp => this.resolveImport(filePath, imp, ext))
        .filter(Boolean);

      this.graph.set(filePath, {
        imports: resolvedImports,
        exports,
      });

    } catch (e) {
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
    }
  }

  parsePython(content) {
    const imports = [];
    const exports = []; // Python doesn't have exports, but we track public symbols

    // Match: import X, from X import Y
    const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const module = match[1] || match[2];
      if (module) {
        imports.push(module);
      }
    }

    // Find public classes/functions (not starting with _)
    const classRegex = /^class\s+(\w+)/gm;
    const funcRegex = /^def\s+(\w+)/gm;
    
    while ((match = classRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }
    while ((match = funcRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }

    return { imports, exports };
  }

  parseJavaScript(content) {
    const imports = [];
    const exports = [];

    // ES6 imports: import X from 'Y', import { X } from 'Y'
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // CommonJS: require('X')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // ES6 exports: export { X }, export const X, export default X
    const exportRegex = /export\s+(?:\{[^}]*\}|(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)|default\s+(\w+))/g;
    while ((match = exportRegex.exec(content)) !== null) {
      const name = match[1] || match[2];
      if (name) exports.push(name);
    }

    return { imports, exports };
  }

  resolveImport(fromFile, importPath, ext) {
    // Skip node_modules and built-ins
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null; // External module
    }

    const fromDir = path.dirname(fromFile);
    let resolved;

    if (importPath.startsWith('.')) {
      // Relative import
      resolved = path.resolve(fromDir, importPath);
    } else {
      resolved = importPath;
    }

    // Try extensions
    const extensions = ext === '.py' ? ['.py', '/__init__.py'] : ['.js', '.ts', '.jsx', '.tsx', '/index.js'];
    
    for (const tryExt of ['', ...extensions]) {
      const fullPath = resolved + tryExt;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return resolved; // Return unresolved for info
  }

  buildReverseGraph() {
    this.reverseGraph.clear();
    
    for (const [file, info] of this.graph) {
      for (const imp of info.imports) {
        if (!this.reverseGraph.has(imp)) {
          this.reverseGraph.set(imp, []);
        }
        this.reverseGraph.get(imp).push(file);
      }
    }
  }

  /**
   * Get direct dependencies of a file
   */
  getDependencies(filePath) {
    return this.graph.get(filePath)?.imports || [];
  }

  /**
   * Get files that depend on this file (reverse dependencies)
   */
  getDependents(filePath) {
    return this.reverseGraph.get(filePath) || [];
  }

  /**
   * Calculate impact radius: how many files would be affected by changing this file
   */
  getImpactRadius(filePath, depth = 3) {
    const visited = new Set();
    const queue = [{ file: filePath, level: 0 }];
    const results = [];

    while (queue.length > 0) {
      const { file, level } = queue.shift();
      
      if (visited.has(file) || level > depth) continue;
      visited.add(file);

      if (level > 0) {
        results.push({ file, level });
      }

      const dependents = this.getDependents(file);
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          queue.push({ file: dep, level: level + 1 });
        }
      }
    }

    return results;
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies() {
    const cycles = [];
    const visited = new Set();
    const stack = new Set();

    const visit = (file, path) => {
      if (stack.has(file)) {
        // Found cycle
        const cycleStart = path.indexOf(file);
        cycles.push(path.slice(cycleStart).concat([file]));
        return;
      }

      if (visited.has(file)) return;

      visited.add(file);
      stack.add(file);
      path.push(file);

      const deps = this.getDependencies(file);
      for (const dep of deps) {
        if (this.graph.has(dep)) {
          visit(dep, [...path]);
        }
      }

      stack.delete(file);
    };

    for (const file of this.graph.keys()) {
      visit(file, []);
    }

    return cycles;
  }

  /**
   * Get unused exports in a file
   */
  getUnusedExports(filePath) {
    const info = this.graph.get(filePath);
    if (!info) return [];

    const unused = [];
    for (const exp of info.exports) {
      // Check if any file imports this symbol
      let isUsed = false;
      for (const [f, i] of this.graph) {
        if (f === filePath) continue;
        // Simple check: does the import contain the export name
        // Real implementation would need more sophisticated analysis
        if (i.imports.some(imp => imp.includes(exp) || imp.includes(path.basename(filePath, path.extname(filePath))))) {
          isUsed = true;
          break;
        }
      }
      if (!isUsed) unused.push(exp);
    }

    return unused;
  }

  getStats() {
    return {
      files: this.graph.size,
      totalImports: Array.from(this.graph.values()).reduce((sum, i) => sum + i.imports.length, 0),
      totalExports: Array.from(this.graph.values()).reduce((sum, i) => sum + i.exports.length, 0),
      cycles: this.findCircularDependencies().length,
    };
  }
}

module.exports = {
  DependencyGraph,
};
