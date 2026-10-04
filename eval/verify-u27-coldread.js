#!/usr/bin/env node
'use strict';

// @contract
// Snapshot one document per subject so later edits cannot change its evidence.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'truth', 'u27-coldread');
const questions = [
  '项目目前在什么平台和 Node 版本上通过了哪些测试？这些结果能否支持跨平台全绿的结论？',
  'JSON 输出的字段选择与 schemaVersion 契约是什么？字段是否可以全部被 --fields 删掉？',
  '退出码 0、1、2 分别意味着什么？发现问题是否必然返回非零？',
  '--quiet 是否保证任何情况下 stderr 都为空？',
  'PowerShell 管道输出 JSON 是否必然有 BOM 或必然导致消费者失败？',
  '如果要开始分析一个工作区，当前推荐使用什么入口与命令？如何理解工具的能力边界？',
];
const sources = [
  ['readme', 'README.md'],
  ['skill', 'skills/workspace-audit/SKILL.md'],
  ['agents', 'AGENTS.md'],
];
fs.mkdirSync(output, { recursive: true });
const manifest = sources.map(([id, file]) => {
  const body = fs.readFileSync(path.join(root, file));
  const snapshot = `${id}.source.md`;
  fs.writeFileSync(path.join(output, snapshot), body);
  return { id, source: file, snapshot, sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length };
});
fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), questions, sources: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ output, subjects: manifest.length, questions: questions.length }));
