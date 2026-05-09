const fs = require('fs');
const path = require('path');
const { pathExists, readJsonSafe, toPosixPath } = require('./path');

const ROLE_PRIORITY = ['generated', 'archive', 'reference', 'active'];
const DEFAULT_DIRECTORY_HINTS = {
  active: [],
  reference: ['reference', 'references', 'example', 'examples', 'sample', 'samples', 'demo', 'demos'],
  archive: ['archive', 'archives', 'attic', 'deprecated', 'legacy', 'prototype', 'prototypes'],
  generated: ['dist', 'build', 'coverage', '.next', 'out', 'generated', '.turbo'],
};

// Framework-specific entry files checked before generic config/entry rules.
const FRAMEWORK_ENTRY_FILES = new Set([
  'manage.py',
]);

// Exact config file names.
const CONFIG_EXACT_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'settings.local.json',
]);

// Config patterns tested against basename.
const CONFIG_PATTERNS = [
  /\.config\./, /^\.env(\.|$)/,
  /^\.babelrc/, /^\.editorconfig/, /^\.gitignore/, /^\.gitattributes/,
  /^\.npmrc/, /^\.yarnrc/, /^\.prettierrc/, /^\.eslintrc/, /^eslint\.config\./, /^\.mocharc/,
  /tailwind\.config\./, /postcss\.config\./, /vite\.config\./, /webpack\.config\./, /rollup\.config\./, /tsup\.config\./,
  /jest\.config\./, /prettier\.config\./,
  /^docker/i, /^docker-compose/i, /^makefile/i,
  /^\.nvmrc/, /^\.node-version/,
  /^requirements/, /pyproject/,
];

// Common entry file basenames.
const ENTRY_BASE_NAMES = new Set([
  'index.js', 'index.ts', 'main.js', 'main.ts',
  'app.js', 'app.ts', 'cli.js', 'server.ts',
  'app.vue',
]);

const ROLE_RULES = [
  {
    role: 'test',
    test: (relPath, base) =>
      relPath.startsWith('test/') ||
      relPath.startsWith('tests/') ||
      relPath.startsWith('__tests__/') ||
      relPath.includes('/test/') ||
      relPath.includes('/tests/') ||
      relPath.includes('/__tests__/') ||
      /\.test\./.test(base) ||
      /\.spec\./.test(base) ||
      /^test_/.test(base) ||
      /_test\./.test(base),
  },
  {
    role: 'entry',
    test: (_relPath, base) => {
      if (FRAMEWORK_ENTRY_FILES.has(base)) return true;
      // P70: Spring Boot application entry classes
      if (/application.*\.java$/i.test(base)) return true;
      if (/.*servletinitializer\.java$/i.test(base)) return true;
      return false;
    },
  },
  {
    role: 'config',
    test: (_relPath, base) => {
      if (CONFIG_EXACT_NAMES.has(base)) return true;
      return CONFIG_PATTERNS.some((p) => p.test(base));
    },
  },
  {
    role: 'migration',
    test: (relPath, base) =>
      relPath.includes('/migrations/') ||
      base === 'alembic.ini' ||
      base === 'manage.py',
  },
  {
    role: 'script',
    test: (relPath, base) => {
      const ext = path.extname(base).slice(1);
      return (
        relPath.startsWith('scripts/') ||
        relPath.startsWith('bin/') ||
        relPath.startsWith('tools/') ||
        relPath.includes('/scripts/') ||
        relPath.includes('/bin/') ||
        relPath.includes('/tools/') ||
        ext === 'sh' ||
        ext === 'bash' ||
        ext === 'ps1'
      );
    },
  },
  {
    role: 'entry',
    test: (relPath, base) => {
      if (!ENTRY_BASE_NAMES.has(base)) return false;
      // L2-18: index.js/index.ts deep in the tree are typically barrel files, not entries.
      // Only treat them as entry at root level or directly under src/.
      if (base === 'index.js' || base === 'index.ts') {
        const depth = relPath.split('/').filter(Boolean).length;
        return depth <= 2;
      }
      return true;
    },
  },
  {
    role: 'docs',
    test: (_relPath, base) =>
      /\.(md|mdx|txt|rst)$/.test(base) ||
      base.toLowerCase().includes('license') ||
      base.toLowerCase().includes('changelog') ||
      base.toLowerCase().includes('contributing') ||
      base.toLowerCase().includes('readme'),
  },
  {
    role: 'style',
    test: (_relPath, base) =>
      /\.(css|scss|sass|less|styl|stylus)$/.test(base),
  },
  {
    role: 'asset',
    test: (_relPath, base) =>
      /\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp3|mp4|wav|avi|mov|pdf|zip|tar\.gz?)$/.test(base),
  },
];

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

