/**
 * .gitignore 摄入——忽略/回含语义由 git 自己裁决（`check-ignore --stdin` 批量），
 * 不手写 .gitignore 解析器：anchored / dir-only / negation / 嵌套 .gitignore
 * 是一整套规格，手写必然漂移；git 就是现成 oracle，一个 spawn 拿到终审。
 */
const fs = require('fs');
const path = require('path');
const { runCommandSecure } = require('./command');

const CHECK_IGNORE_TIMEOUT_MS = 30000;

// root 是仓库子目录时它自己没有 .git，仓库在某个祖先目录里（.git 可能是目录，也可能是
// worktree / submodule 的文件）。纯文件系统检查，不起 git 进程：非仓库目录每次建索引都会走到这里。
function isInsideGitWorkTree(root) {
  let dir = path.resolve(root);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * 按 gitignore 语义过滤候选文件（只承担文件级过滤，目录剪枝仍归
 * DEFAULT_EXCLUDE_DIRS / .workspace-bridge.json 配置层）。
 *
 * 判定层级：
 * - 不在任何 git 仓库内且无 .gitignore → 什么都没承诺：原样返回，无警告。
 * - 在仓库内（含仓库的子目录）或有 .gitignore → 一次 check-ignore 批量终审；exit 0 的输出即
 *   被忽略集合（! 回含已由 git 算完），exit 1 = 无人被忽略，
 *   其余（git 缺席 / fatal / 超时）= 过滤不可用 → 显式降级警告 + 原样返回
 *   （L1-4：静默照单全收和静默丢弃都不允许）。
 *
 * @param {string} root
 * @param {string[]} files 绝对路径
 * @returns {Promise<{kept: string[], warning: object|null}>}
 */
async function filterGitIgnored(root, files) {
  if (files.length === 0) return { kept: files, warning: null };
  const hasGitignore = fs.existsSync(path.join(root, '.gitignore'));
  if (!hasGitignore && !isInsideGitWorkTree(root)) {
    return { kept: files, warning: null };
  }

  const absByRel = new Map();
  const inputParts = [];
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    absByRel.set(rel, f);
    inputParts.push(rel);
  }
  // -z：输入输出都 NUL 分隔，Unicode / 空格文件名零歧义
  const res = await runCommandSecure(
    'git',
    ['check-ignore', '--stdin', '-z'],
    root,
    CHECK_IGNORE_TIMEOUT_MS,
    { stdinData: `${inputParts.join('\0')}\0` }
  );

  if (res.exitCode === 1 && !res.error) {
    return { kept: files, warning: null }; // 无人被忽略
  }
  if (res.exitCode !== 0) {
    const reason = res.error ? String(res.error.message || res.error) : `exit ${res.exitCode}`;
    return {
      kept: files,
      warning: {
        type: 'gitignore-unavailable',
        severity: 'low',
        message: `gitignore filter unavailable (${reason}); ${files.length} candidate file(s) kept unfiltered`,
      },
    };
  }

  const ignoredRels = new Set(res.stdout.split('\0').filter(Boolean));
  const kept = [];
  for (const [rel, abs] of absByRel) {
    if (!ignoredRels.has(rel)) kept.push(abs);
  }
  return { kept, warning: null };
}

module.exports = { filterGitIgnored };
