#!/usr/bin/env node
/**
 * workspace-bridge MCP Server v0.7.0 - Dual Transport Edition
 * 
 * Supports both stdio (CLI) and HTTP/SSE (GUI) modes
 * 
 * Capabilities:
 *   - Real-time workspace indexing and caching
 *   - Proactive diagnostic monitoring
 *   - Context-aware code generation
 *   - Fast symbol lookups (<100ms)
 *   - Intelligent suggestions
 * 
 * Architecture:
 *   ArmedServer (context-aware protocol handler)
 *   └── ContextEngine (file watcher + index + cache)
 *       └── Real-time symbol database
 *       └── Git status monitor
 *       └── Diagnostic aggregator
 * 
 * Transport Modes:
 *   - stdio: MCP_MODE=stdio or default (backward compatible)
 *   - HTTP:  MCP_MODE=http or PORT set (for GUI clients)
 */

const { getContainer } = require('./src/services/container');
const { createToolRegistry } = require('./src/tool-registry');
const { debug, info, error } = require('./src/utils/logger');

// Handle unhandled rejections to prevent crash
process.on('unhandledRejection', (reason, promise) => {
  error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  error('[Uncaught Exception]', err);
  process.exit(1);
});

const SERVER_INFO = {
  name: 'workspace-bridge',
  version: '0.7.0',
  capabilities: ['workspace-introspection', 'git-tools', 'code-search', 'diagnostics', 'symbol-index'],
};

/**
 * Sanitize error message to remove sensitive information
 */
function sanitizeErrorMessage(message, workspaceRoot) {
  if (!message || typeof message !== 'string') {
    return 'Internal error';
  }
  
  let sanitized = message;
  
  // Remove Windows absolute paths: C:\Users\name\...
  sanitized = sanitized.replace(/[A-Za-z]:\\[^\s]+/g, '<path>');
  
  // Remove Unix absolute paths: /home/name/... /Users/name/...
  sanitized = sanitized.replace(/\/[^\s]+/g, (match) => {
    if (match.startsWith('./') || match.startsWith('../')) {
      return match;
    }
    return '<path>';
  });
  
  // Remove specific user directories
  const userDirs = ['home', 'Users', 'user', process.env.USERNAME || process.env.USER].filter(Boolean);
  const userDirPattern = new RegExp(`\\b(${userDirs.join('|')})\\b`, 'gi');
  sanitized = sanitized.replace(userDirPattern, '<user>');
  
  return sanitized;
}

// ============== STDIO Mode ==============

class StdioMCPServer {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.tools = new Map();
    this.buffer = Buffer.alloc(0);
    
    process.stdin.on('data', (chunk) => this.handleData(chunk));
    process.stdin.on('end', () => process.exit(0));
  }

  registerTool(tool) {
    this.tools.set(tool.name, tool);
  }

  send(message) {
    const payload = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
    const data = Buffer.from(header + payload, 'utf8');
    process.stdout.write(data);
  }

  sendResult(id, result) {
    this.send({ jsonrpc: '2.0', id, result });
  }

  sendError(id, code, message) {
    const sanitizedMessage = sanitizeErrorMessage(message);
    this.send({ jsonrpc: '2.0', id, error: { code, message: sanitizedMessage } });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  processBuffer() {
    while (true) {
      const separatorIndex = this.buffer.indexOf('\r\n\r\n');
      if (separatorIndex === -1) return;

      const header = this.buffer.slice(0, separatorIndex).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(separatorIndex + 4);
        continue;
      }

      const length = Number(match[1]);
      const totalLength = separatorIndex + 4 + length;
      if (this.buffer.length < totalLength) return;

      const body = this.buffer.slice(separatorIndex + 4, totalLength).toString('utf8');
      this.buffer = this.buffer.slice(totalLength);

      let parsedRequest;
      try {
        parsedRequest = JSON.parse(body);
      } catch (error) {
        this.send({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON' } });
        continue;
      }

      this.handleRequest(parsedRequest).catch((error) => {
        const sanitizedMessage = sanitizeErrorMessage(error.message || String(error));
        this.send({
          jsonrpc: '2.0',
          id: parsedRequest.id,
          error: { code: -32603, message: sanitizedMessage },
        });
      });
    }
  }

  async handleRequest(message) {
    if (message.method === 'initialize') {
      this.sendResult(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: this.name, version: this.version },
      });
      return;
    }

    if (message.method === 'notifications/initialized') {
      return;
    }

    if (message.method === 'tools/list') {
      const tools = Array.from(this.tools.values()).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      this.sendResult(message.id, { tools });
      return;
    }

    if (message.method === 'tools/call') {
      const toolName = message.params?.name;
      const args = message.params?.arguments || {};
      const tool = this.tools.get(toolName);

      if (!tool) {
        this.sendError(message.id, -32602, `Unknown tool: ${toolName}`);
        return;
      }

      try {
        const result = await tool.handler(args);
        this.sendResult(message.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        const sanitizedMessage = sanitizeErrorMessage(err.message || String(err));
        this.sendError(message.id, -32603, sanitizedMessage);
      }
      return;
    }

    if (typeof message.id !== 'undefined') {
      this.sendError(message.id, -32601, `Method not found: ${message.method}`);
    }
  }

  start() {
    // Server is ready to receive requests
  }
}

