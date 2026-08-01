/**
 * Python standard library membership — single home (L3-15).
 *
 * The authoritative source is sys.stdlib_module_names from the interpreter
 * that already gets spawned for AST parsing: version-correct by construction,
 * zero maintenance. Fetched once per process (spawnSync, memoized) on first
 * consultation; the hand-copied fallback below only serves the python-missing
 * degraded path and interpreters < 3.10 (no stdlib_module_names).
 *
 * The sync gate (_isExternalPythonModule) cannot await, so the fetch is lazy
 * sync + memo — one extra interpreter spawn per process, deterministic within
 * the process: every gate call in a run sees the same Set.
 */
const { spawnSync } = require('child_process');
const { TIMEOUTS } = require('../../../config/constants');
const { buildSafeEnv } = require('../../../utils/command');
const { resolveParserPython } = require('../parsers/spawn-ast');

// Hand-copied fallback, last synced 2026-08-01 (was PYTHON_STDLIB_ROOTS in
// resolvers.js). Bitten three times as the primary source (v11, v17
// __future__/tomllib/zoneinfo) — keep it strictly as the degraded-path net.
const PYTHON_STDLIB_FALLBACK = new Set([
  '__future__', // L2-11 gap B: `from __future__ import ...` is stdlib, never a workspace file
  'abc', 'aifc', 'argparse', 'array', 'ast', 'asyncio', 'atexit', 'audioop',
  'base64', 'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2',
  'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs',
  'codeop', 'collections', 'colorsys', 'compileall', 'concurrent', 'configparser',
  'contextlib', 'contextvars', 'copy', 'copyreg', 'crypt', 'csv', 'ctypes',
  'curses', 'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis',
  'distutils', 'doctest', 'email', 'encodings', 'enum', 'errno', 'faulthandler',
  'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools',
  'gc', 'getopt', 'getpass', 'gettext', 'glob', 'graphlib', 'grp', 'gzip',
  'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'imghdr', 'importlib',
  'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword', 'linecache',
  'locale', 'logging', 'lzma', 'mailbox', 'mailcap', 'marshal', 'math',
  'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc', 'nis',
  'nntplib', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'pathlib',
  'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib',
  'poplib', 'posix', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile',
  'pyclbr', 'pydoc', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib',
  'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors',
  'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib', 'sndhdr',
  'socket', 'socketserver', 'sqlite3', 'ssl', 'stat', 'statistics', 'string',
  'stringprep', 'struct', 'subprocess', 'sunau', 'symtable', 'sys', 'sysconfig',
  'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'test',
  'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize',
  'tomllib', // 3.11+; measured in CodeGraphContext droppedImports (L2-11 gap B cohort)
  'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings',
  'wave', 'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib',
  'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib', 'zoneinfo', '_thread',
]);

let _stdlibNames = null; // Set — memoized for the process, success or fallback

function _fetchStdlibNames(root) {
  const res = spawnSync(
    resolveParserPython(root),
    ['-c', 'import sys, json; print(json.dumps(sorted(sys.stdlib_module_names)))'],
    {
      encoding: 'utf-8',
      timeout: TIMEOUTS.PYTHON_AST_PARSE_MS,
      windowsHide: true,
      env: buildSafeEnv({ PYTHONIOENCODING: 'utf-8' }),
      maxBuffer: 1024 * 1024,
    }
  );
  if (res.error || res.status !== 0 || !res.stdout) return null;
  const names = JSON.parse(res.stdout);
  return Array.isArray(names) && names.length > 0 ? new Set(names) : null;
}

function getPythonStdlibNames(root) {
  if (_stdlibNames) return _stdlibNames;
  try {
    _stdlibNames = _fetchStdlibNames(root) || PYTHON_STDLIB_FALLBACK;
  } catch (_) {
    // Interpreter present but unreadable (Store stub, old version, bad JSON) —
    // the degraded path is the fallback list, same as python-missing.
    _stdlibNames = PYTHON_STDLIB_FALLBACK;
  }
  return _stdlibNames;
}

module.exports = {
  getPythonStdlibNames,
  PYTHON_STDLIB_FALLBACK,
};
