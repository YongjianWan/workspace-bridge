// agent-ab dry run 用的桩 agent（docs/experiments/agent-offline-ab.md 第 10 节）：不调用模型。B 组原样交回 impact 列表，A 组交空列表；输出格式模仿 claude -p stream-json。
'use strict';
const fs = require('fs');
const prompt = fs.readFileSync(0, 'utf8');
let files = [];
const fence = prompt.indexOf('```json');
if (fence >= 0) {
  const parsed = JSON.parse(prompt.slice(fence + 7, prompt.lastIndexOf('```')));
  files = (parsed.impact || []).map((x) => x.file);
}
const text = JSON.stringify({ files });
const emit = (o) => console.log(JSON.stringify(o));
emit({ type: 'system', subtype: 'init', model: 'dry-stub', tools: ['Bash', 'Read'], apiKeySource: 'none' });
emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
emit({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0, num_turns: 1, usage: { input_tokens: 0, output_tokens: 0 } });
