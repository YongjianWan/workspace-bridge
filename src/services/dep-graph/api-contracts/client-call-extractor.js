/**
 * Client-side HTTP call extractor for API contract discovery.
 *
 * Lightweight regex-based scanner for axios / fetch calls.
 * Purposely narrow: only static string URLs are extracted; dynamic / template
 * URLs are reported as warnings so callers do not silently trust incomplete data.
 */

const fs = require('fs');
const path = require('path');

const CLIENT_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.mjs', '.cjs']);
const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

function normalizeMethod(method) {
  if (!method) return 'GET';
  const m = String(method).trim().toUpperCase();
  return VALID_METHODS.has(m.toLowerCase()) ? m : 'GET';
}

/**
 * Strip JavaScript/TypeScript line and block comments while preserving
 * string literals. This prevents commented-out code (e.g. examples) from
 * being extracted as real HTTP calls.
 * @param {string} content
 * @returns {string}
 */
function stripComments(content) {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '/' && next === '/') {
      while (i < content.length && content[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      result += ch;
      i++;
      while (i < content.length) {
        if (content[i] === '\\') {
          result += content[i];
          i++;
          if (i < content.length) {
            result += content[i];
            i++;
          }
          continue;
        }
        result += content[i];
        i++;
        if (content[i - 1] === quote) break;
      }
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

function isStaticPath(str) {
  if (!str || typeof str !== 'string') return false;
  // Reject template literals with interpolation and obvious dynamic expressions.
  if (str.includes('${') || str.includes('+')) return false;
  // Accept single/double quotes and un-interpolated template literals.
  if (/^['"`][^'"`]*['"`]$/.test(str)) return true;
  return false;
}

function extractMethodFromFetchOptions(content, callEndIndex) {
  // Look for a second argument object literal after the fetch call.
  const after = content.slice(callEndIndex);
  const match = after.match(/^\s*,\s*\{([\s\S]{0,400})\}/);
  if (!match) return 'GET';
  const methodMatch = match[1].match(/method\s*:\s*['"`]([a-zA-Z]+)['"`]/);
  return normalizeMethod(methodMatch?.[1]);
}

function isFollowedByConcatenation(block, quoteEndIndex) {
  const after = block.slice(quoteEndIndex);
  return /^\s*\+/.test(after);
}

function extractAxiosConfigCalls(content) {
  const calls = [];
  // axios({ url: '/api/x', method: 'post' }) or axios.request({...})
  // Deliberately narrow: only match the literal identifier "axios" to avoid
  // false positives on variables like apiConfig or myApi.request.
  const re = /\baxios\s*(?:\.\s*request)?\s*\(\s*\{/gi;
  let match;
  while ((match = re.exec(content)) !== null) {
    const start = match.index + match[0].length - 1; // position of '{'
    let depth = 1;
    let i = start + 1;
    let block = '';
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) block += ch;
      i++;
    }
    const urlRe = /url\s*:\s*['"`]([^'"`]+)['"`]/g;
    const pathRe = /(?:path|pathname)\s*:\s*['"`]([^'"`]+)['"`]/g;
    const urlMatch = urlRe.exec(block);
    const pathMatch = pathRe.exec(block);
    let rawPath = null;
    let quoteEnd = -1;
    if (urlMatch) {
      rawPath = urlMatch[1];
      quoteEnd = urlMatch.index + urlMatch[0].length;
    } else if (pathMatch) {
      rawPath = pathMatch[1];
      quoteEnd = pathMatch.index + pathMatch[0].length;
    }
    if (rawPath && isStaticPath(`'${rawPath}'`) && !isFollowedByConcatenation(block, quoteEnd)) {
      const methodMatch = block.match(/method\s*:\s*['"`]([a-zA-Z]+)['"`]/);
      calls.push({ method: normalizeMethod(methodMatch?.[1]), path: rawPath });
    }
  }
  return calls;
}

function extractClientCallsFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CLIENT_EXTENSIONS.has(ext)) {
    return { calls: [], warnings: [] };
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { calls: [], warnings: [{ file: filePath, reason: 'read-error', message: err.message }] };
  }

  content = stripComments(content);

  const calls = [];
  const warnings = [];

  // 1. axios shorthand: axios.get('/path', ...)
  const axiosShorthandRe = /\baxios\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let m;
  while ((m = axiosShorthandRe.exec(content)) !== null) {
    const rawPath = m[2];
    if (isStaticPath(`'${rawPath}'`)) {
      calls.push({ method: normalizeMethod(m[1]), path: rawPath });
    }
  }

  // 2. fetch('/path', { method: 'POST' })
  const fetchRe = /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  while ((m = fetchRe.exec(content)) !== null) {
    const rawPath = m[1];
    if (isStaticPath(`'${rawPath}'`)) {
      const callEnd = m.index + m[0].length;
      calls.push({ method: extractMethodFromFetchOptions(content, callEnd), path: rawPath });
    }
  }

  // 3. axios({ url: '/path', method: 'POST' })
  calls.push(...extractAxiosConfigCalls(content));

  // Deduplicate within file.
  const seen = new Set();
  const deduped = [];
  for (const call of calls) {
    const key = `${call.method}:${call.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...call, file: filePath });
  }

  // Warn on template-literal URLs that we intentionally skip.
  const templateUrlRe = /(?:axios\s*\.\s*(?:get|post|put|delete|patch|head|options)|fetch)\s*\(\s*`[^`]*\$\{/g;
  if (templateUrlRe.test(content)) {
    warnings.push({ file: filePath, reason: 'dynamic-url-skipped', message: 'Template-literal URLs with interpolation are not statically extractable' });
  }

  return { calls: deduped, warnings };
}

/**
 * Scan a list of files and extract all static client HTTP calls.
 * @param {string[]} filePaths
 * @returns {{ calls: Array<{method:string, path:string, file:string}>, warnings: Array<{file:string, reason:string, message:string}> }}
 */
function extractClientCalls(filePaths) {
  const calls = [];
  const warnings = [];
  for (const file of filePaths) {
    const result = extractClientCallsFromFile(file);
    calls.push(...result.calls);
    warnings.push(...result.warnings);
  }
  return { calls, warnings };
}

module.exports = {
  extractClientCalls,
  extractClientCallsFromFile,
  CLIENT_EXTENSIONS,
};