async function startStdioMode() {
  const container = getContainer();

  const server = new StdioMCPServer(SERVER_INFO.name, SERVER_INFO.version);
  
  // Register all tools
  const tools = createToolRegistry(container);
  for (const tool of tools) {
    server.registerTool(tool);
  }

  info(`${SERVER_INFO.name} v${SERVER_INFO.version} ready (stdio mode)`);
  info(`Capabilities: ${SERVER_INFO.capabilities.join(', ')}`);

  // 显示工作区根目录来源
  if (process.env.WORKSPACE_ROOT) {
    info(`Workspace root (from WORKSPACE_ROOT): ${process.env.WORKSPACE_ROOT}`);
  }

  if (process.env.DEBUG) {
    info('Debug mode enabled');
  }

  // Graceful shutdown
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    info(`Shutting down (signal: ${signal})...`);

    const timeout = new Promise((_) => setTimeout(() => {
      error('Shutdown timeout (5000ms), forcing exit');
      process.exit(1);
    }, 5000));

    await Promise.race([container.shutdown(), timeout]);
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.stdin.on('end', () => shutdown('stdin-close'));

  server.start();

  // Background initialization
  container.initialize(process.cwd()).then(success => {
    if (!success) error('Container initialization failed');
  });
}

// ============== HTTP Mode ==============

// Factory function to create a new server instance per request
function createMcpServer(container) {
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

  // Create SDK Server
  const server = new Server(
    { name: SERVER_INFO.name, version: SERVER_INFO.version },
    { capabilities: { tools: {} } }
  );

  // Get all tools
  const tools = createToolRegistry(container);
  const toolsMap = new Map();
  for (const tool of tools) {
    toolsMap.set(tool.name, tool);
  }

  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolsMap.get(name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) }],
        isError: true
      };
    }

    try {
      // Ensure container is ready before tool execution
      await container.ensureReady();
      
      const result = await tool.handler(args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (err) {
      const sanitizedMessage = sanitizeErrorMessage(err.message || String(err));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: sanitizedMessage }) }],
        isError: true
      };
    }
  });

  return server;
}

async function startHttpMode() {
  const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const express = require('express');

  const container = getContainer();
  const app = express();
  const port = process.env.PORT || 3000;

  // JSON body parsing
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      initialized: container.initialized,
      workspaceRoot: container.workspaceRoot,
    });
  });

  // MCP StreamableHTTP endpoint (POST only for stateless mode)
  app.post('/mcp', async (req, res) => {
    // Create a new server instance for each request
    const server = createMcpServer(container);
    
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
      });
      
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      
      // Cleanup when response closes
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (error) {
      error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  // GET and DELETE are not supported in stateless mode
  app.get('/mcp', async (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST for stateless mode.'
      },
      id: null
    });
  });

  app.delete('/mcp', async (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST for stateless mode.'
      },
      id: null
    });
  });

  // Graceful shutdown
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    info(`Shutting down (signal: ${signal})...`);

    const timeout = new Promise((_) => setTimeout(() => {
      error('Shutdown timeout (5000ms), forcing exit');
      process.exit(1);
    }, 5000));

    await Promise.race([container.shutdown(), timeout]);
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start HTTP server
  app.listen(port, '0.0.0.0', async () => {
    info(`${SERVER_INFO.name} v${SERVER_INFO.version} ready (HTTP mode)`);
    info(`Capabilities: ${SERVER_INFO.capabilities.join(', ')}`);
    info(`Listening on http://0.0.0.0:${port}/mcp`);
    info(`Health check: http://0.0.0.0:${port}/health`);

    // 显示工作区根目录来源
    if (process.env.WORKSPACE_ROOT) {
      info(`Workspace root (from WORKSPACE_ROOT): ${process.env.WORKSPACE_ROOT}`);
    }

    if (process.env.DEBUG) {
      info('Debug mode enabled');
    }

    // Background initialization
    container.initialize(process.cwd()).then(success => {
      if (!success) error('Container initialization failed');
    });
  });
}

// ============== Main ==============

async function main() {
  const mode = process.env.MCP_MODE || (process.env.PORT ? 'http' : 'stdio');

  if (mode === 'http') {
    await startHttpMode();
  } else {
    await startStdioMode();
  }
}

main().catch(err => {
  error('Failed to start server:', err);
  process.exit(1);
});
