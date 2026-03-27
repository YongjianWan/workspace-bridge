#!/usr/bin/env node
/**
 * 功能可用性测试 - 验证 v0.5.0 实际运行状态
 */

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');

function sendRequest(stdin, request) {
  const payload = JSON.stringify(request);
  const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  stdin.write(message);
}

function waitForResponse(stdout, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      reject(new Error('Response timeout'));
    }, timeoutMs);

    const onData = (data) => {
      buffer = Buffer.concat([buffer, data]);
      
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      
      const header = buffer.slice(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) return;
      
      const length = parseInt(match[1], 10);
      const messageStart = headerEnd + 4;
      
      if (buffer.length < messageStart + length) return;
      
      const body = buffer.slice(messageStart, messageStart + length).toString();
      clearTimeout(timer);
      stdout.off('data', onData);
      
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({ parseError: true, raw: body });
      }
    };

    stdout.on('data', onData);
  });
}

async function testTool(stdin, stdout, name, args = {}) {
  console.log(`\n🧪 Testing ${name}...`);
  
  sendRequest(stdin, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name, arguments: args }
  });

  try {
    const response = await waitForResponse(stdout, 30000);
    
    if (response.error) {
      console.log(`  ❌ Error: ${response.error.message}`);
      return { success: false, error: response.error.message };
    }

    const resultText = response.result?.content?.[0]?.text;
    if (!resultText) {
      console.log(`  ❌ No content in response`);
      return { success: false, error: 'No content' };
    }

    let result;
    try {
      result = JSON.parse(resultText);
    } catch (e) {
      console.log(`  ⚠️  Non-JSON response: ${resultText.slice(0, 100)}...`);
      return { success: true, raw: resultText };
    }

    // 分析结果
    if (result.ok === false) {
      console.log(`  ❌ Tool returned ok: false, error: ${result.error}`);
      return { success: false, error: result.error, result };
    }

    console.log(`  ✅ Success`);
    
    // 输出关键字段
    const summary = {};
    if (result.files !== undefined) summary.files = result.files;
    if (result.symbols !== undefined) summary.symbols = result.symbols;
    if (result.diagnostics !== undefined) summary.diagnostics = result.diagnostics?.length || result.diagnosticCount;
    if (result.dependencies !== undefined) summary.dependencies = result.dependencies?.length;
    if (result.dependents !== undefined) summary.dependents = result.dependents?.length;
    if (result.impact !== undefined) summary.impact = result.impact?.length;
    if (result.cycles !== undefined) summary.cycles = result.cycles?.length;
    if (result.stats) summary.stats = result.stats;
    
    if (Object.keys(summary).length > 0) {
      console.log(`     ${JSON.stringify(summary)}`);
    }

    return { success: true, result };
  } catch (e) {
    console.log(`  ❌ Exception: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('=== workspace-bridge v0.5.0 功能可用性测试 ===\n');

  const server = spawn('node', [serverPath], {
    cwd: path.dirname(serverPath),
    env: { ...process.env, DEBUG: '0' }
  });

  let stderr = '';
  server.stderr.on('data', (data) => {
    stderr += data.toString();
    // 等待就绪信号
    if (stderr.includes('ready')) {
      console.log('✅ Server ready\n');
    }
  });

  // 等待服务器启动
  await new Promise(resolve => setTimeout(resolve, 3000));

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };

  // 测试 1: workspace_info
  const r1 = await testTool(server.stdin, server.stdout, 'workspace_info');
  results.total++; r1.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'workspace_info', ...r1 });

  // 测试 2: dependency_graph (stats)
  const r2 = await testTool(server.stdin, server.stdout, 'dependency_graph', { operation: 'stats' });
  results.total++; r2.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'dependency_graph(stats)', ...r2 });

  // 测试 3: dependency_graph (cycles)
  const r3 = await testTool(server.stdin, server.stdout, 'dependency_graph', { operation: 'cycles' });
  results.total++; r3.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'dependency_graph(cycles)', ...r3 });

  // 测试 4: dependency_graph (impact) - 使用已知文件
  const r4 = await testTool(server.stdin, server.stdout, 'dependency_graph', { 
    operation: 'impact', 
    file: 'src/services/container.js' 
  });
  results.total++; r4.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'dependency_graph(impact)', ...r4 });

  // 测试 5: lookup_symbol
  const r5 = await testTool(server.stdin, server.stdout, 'lookup_symbol', { name: 'ServiceContainer' });
  results.total++; r5.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'lookup_symbol', ...r5 });

  // 测试 6: search_code
  const r6 = await testTool(server.stdin, server.stdout, 'search_code', { query: 'class', type: 'symbol' });
  results.total++; r6.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'search_code', ...r6 });

  // 测试 7: git_diff_summary
  const r7 = await testTool(server.stdin, server.stdout, 'git_diff_summary');
  results.total++; r7.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'git_diff_summary', ...r7 });

  // 测试 8: git_blame - 使用已知文件
  const r8 = await testTool(server.stdin, server.stdout, 'git_blame', { file: 'server.js' });
  results.total++; r8.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'git_blame', ...r8 });

  // 测试 9: project_health
  const r9 = await testTool(server.stdin, server.stdout, 'project_health');
  results.total++; r9.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'project_health', ...r9 });

  // 测试 10: check_dependencies
  const r10 = await testTool(server.stdin, server.stdout, 'check_dependencies');
  results.total++; r10.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'check_dependencies', ...r10 });

  // 测试 11: diagnostics_live - 使用已知 JS 文件
  const r11 = await testTool(server.stdin, server.stdout, 'diagnostics_live', { file: 'src/services/container.js' });
  results.total++; r11.success ? results.passed++ : results.failed++;
  results.details.push({ tool: 'diagnostics_live', ...r11 });

  // 总结
  console.log('\n=== 测试结果 ===');
  console.log(`总计: ${results.total}`);
  console.log(`通过: ${results.passed}`);
  console.log(`失败: ${results.failed}`);
  console.log(`成功率: ${(results.passed / results.total * 100).toFixed(1)}%`);

  // 失败详情
  const failures = results.details.filter(r => !r.success);
  if (failures.length > 0) {
    console.log('\n=== 失败详情 ===');
    failures.forEach(f => {
      console.log(`${f.tool}: ${f.error}`);
    });
  }

  // 关键功能评估
  console.log('\n=== 关键功能评估 ===');
  
  const depGraphWorking = results.details.find(r => r.tool === 'dependency_graph(stats)')?.success;
  console.log(`dependency_graph: ${depGraphWorking ? '✅ 可用' : '❌ 不可用'}`);
  
  const diagnosticsWorking = results.details.find(r => r.tool === 'diagnostics_live')?.success;
  console.log(`diagnostics_live: ${diagnosticsWorking ? '✅ 可用' : '❌ 不可用'}`);
  
  const symbolWorking = results.details.find(r => r.tool === 'lookup_symbol')?.success;
  console.log(`lookup_symbol: ${symbolWorking ? '✅ 可用' : '❌ 不可用'}`);

  server.kill();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