function loadWorkspaceConfig(root, options = {}) {
  const configPath = path.join(root, '.workspace-bridge.json');
  if (!pathExists(configPath)) return null;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (!options.quiet) {
      console.error(`[Config] Invalid JSON in ${configPath}: ${err.message}`);
    }
    return null;
  }

  // Lightweight schema validation: warn on unknown keys / wrong types,
  // but still load the file so the user isn't blocked.
  if (!options.quiet) {
    const validTopKeys = new Set(['directories']);
    for (const key of Object.keys(config)) {
      if (!validTopKeys.has(key)) {
        console.error(`[Config] Warning: unknown top-level key "${key}" in ${configPath}`);
      }
    }

    const dirs = config.directories;
    if (dirs !== undefined && (typeof dirs !== 'object' || Array.isArray(dirs))) {
      console.error(`[Config] Warning: "directories" must be an object in ${configPath}`);
    } else if (dirs) {
      const validDirKeys = new Set(['active', 'reference', 'archive', 'generated']);
      for (const [key, value] of Object.entries(dirs)) {
        if (!validDirKeys.has(key)) {
          console.error(`[Config] Warning: unknown directories key "${key}" in ${configPath}`);
        } else if (!Array.isArray(value)) {
          console.error(`[Config] Warning: directories.${key} must be an array in ${configPath}`);
        } else if (!value.every((v) => typeof v === 'string')) {
          console.error(`[Config] Warning: directories.${key} must be an array of strings in ${configPath}`);
        }
      }
    }
  }

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

  for (const rule of ROLE_RULES) {
    if (rule.test(normalized, base)) {
      return rule.role;
    }
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

  isActiveSourceFile(filePath) {
    return this.classifyFile(filePath).isMainline;
  }

  isNotGeneratedFile(filePath) {
    return this.classifyFile(filePath).directoryRole !== 'generated';
  }

  summarizeFiles(files, isImportedFn) {
    const summary = {
      configPath: pathExists(this.configPath) ? this.configPath : null,
      hasWorkspaceBridgeConfig: pathExists(this.configPath),
      counts: {
        totalFiles: 0,
        mainlineFiles: 0,
        nonMainlineFiles: 0,
        testFiles: 0,
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
        docs: 0,
        style: 0,
        asset: 0,
        unknown: 0,
      },
      entryFiles: [],
    };

    for (const filePath of files) {
      const classification = this.classifyFile(filePath);
      summary.counts.totalFiles += 1;
      summary.directoryRoles[classification.directoryRole] += 1;
      let fileRole = classification.fileRole;
      // P41: a file cannot simultaneously be 'library' and 'orphan'
      if (fileRole === 'library' && isImportedFn && !isImportedFn(filePath)) {
        fileRole = 'unknown';
      }
      summary.fileRoles[fileRole] += 1;
      // L2-26: tests and docs are active (still indexed) but not mainline
      const isTrulyMainline = classification.isMainline && fileRole !== 'test' && fileRole !== 'docs' && fileRole !== 'style' && fileRole !== 'asset';
      if (isTrulyMainline) {
        summary.counts.mainlineFiles += 1;
      } else {
        summary.counts.nonMainlineFiles += 1;
      }
      if (fileRole === 'entry') {
        summary.entryFiles.push(classification.relativePath);
      }
    }

    summary.counts.testFiles = summary.fileRoles.test;
    summary.entryFiles = Array.from(new Set(summary.entryFiles)).sort();
    return summary;
  }
}

module.exports = {
  ProjectContext,
  normalizeRelativePath,
  loadWorkspaceConfig,
  ENTRY_BASE_NAMES,
};
