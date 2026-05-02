/**
 * CodeQL adapter — database creation + SARIF analysis.
 *
 * Workflow:
 * 1. Detect primary language from workspace markers.
 * 2. Ensure CodeQL database exists (reuse if present, create if missing).
 * 3. Run `codeql database analyze` with standard query packs.
 * 4. Parse SARIF v2.1.0 and normalize findings.
 */
const fs = require('fs');
const path = require('path');
const { BaseAdapter } = require('./base');
const { runCommandSecure, commandExists } = require('../utils/command');
const { pathExists } = require('../utils/path');

const LANGUAGE_MARKERS = [
  { lang: 'javascript', files: ['package.json', 'tsconfig.json'] },
  { lang: 'python', files: ['requirements.txt', 'pyproject.toml', 'setup.py'] },
  { lang: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { lang: 'go', files: ['go.mod'] },
  { lang: 'ruby', files: ['Gemfile'] },
  { lang: 'cpp', files: ['CMakeLists.txt', 'Makefile'] },
];

const QUERY_PACK_MAP = {
  javascript: 'codeql/javascript-queries',
  python: 'codeql/python-queries',
  java: 'codeql/java-queries',
  go: 'codeql/go-queries',
  ruby: 'codeql/ruby-queries',
  cpp: 'codeql/cpp-queries',
};

const DB_TIMEOUT_MS = 300000;   // 5 min for database creation
const ANALYZE_TIMEOUT_MS = 300000; // 5 min for analysis

function detectCodeQLLanguage(cwd) {
  for (const { lang, files } of LANGUAGE_MARKERS) {
    if (files.some((f) => pathExists(path.join(cwd, f)))) return lang;
  }
  return null;
}

function dbPathFor(cwd, language) {
  return path.join(cwd, '.codeql', 'databases', language);
}

function resultsPathFor(cwd, language) {
  return path.join(cwd, '.codeql', 'results', `${language}.sarif`);
}

class CodeQLAdapter extends BaseAdapter {
  get name() {
    return 'codeql';
  }

  async isAvailable(cwd) {
    return commandExists('codeql', cwd);
  }

  async scan(targets, options = {}) {
    const language = options.language || detectCodeQLLanguage(options.cwd);
    if (!language) {
      return {
        findings: [],
        summary: {
          total: 0,
          scanned: 0,
          error: 'Unable to detect language. Pass --language or ensure a known build file exists.',
        },
      };
    }

    const queryPack = QUERY_PACK_MAP[language];
    if (!queryPack) {
      return {
        findings: [],
        summary: {
          total: 0,
          scanned: 0,
          error: `Unsupported language for CodeQL: ${language}`,
        },
      };
    }

    try {
      const dbPath = await this._ensureDatabase(options.cwd, language, options);
      const sarif = await this._analyzeDatabase(dbPath, language, queryPack, options);
      const rawResults = this._extractResultsFromSarif(sarif);
      const findings = rawResults.map((r) => this.normalizeFinding(r));
      return {
        findings,
        summary: {
          total: findings.length,
          scanned: targets.length,
          language,
          error: null,
        },
      };
    } catch (err) {
      return {
        findings: [],
        summary: {
          total: 0,
          scanned: 0,
          language,
          error: err.message || String(err),
        },
      };
    }
  }

  async _ensureDatabase(cwd, language, options = {}) {
    const dbPath = dbPathFor(cwd, language);
    if (!options.forceRefresh && pathExists(dbPath)) {
      return dbPath;
    }
    if (pathExists(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }
    const result = await runCommandSecure('codeql', [
      'database', 'create', dbPath,
      `--language=${language}`,
      `--source-root=${cwd}`,
      '--quiet',
    ], cwd, DB_TIMEOUT_MS);
    if (!result.ok) {
      throw new Error(`CodeQL database creation failed: ${result.stderr || result.stdout}`);
    }
    return dbPath;
  }

  async _analyzeDatabase(dbPath, language, queryPack, options = {}) {
    const outPath = resultsPathFor(options.cwd, language);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const result = await runCommandSecure('codeql', [
      'database', 'analyze', dbPath,
      '--format=sarifv2.1.0',
      `--output=${outPath}`,
      '--quiet',
      queryPack,
    ], options.cwd, ANALYZE_TIMEOUT_MS);
    if (!result.ok) {
      throw new Error(`CodeQL analysis failed: ${result.stderr || result.stdout}`);
    }
    const content = fs.readFileSync(outPath, 'utf8');
    return JSON.parse(content);
  }

  _extractResultsFromSarif(sarif) {
    if (!sarif || !Array.isArray(sarif.runs)) return [];
    const results = [];
    for (const run of sarif.runs) {
      if (Array.isArray(run.results)) {
        results.push(...run.results);
      }
    }
    return results;
  }

  normalizeFinding(raw) {
    const severityMap = {
      error: 'high',
      warning: 'medium',
      note: 'low',
      none: 'low',
    };
    const level = raw.level || 'warning';
    const severity = severityMap[level] || 'medium';
    const location = raw.locations?.[0]?.physicalLocation;
    return {
      ruleId: raw.ruleId || raw.rule?.id || 'unknown',
      message: raw.message?.text || raw.message?.markdown || '',
      severity,
      file: location?.artifactLocation?.uri || '',
      lineStart: location?.region?.startLine,
      lineEnd: location?.region?.endLine,
      tool: this.name,
    };
  }
}

module.exports = { CodeQLAdapter };
