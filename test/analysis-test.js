#!/usr/bin/env node
/**
 * 跨文件分析测试 - 验证 Phase 3 新增的三个分析查询
 * Tests: dead_exports, unresolved, affected_tests
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

    if (result.ok === false) {
      console.log(`  ❌ Tool returned ok: false, error: ${result.error}`);
      return { success: false, error: result.error, result };
    }

    console.log(`  ✅ Success`);
    return { success: true, result };
  } catch (e) {
    console.log(`  ❌ Exception: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log('=== workspace-bridge v0.6.0 跨文件分析测试 ===\n');

  // 创建临时测试文件
  const testDir = path.join(__dirname, '..', 'test-temp');
  const testFile = path.join(testDir, 'test-module.js');
  const testUnusedFile = path.join(testDir, 'unused-module.js');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // 创建一个有导出但未使用的文件
  fs.writeFileSync(testUnusedFile, `
// 这个文件的导出未被使用
export function unusedHelper() {
  return 'I am not used';
}

export const UNUSED_CONST = 42;
`);

  // 创建一个导入不存在的模块的文件
  fs.writeFileSync(testFile, `
// 导入不存在的模块
import { something } from './non-existent-module';
import fs from 'fs';

export function test() {
  return something;
}
`);

  const server = spawn('node', [serverPath], {
    cwd: path.dirname(serverPath),
    env: { ...process.env, DEBUG: '0' }
  });

  let stderr = '';
  let ready = false;
  server.stderr.on('data', (data) => {
    stderr += data.toString();
    if (stderr.includes('ready') && !ready) {
      ready = true;
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

  try {
    // 测试 1: dead_exports - 查找死代码
    console.log('📋 Test Group: dead_exports');
    const r1 = await testTool(server.stdin, server.stdout, 'dependency_graph', { 
      operation: 'dead_exports' 
    });
    results.total++; 
    if (r1.success) {
      // 验证返回结构
      assert(Array.isArray(r1.result.deadExports), 'deadExports should be an array');
      assert(typeof r1.result.deadExportCount === 'number', 'deadExportCount should be a number');
      console.log(`     Found ${r1.result.deadExportCount} files with dead exports`);
      r1.result.deadExports.slice(0, 3).forEach(item => {
        console.log(`     - ${path.basename(item.file)}: ${item.exports.length} exports (${item.confidence})`);
      });
      results.passed++;
    } else {
      results.failed++;
    }
    results.details.push({ tool: 'dead_exports', ...r1 });

    // 测试 2: unresolved - 查找未解析的导入
    console.log('\n📋 Test Group: unresolved');
    const r2 = await testTool(server.stdin, server.stdout, 'dependency_graph', { 
      operation: 'unresolved' 
    });
    results.total++;
    if (r2.success) {
      assert(Array.isArray(r2.result.unresolved), 'unresolved should be an array');
      assert(typeof r2.result.unresolvedCount === 'number', 'unresolvedCount should be a number');
      console.log(`     Found ${r2.result.unresolvedCount} unresolved imports`);
      r2.result.unresolved.slice(0, 3).forEach(item => {
        console.log(`     - ${path.basename(item.file)} imports "${item.import}"`);
      });
      results.passed++;
    } else {
      results.failed++;
    }
    results.details.push({ tool: 'unresolved', ...r2 });

    // 测试 3: affected_tests - 查找受影响的测试（使用现有测试文件）
    console.log('\n📋 Test Group: affected_tests');
    const r3 = await testTool(server.stdin, server.stdout, 'dependency_graph', { 
      operation: 'affected_tests',
      file: 'src/services/container.js'
    });
    results.total++;
    if (r3.success) {
      assert(Array.isArray(r3.result.affectedTests), 'affectedTests should be an array');
      assert(typeof r3.result.affectedTestCount === 'number', 'affectedTestCount should be a number');
      console.log(`     Found ${r3.result.affectedTestCount} affected tests`);
      r3.result.affectedTests.slice(0, 3).forEach(item => {
        console.log(`     - ${path.basename(item.file)} (distance: ${item.distance})`);
      });
      results.passed++;
    } else {
      results.failed++;
    }
    results.details.push({ tool: 'affected_tests', ...r3 });

    // 测试 4: affected_tests with maxDepth
    console.log('\n📋 Test Group: affected_tests with maxDepth');
    const r4 = await testTool(server.stdin, server.stdout, 'dependency_graph', { 
      operation: 'affected_tests',
      file: 'src/services/container.js',
      maxDepth: 2
    });
    results.total++;
    if (r4.success) {
      assert(r4.result.maxDepth === 2, 'maxDepth should be 2');
      // 验证返回的测试文件距离都不超过 maxDepth
      const allWithinDepth = r4.result.affectedTests.every(t => t.distance <= 2);
      assert(allWithinDepth, 'All affected tests should be within maxDepth');
      console.log(`     Found ${r4.result.affectedTestCount} affected tests within depth 2`);
      results.passed++;
    } else {
      results.failed++;
    }
    results.details.push({ tool: 'affected_tests(maxDepth)', ...r4 });

    // 测试 5: 向后兼容 - 原有 operation 仍然工作
    console.log('\n📋 Test Group: Backward Compatibility');
    const r5 = await testTool(server.stdin, server.stdout, 'dependency_graph', { 
      operation: 'stats' 
    });
    results.total++;
    if (r5.success && r5.result.stats) {
      console.log(`     Stats: ${r5.result.stats.files} files, ${r5.result.stats.totalImports} imports`);
      results.passed++;
    } else {
      results.failed++;
    }
    results.details.push({ tool: 'backward_compat(stats)', ...r5 });

  } finally {
    // 清理临时文件
    try {
      fs.unlinkSync(testFile);
      fs.unlinkSync(testUnusedFile);
      fs.rmdirSync(testDir);
    } catch (e) {
      // 忽略清理错误
    }
  }

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

  // 功能评估
  console.log('\n=== 新增分析功能评估 ===');
  const deadExportsWorking = results.details.find(r => r.tool === 'dead_exports')?.success;
  console.log(`dead_exports: ${deadExportsWorking ? '✅ 可用' : '❌ 不可用'}`);
  
  const unresolvedWorking = results.details.find(r => r.tool === 'unresolved')?.success;
  console.log(`unresolved: ${unresolvedWorking ? '✅ 可用' : '❌ 不可用'}`);
  
  const affectedTestsWorking = results.details.find(r => r.tool === 'affected_tests')?.success;
  console.log(`affected_tests: ${affectedTestsWorking ? '✅ 可用' : '❌ 不可用'}`);

  server.kill();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
