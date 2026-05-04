const path = require('path');
const { pathExists, readJsonSafe, toPosixPath } = require('./path');

const ROLE_PRIORITY = ['generated', 'archive', 'reference', 'active'];
const DEFAULT_DIRECTORY_HINTS = {
  active: [],
  reference: ['reference', 'references', 'example', 'examples', 'sample', 'samples', 'demo', 'demos'],
  archive: ['archive', 'archives', 'attic', 'deprecated', 'legacy', 'prototype', 'prototypes'],
  generated: ['dist', 'build', 'coverage', '.next', 'out', 'generated', '.turbo'],
};

function normalizeRelativePath(input) {
  return toPosixPath(String(input || ''))
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

function loadWorkspaceConfig(root) {
  const configPath = path.join(root, '.workspace-bridge.json');
  if (!pathExists(configPath)) return null;
  const config = readJsonSafe(configPath);
  if (!config) return null;
  return {
    directories: {
      active: ensureArray(config.directories?.active),
      reference: ensureArray(config.directories?.reference),
      archive: ensureArray(config.directories?.archive),
      generated: ensureArray(config.directories?.generated),
    },
  };
}

function inferFileRole(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const base = path.basename(normalized);
  const frameworkEntryFiles = new Set([
    'manage.py',
    'vite.config.js',
    'vite.config.ts',
    'vite.config.mjs',
    'vite.config.cjs',
  ]);

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

  if (frameworkEntryFiles.has(base)) {
    return 'entry';
  }

  const configExact = new Set(['package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'settings.local.json']);
  if (configExact.has(base)) return 'config';

  const configPatterns = [
    /\.config\./, /^\.env(\.|$)/,
    /^\.babelrc/, /^\.editorconfig/, /^\.gitignore/, /^\.gitattributes/,
    /^\.npmrc/, /^\.yarnrc/, /^\.prettierrc/, /^\.eslintrc/, /^eslint\.config\./, /^\.mocharc/,
    /tailwind\.config\./, /postcss\.config\./, /vite\.config\./, /webpack\.config\./, /rollup\.config\./, /tsup\.config\./,
    /jest\.config\./, /prettier\.config\./,
    /^docker/i, /^docker-compose/i, /^makefile/i,
    /^\.nvmrc/, /^\.node-version/,
    /^requirements/, /pyproject/,
  ];
  if (configPatterns.some((p) => p.test(base))) {
    return 'config';
  }

  if (
    normalized.includes('/migrations/') ||
    normalized.endsWith('/alembic.ini') ||
    normalized.endsWith('/manage.py')
  ) {
    return 'migration';
  }

  const ext = path.extname(base).slice(1);
  if (
    normalized.startsWith('scripts/') ||
    normalized.startsWith('bin/') ||
    normalized.startsWith('tools/') ||
    normalized.includes('/scripts/') ||
    normalized.includes('/bin/') ||
    normalized.includes('/tools/') ||
    ext === 'sh' ||
    ext === 'bash' ||
    ext === 'ps1'
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

  if (
    /\.(md|mdx|txt|rst)$/.test(base) ||
    base.toLowerCase().includes('license') ||
    base.toLowerCase().includes('changelog') ||
    base.toLowerCase().includes('contributing') ||
    base.toLowerCase().includes('readme')
  ) {
    return 'docs';
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

    // User-configured rules take precedence over default hints.
    const configuredMatch = this.directoryRules.find(
      (rule) => rule.source === 'config' && pathMatchesRule(normalized, rule.path)
    );
    if (configuredMatch) {
      return { role: configuredMatch.role, matchedRule: configuredMatch };
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
  loadWorkspaceConfig,
};
