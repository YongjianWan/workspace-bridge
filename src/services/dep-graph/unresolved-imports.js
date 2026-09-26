const path = require('path');
const { isExternalDependency, buildPythonModuleIndex } = require('./resolvers');
const { DEFAULTS } = require('../../config/constants');

// Derive this from graph records so cold and warm paths share one answer.
function collectUnresolvedImports(graph, root, workspacePackages) {
  const local = { count: 0, files: new Set(), samples: [] };
  const uncertain = { count: 0, files: new Set(), samples: [] };
  const pythonModuleIndex = buildPythonModuleIndex(graph.keys());
  for (const [file, info] of graph) {
    const ext = path.extname(file).toLowerCase();
    for (const record of info.importRecords || []) {
      const source = record.source;
      if (!source || record.resolved || (record.usesAllExports && source.endsWith('.*'))) continue;
      if (isExternalDependency(source, ext, root, {
        fromFile: info.originalPath || file,
        importHints: { isLocal: record.isLocal },
        workspacePackages,
      })) continue;

      // A bare Python name with no workspace candidate may be a transitive
      // dependency. A tied workspace module index is still a local gap.
      const unknownPython = ext === '.py' && !source.startsWith('.')
        && !pythonModuleIndex?.lookup(source)?.length;
      const bucket = unknownPython ? uncertain : local;
      bucket.count++;
      bucket.files.add(file);
      if (bucket.samples.length < DEFAULTS.DROPPED_IMPORT_SAMPLE_LIMIT) {
        bucket.samples.push({ file, specifier: source });
      }
    }
  }
  return { local, uncertain };
}

module.exports = { collectUnresolvedImports };
