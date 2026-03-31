const path = require('path');
const { pathExists, readJsonSafe } = require('./path');

const ROLE_PRIORITY = ['generated', 'archive', 'reference', 'active'];
const DEFAULT_DIRECTORY_HINTS = {
  active: [],
  reference: ['reference', 'references', 'example', 'examples', 'sample', 'samples', 'demo', 'demos'],
  archive: ['archive', 'archives', 'attic', 'deprecated', 'legacy'],
  generated: ['dist', 'build', 'coverage', '.next', 'out', 'generated', '.turbo'],
};

function normalizeRelativePath(input) {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim()
    .toLowerCase();
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pathMatchesRule(relativePath, rulePath) {
  if (!rulePath) return false;
  return relativePath === rulePath || relativePath.startsWith(`${rulePath}/`);
}

function inferFileRole(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const base = path.basename(normalized);

  if (
    normalized.startsWith('test/') ||
    normalized.startsWith('tests/') ||
    normalized.startsWith('__tests__/') ||
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    /\.test\./.test(base) ||
    /\.spec\./.test(base) ||
    /^test_/.test(base) ||
    /_test\./.test(base)
  ) {
    return 'test';
  }

  if (
    base === 'package.json' ||
    base === 'tsconfig.json' ||
    base === 'pyproject.toml' ||
    base === 'requirements.txt' ||
    base === 'manage.py' ||
    /\.config\./.test(base) ||
    /^\.env(\.|$)/.test(base)
  ) {
    return 'config';
  }

  if (
    normalized.includes('/migrations/') ||
    normalized.endsWith('/alembic.ini') ||
    normalized.endsWith('/manage.py')
  ) {
    return 'migration';
  }

  if (
    normalized.startsWith('scripts/') ||
    normalized.startsWith('bin/') ||
    normalized.startsWith('tools/') ||
    normalized.includes('/scripts/') ||
    normalized.includes('/bin/') ||
    normalized.includes('/tools/')
  ) {
    return 'script';
  }

  if (
    base === 'index.js' ||
    base === 'index.ts' ||
    base === 'main.js' ||
    base === 'main.ts' ||
    base === 'app.js' ||
    base === 'app.ts' ||
    base === 'cli.js' ||
    base === 'server.ts'
  ) {
    return 'entry';
  }

  return 'library';
}

class ProjectContext {
  constructor(root, options = {}) {
    this.root = root;
    this.configPath = path.join(root, '.workspace-bridge.json');
    this.config = pathExists(this.configPath) ? readJsonSafe(this.configPath) || {} : {};
    this.cliExcludes = ensureArray(options.excludeDirs).map(normalizeRelativePath).filter(Boolean);
    this.directoryRules = this.buildDirectoryRules();
  }

  buildDirectoryRules() {
    const configured = this.config?.directories || {};
    const rules = [];

    for (const role of ROLE_PRIORITY) {
      const configuredPaths = ensureArray(configured[role]).map(normalizeRelativePath).filter(Boolean);
      for (const rulePath of configuredPaths) {
        rules.push({ role, path: rulePath, source: 'config' });
      }
    }

    for (const role of ROLE_PRIORITY) {
      const hints = DEFAULT_DIRECTORY_HINTS[role] || [];
      for (const hint of hints) {
        rules.push({ role, path: normalizeRelativePath(hint), source: 'default' });
      }
    }

    for (const excludePath of this.cliExcludes) {
      rules.push({ role: 'reference', path: excludePath, source: 'cli' });
    }

    return rules;
  }

  getRelativePath(filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.root, filePath);
    return normalizeRelativePath(path.relative(this.root, absolutePath));
  }

  classifyDirectory(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      return { role: 'active', matchedRule: null };
    }

    for (const role of ROLE_PRIORITY) {
      const match = this.directoryRules.find((rule) => rule.role === role && pathMatchesRule(normalized, rule.path));
      if (match) {
        return { role, matchedRule: match };
      }
    }

    return { role: 'active', matchedRule: null };
  }

  classifyFile(filePath) {
    const relativePath = this.getRelativePath(filePath);
    const directory = path.dirname(relativePath);
    const directoryInfo = this.classifyDirectory(directory === '.' ? '' : directory);
    const fileRole = inferFileRole(relativePath);
    const isMainline = directoryInfo.role === 'active';

    return {
      relativePath,
      directoryRole: directoryInfo.role,
      fileRole,
      isMainline,
      matchedRule: directoryInfo.matchedRule,
    };
  }

  shouldAnalyzeFile(filePath) {
    return this.classifyFile(filePath).isMainline;
  }

  shouldIndexFile(filePath) {
    return this.classifyFile(filePath).directoryRole !== 'generated';
  }

  summarizeFiles(files) {
    const summary = {
      configPath: pathExists(this.configPath) ? this.configPath : null,
      hasConfig: pathExists(this.configPath),
      counts: {
        totalFiles: 0,
        mainlineFiles: 0,
        nonMainlineFiles: 0,
      },
      directoryRoles: {
        active: 0,
        reference: 0,
        archive: 0,
        generated: 0,
      },
      fileRoles: {
        entry: 0,
        library: 0,
        config: 0,
        test: 0,
        migration: 0,
        script: 0,
      },
      entryFiles: [],
    };

    for (const filePath of files) {
      const classification = this.classifyFile(filePath);
      summary.counts.totalFiles += 1;
      summary.directoryRoles[classification.directoryRole] += 1;
      summary.fileRoles[classification.fileRole] += 1;
      if (classification.isMainline) {
        summary.counts.mainlineFiles += 1;
      } else {
        summary.counts.nonMainlineFiles += 1;
      }
      if (classification.fileRole === 'entry') {
        summary.entryFiles.push(classification.relativePath);
      }
    }

    summary.entryFiles = Array.from(new Set(summary.entryFiles)).sort();
    return summary;
  }
}

module.exports = {
  ProjectContext,
  normalizeRelativePath,
};
