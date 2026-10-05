/**
 * Whole-application tests.
 *
 * A JVM test annotated @SpringBootTest starts the full application context, so a fault in any
 * source of its module can fail it although no import connects them. The import graph cannot see
 * this, so affected-tests adds these tests for every JVM source of the same module.
 */

const WHOLE_APP_TEST_RE = /@SpringBootTest\b/;
const JVM_EXTENSIONS = new Set(['.java', '.kt']);
const MODULE_SOURCE_DIR = '/src/';

function isJvmFile(fileKey) {
  const dot = fileKey.lastIndexOf('.');
  return dot >= 0 && JVM_EXTENSIONS.has(fileKey.slice(dot));
}

/** Directory holding the module's `src/` tree, from a workspace-relative path; '' for the top level or a flat layout. */
function moduleRootOf(relativePath) {
  const withRoot = `/${relativePath}`;
  const at = withRoot.indexOf(MODULE_SOURCE_DIR);
  return at > 0 ? withRoot.slice(0, at) : '';
}

function isWholeAppTest(text) {
  return WHOLE_APP_TEST_RE.test(text);
}

module.exports = { isJvmFile, moduleRootOf, isWholeAppTest };
