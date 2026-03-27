#!/usr/bin/env node
/**
 * MCP Protocol Integration Test
 */

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');

console.log('Starting MCP server...');
const server = spawn('node', [serverPath], {
  cwd: path.dirname(serverPath),
  env: { ...process.env, DEBUG: '1' },
});

let stdoutBuffer = Buffer.alloc(0);
let stderrBuffer = '';

server.stdout.on('data', (data) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, data]);
  
  // Try to parse MCP messages
  while (true) {
    const headerEnd = stdoutBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    
    const header = stdoutBuffer.slice(0, headerEnd).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    
    const length = parseInt(match[1], 10);
    const messageStart = headerEnd + 4;
    
    if (stdoutBuffer.length < messageStart + length) break;
    
    const body = stdoutBuffer.slice(messageStart, messageStart + length).toString();
    stdoutBuffer = stdoutBuffer.slice(messageStart + length);
    
    try {
      const msg = JSON.parse(body);
      console.log('📥 MCP Response:', JSON.stringify(msg, null, 2));
    } catch (e) {
      console.log('📥 Raw:', body);
    }
  }
});

server.stderr.on('data', (data) => {
  stderrBuffer += data.toString();
});

// Wait for server to start
setTimeout(() => {
  // Send initialize request
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.1.0' },
    },
  };
  
  const payload = JSON.stringify(request);
  const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  
  console.log('📤 Sending initialize request...');
  server.stdin.write(message);
}, 2000);

// Send tools/list request
setTimeout(() => {
  const request = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  };
  
  const payload = JSON.stringify(request);
  const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  
  console.log('📤 Sending tools/list request...');
  server.stdin.write(message);
}, 3000);

// Send a tool call
setTimeout(() => {
  const request = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'workspace_info',
      arguments: {},
    },
  };
  
  const payload = JSON.stringify(request);
  const message = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  
  console.log('📤 Sending workspace_info call...');
  server.stdin.write(message);
}, 4000);

// Shutdown
setTimeout(() => {
  console.log('\n📋 Stderr output:');
  console.log(stderrBuffer || '(none)');
  
  console.log('\n✅ Test completed');
  server.kill();
  process.exit(0);
}, 6000);
