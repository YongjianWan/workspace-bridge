// @contract
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
  parseVue,
  parseCpp,
  parseSvelte,
} = require('../src/services/dep-graph/parsers');

const fixtures = [
  { lang: 'javascript', file: 'tricky.js', parse: (content, fp) => parseJavaScript(content, fp) },
  { lang: 'python', file: 'tricky.py', parse: (content, fp) => parsePython(content, fp) },
  { lang: 'java', file: 'tricky.java', parse: (content, fp) => parseJava(content, fp) },
  { lang: 'kotlin', file: 'tricky.kt', parse: (content, fp) => parseKotlin(content, fp) },
  { lang: 'go', file: 'tricky.go', parse: (content, fp) => parseGo(content, fp) },
  { lang: 'rust', file: 'tricky.rs', parse: (content, fp) => parseRust(content, fp) },
  { lang: 'cpp', file: 'tricky.cpp', parse: (content, fp) => parseCpp(content, fp) },
  { lang: 'vue', file: 'tricky.vue', parse: (content, fp) => parseVue(content, fp) },
  { lang: 'svelte', file: 'tricky.svelte', parse: (content, fp) => parseSvelte(content, fp) },
];

function sanitize(val, workspaceRoot) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map((x) => sanitize(x, workspaceRoot));
  }
  if (typeof val === 'object') {
    const cleaned = {};
    const keys = Object.keys(val).sort();
    for (const k of keys) {
      if (k === 'parseTimeMs' || k === 'timestamp' || k === 'duration') continue;
      cleaned[k] = sanitize(val[k], workspaceRoot);
    }
    return cleaned;
  }
  if (typeof val === 'string') {
    let cleanedStr = val.replace(/\r\n/g, '\n');
    const wsPosix = workspaceRoot.replace(/\\/g, '/');
    cleanedStr = cleanedStr.replace(/\\/g, '/');
    if (cleanedStr.startsWith(wsPosix)) {
      cleanedStr = '<WORKSPACE>' + cleanedStr.slice(wsPosix.length);
    }
    cleanedStr = cleanedStr.split(wsPosix).join('<WORKSPACE>');
    return cleanedStr;
  }
  return val;
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..');
  const updateMode = process.env.UPDATE_GOLDENS === '1';

  const goldenDir = path.join(__dirname, 'fixtures', 'goldens');
  if (!fs.existsSync(goldenDir)) {
    fs.mkdirSync(goldenDir, { recursive: true });
  }

  for (const fixture of fixtures) {
    const filePath = path.join(__dirname, 'fixtures', 'tricky', fixture.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fixture file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    let rawResult = fixture.parse(content, filePath);
    if (rawResult instanceof Promise) {
      rawResult = await rawResult;
    }

    const sanitizedResult = sanitize(rawResult, workspaceRoot);
    const goldenFile = path.join(goldenDir, `${fixture.lang}.json`);

    if (updateMode) {
      fs.writeFileSync(goldenFile, JSON.stringify(sanitizedResult, null, 2), 'utf8');
      console.log(`Updated golden snapshot for ${fixture.lang}`);
    } else {
      if (!fs.existsSync(goldenFile)) {
        throw new Error(`Golden snapshot file not found for ${fixture.lang}. Run UPDATE_GOLDENS=1 node test/parser-golden-test.js to create it.`);
      }
      const goldenContent = fs.readFileSync(goldenFile, 'utf8');
      const expectedJson = JSON.parse(goldenContent);
      try {
        assert.deepStrictEqual(sanitizedResult, expectedJson);
      } catch (err) {
        console.error(`Golden snapshot comparison failed for ${fixture.lang}`);
        throw err;
      }
    }
  }

  // Fault-Tolerance Verification: Feed syntax-damaged/corrupt files
  const damagedContent = 'this is completely damaged syntax &%#$@ unresolved {';
  for (const fixture of fixtures) {
    try {
      let result = fixture.parse(damagedContent, 'damaged-file.' + fixture.file.split('.').pop());
      if (result instanceof Promise) {
        result = await result;
      }
      assert.ok(result && typeof result === 'object', `Damaged input failed to return an object for ${fixture.lang}`);
      // Assert it returns fallback mode gracefully rather than throwing fatal crashes
      assert(result.parseMode === 'none' || result.parseMode === 'regex' || result.ok === false || result.imports, `Expected fallback indicator or ok=false for damaged ${fixture.lang}, got ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`Damaged input parsing crashed for ${fixture.lang}`);
      throw err;
    }
  }

  console.log('Parser golden snapshot and fault-tolerance tests passed.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
