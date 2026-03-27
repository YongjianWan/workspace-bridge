#!/usr/bin/env node
/**
 * workspace-bridge MCP Server v0.4.0 - Armed Edition
 * 
 * Transforms MCP from "passive tool" to "proactive coding assistant"
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
 */

const { MCPServer } = require('./src/mcp-server');
const { getContainer } = require('./src/services/container');
const { registerAllTools } = require('./src/tool-registry');

// Handle unhandled rejections to prevent crash
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
  process.exit(1);
});

const SERVER_INFO = {
  name: 'workspace-bridge',
  version: '0.5.0',
  capabilities: ['workspace-introspection', 'git-tools', 'code-search', 'diagnostics', 'symbol-index'],
};

async function main() {
  const container = getContainer();
  
  // Initialize container (async, with gate)
  const initSuccess = await container.initialize(process.cwd());
  if (!initSuccess) {
    console.error('[Server] Failed to initialize container, continuing with limited functionality');
  }

  const server = new MCPServer(SERVER_INFO.name, SERVER_INFO.version);
  
  // Register all tools with container injection
  registerAllTools(server, container);
  
  console.error(`[Server] ${SERVER_INFO.name} v${SERVER_INFO.version} ready`);
  console.error(`[Server] Capabilities: ${SERVER_INFO.capabilities.join(', ')}`);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.error('[Server] Shutting down...');
    await container.shutdown();
    process.exit(0);
  });
  
  server.start();
}

main();
