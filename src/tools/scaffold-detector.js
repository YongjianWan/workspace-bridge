/**
 * Scaffold detector — identifies files belonging to known scaffolding templates.
 *
 * Problem: popular scaffolding templates (RuoYi, Vue Admin) produce 30+ identical
 * dead-export findings across projects. Without scaffolding detection, AI must
 * manually filter known boilerplate noise from real business-code signals.
 *
 * Design: conservative path-based fingerprinting.
 * - exactBasenames: highly specific file names that almost never appear outside
 *   the scaffold (e.g. `AbstractQuartzJob.java`, `XssHttpServletRequestWrapper.java`).
 * - pathPatterns: basename patterns that are generic (e.g. `StringUtils.java`) but
 *   only match when the file path contains a scaffold-specific directory marker
 *   (e.g. `ruoyi`, `com/ruoyi`). This avoids false-positives on non-scaffold projects.
 *
 * No content scanning, no AST — pure path matching for O(1) cost per file.
 */
const path = require('path');

// ── Known scaffold fingerprints ─────────────────────────────────────────────
// Each entry: { name, reason, description, exactBasenames[], pathPatterns[] }
const SCAFFOLD_FINGERPRINTS = [
  {
    name: 'ruoyi-java',
    reason: 'scaffold-ruoyi',
    description: 'RuoYi Java scaffolding (backend admin framework)',
    // Highly specific basenames — almost impossible outside RuoYi
    exactBasenames: new Set([
      'abstractquartzjob.java',
      'quartzdisallowconcurrentexecution.java',
      'jobinvokeutil.java',
      'xsshttpservletrequestwrapper.java',
      'repeatsubmitinterceptor.java',
      'datalscopeaspect.java',
      'sensitivejsonserializer.java',
      'servletutils.java',
      'loginuser.java',
      'sysuser.java',
      'sysrole.java',
      'sysmenu.java',
      'sysdept.java',
      'syspost.java',
      'sysdictdata.java',
      'sysdicttype.java',
      'sysconfig.java',
      'sysnotice.java',
      'sysoperlog.java',
      'syslogininfor.java',
    ]),
    // Generic basenames that only count as scaffold when path contains a marker
    pathPatterns: [
      {
        marker: /ruoyi/i,
        regex: /^(constants|httpstatus|userconstants|genconstants|dictconstants|stringutils|strformatter|dateutils|fileutils|excelutils|securityutils|iputils|idutils|asyncutils|sqlutils|jsonutils|springutils|threadutils|verifyutils|encryptutils|downloadutils)\.java$/i,
      },
    ],
  },
  {
    name: 'vue-admin',
    reason: 'scaffold-vue-admin',
    description: 'Vue Admin scaffolding (frontend admin dashboard)',
    exactBasenames: new Set([
      'ruoyi.js',
      'permission.js',
      'validate.js',
    ]),
    pathPatterns: [
      {
        marker: /\/ruoyi\//i,
        regex: /\.(js|ts|vue)$/i,
      },
      {
        marker: /\/generator\//i,
        regex: /\.(js|ts)$/i,
      },
    ],
  },
];

/**
 * Detect whether a file belongs to a known scaffold template.
 * @param {string} filePath — absolute or relative file path
 * @returns {{name: string, reason: string, description: string} | null}
 */
function detectScaffold(filePath) {
  if (!filePath) return null;
  const base = path.basename(filePath);
  const baseLower = base.toLowerCase();

  for (const fp of SCAFFOLD_FINGERPRINTS) {
    // Exact basename match (case-insensitive)
    if (fp.exactBasenames.has(baseLower)) {
      return { name: fp.name, reason: fp.reason, description: fp.description };
    }

    // Path-pattern match: marker in path + basename fits generic pattern
    for (const pp of fp.pathPatterns) {
      if (pp.marker.test(filePath) && pp.regex.test(base)) {
        return { name: fp.name, reason: fp.reason, description: fp.description };
      }
    }
  }

  return null;
}

/** Prefix for all scaffold false-positive reasons (used by consumers to aggregate). */
const SCAFFOLD_REASON_PREFIX = 'scaffold-';

module.exports = {
  detectScaffold,
  SCAFFOLD_FINGERPRINTS,
  SCAFFOLD_REASON_PREFIX,
};
