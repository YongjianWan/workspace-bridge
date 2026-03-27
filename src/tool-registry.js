/**
 * Tool registry - defines all available tools
 * Now with ServiceContainer injection
 */
const gitTools = require('./tools/git-tools');
const workspaceTools = require('./tools/workspace-tools');
const searchTools = require('./tools/search-tools');
const healthTools = require('./tools/health-tools');
const enhancedTools = require('./tools/enhanced-tools');

// Tool factory - creates tool handlers with container access
function createToolRegistry(container) {
  return [
    // ========== Core Workspace Tools ==========
    {
      name: 'workspace_info',
      description: 'Detect the current workspace root and list available diagnostic checks.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Optional path inside the workspace.' },
        },
      },
      handler: (args) => workspaceTools.workspaceInfo(args, container),
    },
    {
      name: 'run_diagnostics',
      description: 'Run project diagnostics for the current workspace. Supports Node and Python projects.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Optional path inside the workspace.' },
          mode: { type: 'string', enum: ['quick', 'full'], description: 'Quick runs lint/type checks; full also runs build/test when available.' },
          timeoutMs: { type: 'number', description: 'Timeout per command in milliseconds.' },
          maxDiagnostics: { type: 'number', description: 'Maximum structured diagnostics returned in diagnostics array.' },
        },
      },
      handler: (args) => workspaceTools.runDiagnostics(args, container),
    },

    // ========== Git Tools ==========
    {
      name: 'git_diff_summary',
      description: 'Return a compact summary and trimmed patch for the current git workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Optional path inside the workspace.' },
          staged: { type: 'boolean', description: 'Whether to inspect staged changes instead of unstaged changes.' },
        },
      },
      handler: (args) => gitTools.gitDiffSummary(args, container),
    },
    {
      name: 'git_blame',
      description: 'Show git blame annotations for a file, optionally limited to a line range.',
      inputSchema: {
        type: 'object',
        required: ['file'],
        properties: {
          cwd: { type: 'string', description: 'Optional path inside the workspace.' },
          file: { type: 'string', description: 'File path (absolute or relative to workspace root).' },
          startLine: { type: 'number', description: 'Start line number (1-based).' },
          endLine: { type: 'number', description: 'End line number (inclusive). Requires startLine.' },
        },
      },
      handler: (args) => gitTools.gitBlame(args, container),
    },
    {
      name: 'git_history',
      description: 'Show git commit history, optionally filtered by file, author, or date range.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          file: { type: 'string', description: 'Limit history to this file.' },
          limit: { type: 'number', description: 'Max commits to return (default 30, max 200).' },
          author: { type: 'string', description: 'Filter by author name or email.' },
          since: { type: 'string', description: 'Since date, e.g. "2 weeks ago" or "2024-01-01".' },
          until: { type: 'string', description: 'Until date.' },
        },
      },
      handler: (args) => gitTools.gitHistory(args, container),
    },

    // ========== Search Tools ==========
    {
      name: 'search_code',
      description: 'Search for text, symbol definitions, references, or filenames inside the workspace.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          cwd: { type: 'string' },
          query: { type: 'string', description: 'Search query string.' },
          type: {
            type: 'string',
            enum: ['text', 'symbol', 'reference', 'file'],
            description: 'text/reference: all occurrences; symbol: function/class definitions only; file: match filenames.',
          },
          glob: { type: 'string', description: 'Glob pattern to filter files, e.g. "*.ts" or "*.py".' },
          maxResults: { type: 'number', description: 'Maximum results to return (default 50, max 200).' },
        },
      },
      handler: (args) => searchTools.searchCode(args, container),
    },
    {
      name: 'lookup_symbol',
      description: 'Fast symbol lookup using indexed cache. Finds class/function definitions instantly.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          cwd: { type: 'string' },
          name: { type: 'string', description: 'Symbol name to lookup' },
          includeContent: { type: 'boolean', description: 'Include surrounding code lines' },
        },
      },
      handler: async (args) => {
        await container.ensureReady();
        const name = args?.name;
        if (!name) return { ok: false, error: 'name is required' };
        
        const locations = container.fileIndex.findSymbol(name);
        if (locations.length === 0) {
          // Fallback to search
          const searchResults = container.fileIndex.searchSymbols(name, 10);
          return {
            ok: true,
            name,
            found: false,
            suggestions: searchResults.slice(0, 5).map(s => s.name),
          };
        }
        
        return {
          ok: true,
          name,
          found: true,
          locationCount: locations.length,
          locations,
        };
      },
    },

    // ========== Health Tools ==========
    {
      name: 'project_health',
      description: 'Check project health: README, LICENSE, .gitignore, CI/CD config, test framework, coverage.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
        },
      },
      handler: (args) => healthTools.projectHealth(args, container),
    },
    {
      name: 'check_dependencies',
      description: 'List outdated dependencies via npm outdated and pip list --outdated.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
        },
      },
      handler: (args) => healthTools.checkDependencies(args, container),
    },
    {
      name: 'diagnostics_live',
      description: 'Get cached diagnostics for a file without re-running lint. Fast real-time results.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          file: { type: 'string', description: 'File path (defaults to active file from editor state)' },
        },
      },
      handler: async (args) => {
        await container.ensureReady();
        
        let filePath = args?.file;
        if (!filePath && container.editorState) {
          filePath = await container.editorState.getActiveFile();
        }
        
        if (!filePath) {
          return { ok: false, error: 'No file specified and no active editor found' };
        }

        // Get from cache first
        const cached = container.diagnostics?.getCached(filePath);
        if (cached && cached.length > 0) {
          return {
            ok: true,
            file: filePath,
            source: 'cache',
            diagnosticCount: cached.length,
            diagnostics: cached,
          };
        }

        // Trigger a check if not cached
        if (container.diagnostics) {
          const diags = await container.diagnostics.checkFile(filePath);
          return {
            ok: true,
            file: filePath,
            source: 'fresh',
            diagnosticCount: diags.length,
            diagnostics: diags,
          };
        }

        return { ok: true, file: filePath, diagnostics: [] };
      },
    },
  ];
}

function registerAllTools(server, container) {
  const tools = createToolRegistry(container);
  for (const tool of tools) {
    server.registerTool(tool);
  }
}

module.exports = {
  createToolRegistry,
  registerAllTools,
};
