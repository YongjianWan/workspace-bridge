/**
 * MCP Server - Protocol handling
 * Secure version: error message sanitization
 */

/**
 * Sanitize error message to remove sensitive information
 * - Removes absolute paths (Windows: C:\... Unix: /home/...)
 * - Keeps relative paths and general error info
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
    // Keep relative paths (starting with ./ or ../)
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

class MCPServer {
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
    // Use Buffer to ensure correct UTF-8 encoding for multi-byte characters
    const data = Buffer.from(header + payload, 'utf8');
    process.stdout.write(data);
  }

  sendResult(id, result) {
    this.send({ jsonrpc: '2.0', id, result });
  }

  sendError(id, code, message) {
    // Sanitize error message before sending to client
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
      } catch (error) {
        const sanitizedMessage = sanitizeErrorMessage(error.message || String(error));
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

module.exports = { MCPServer };
