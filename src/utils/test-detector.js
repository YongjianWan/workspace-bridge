const path = require('path');
const { toPosixPath, normalizePathKey } = require('./path');

const HEURISTIC_ROOT_SEGMENTS = new Set([
  'src', 'app', 'lib', 'source', 'sources',
  'test', 'tests', '__tests__', 'spec', 'specs',
  'main', 'java', 'python', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'packages', 'package',
  'kotlin', 'go', 'rust',
  'cypress', 'e2e', 'integration',
]);

// 规则表驱动：所有测试检测规则集中于此，消除 if-else 链
const TEST_DETECTION_RULES = [
  { type: 'path', includes: '/test/' },
  { type: 'path', includes: '/tests/' },
  { type: 'path', includes: '/src/test/java/' },
  { type: 'path', includes: '/__tests__/' },
  { type: 'path', endsWith: '/test' },
  { type: 'path', endsWith: '/tests' },
  { type: 'path', endsWith: '/__tests__' },
  { type: 'basename', regex: /\.test\./ },
  { type: 'basename', regex: /\.spec\./ },
  { type: 'basename', regex: /(test|tests|it)\.java$/i },
  { type: 'basename', regex: /.*(?:Test|Tests|IT)\.java$/i },
  { type: 'basename', regex: /^test.*\.py$/i },
  { type: 'basename', exact: 'tests.py' },
  { type: 'basename', regex: /^test_/ },
  { type: 'basename', regex: /_test\./ },
  { type: 'basename', regex: /_test\.go$/ },
  { type: 'basename', regex: /(Tests?|Test)\.kt$/i },
  { type: 'path', includes: '/spec/' },
  { type: 'basename', regex: /_spec\.rb$/ },
  { type: 'basename', regex: /_test\.rb$/ },
  { type: 'basename', regex: /\.cy\./ },
  { type: 'basename', regex: /\.e2e\./ },
  { type: 'basename', regex: /\.integration\./ },
  { type: 'path', includes: '/cypress/' },
  { type: 'path', includes: '/e2e/' },
];

function normalizeStem(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return base
    .replace(/^test_/, '')
    .replace(/_test$/, '')
    .replace(/(?:\.|_)(?:cy|e2e|integration)$/, '')
    .replace(/(?:\.|_)(?:test|spec)$/, '');
}

function normalizeHeuristicName(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);

  if (ext === '.java') {
    return base.replace(/(?:UnitTests?|IntegrationTests?|SystemTests?|TestSuites?|FunctionalTests?|TestCases?|Tests?|Specs?|ITs?)$/, '').toLowerCase();
  }
  if (ext === '.kt') {
    return base.replace(/(?:Tests?|Test)$/, '').toLowerCase();
  }

  return normalizeStem(filePath);
}

function buildHeuristicSignature(root, filePath) {
  // Normalize Windows absolute paths on POSIX systems.
  // path.relative('/repo', 'C:\repo\...') is unpredictable on POSIX;
  // strip the drive letter so both paths share a common structure.
  const posixRoot = toPosixPath(path.normalize(root));
  let posixFile = toPosixPath(path.normalize(filePath));
  posixFile = posixFile.replace(/^[a-zA-Z]:\//, '/');

  let relativePath;
  if (posixFile.startsWith(posixRoot + '/')) {
    relativePath = posixFile.slice(posixRoot.length + 1);
  } else {
    relativePath = toPosixPath(path.relative(root, filePath));
  }

  const segments = relativePath
    .split('/')
    .filter(Boolean)
    .filter((segment) => !HEURISTIC_ROOT_SEGMENTS.has(segment.toLowerCase()));

  if (segments.length === 0) {
    return '';
  }

  const leaf = normalizeHeuristicName(filePath);
  if (!leaf) {
    return '';
  }

  segments[segments.length - 1] = leaf.toLowerCase();
  return segments.map((segment) => segment.toLowerCase()).join('/');
}

function getHeuristicLanguageFamily(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    return 'js-family';
  }
  if (ext === '.java' || ext === '.kt') {
    return 'java-family';
  }
  if (ext === '.py') {
    return 'python-family';
  }
  if (ext === '.go') {
    return 'go-family';
  }
  if (ext === '.rs') {
    return 'rust-family';
  }
  if (ext === '.rb') {
    return 'ruby-family';
  }
  return 'unknown';
}

function isTestLikeFile(filePath) {
  const normalized = normalizePathKey(filePath);
  const base = path.basename(normalized);
  const dir = path.dirname(normalized);

  for (const rule of TEST_DETECTION_RULES) {
    if (rule.type === 'path') {
      if (rule.includes && normalized.includes(rule.includes)) return true;
      if (rule.endsWith && dir.endsWith(rule.endsWith)) return true;
    } else if (rule.type === 'basename') {
      if (rule.exact !== undefined && base === rule.exact) return true;
      if (rule.regex && rule.regex.test(base)) return true;
    }
  }
  return false;
}

module.exports = {
  normalizeStem,
  normalizeHeuristicName,
  buildHeuristicSignature,
  getHeuristicLanguageFamily,
  isTestLikeFile,
};
