/**
 * Tool registry - defines all available tools and their schemas
 */
const gitTools = require('./tools/git-tools');
const workspaceTools = require('./tools/workspace-tools');
const searchTools = require('./tools/search-tools');
const healthTools = require('./tools/health-tools');

const toolDefinitions = [
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
    handler: workspaceTools.workspaceInfo,
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
    handler: workspaceTools.runDiagnostics,
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
    handler: gitTools.gitDiffSummary,
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
    handler: gitTools.gitBlame,
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
    handler: gitTools.gitHistory,
  },
  {
    name: 'git_branch_info',
    description: 'List all branches with upstream tracking status and working-tree summary.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
    },
    handler: gitTools.gitBranchInfo,
  },
  {
    name: 'git_stash',
    description: 'List stashes or show the diff for a specific stash.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        action: { type: 'string', enum: ['list', 'show'], description: 'list: enumerate stashes; show: patch for a stash (default index 0).' },
        index: { type: 'number', description: 'Stash index for action=show (default 0).' },
      },
    },
    handler: gitTools.gitStash,
  },
  {
    name: 'git_log_graph',
    description: 'Show a visual ASCII git log graph with branch topology.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        limit: { type: 'number', description: 'Max commits to show (default 30, max 100).' },
        allBranches: { type: 'boolean', description: 'Include all branches (default false).' },
      },
    },
    handler: gitTools.gitLogGraph,
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
    handler: searchTools.searchCode,
  },

  // ========== Health & Maintenance Tools ==========
  {
    name: 'project_health',
    description: 'Check project health: README, LICENSE, .gitignore, CI/CD config, test framework, coverage.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
    },
    handler: healthTools.projectHealth,
  },
  {
    name: 'run_auto_fix',
    description: 'Auto-fix code issues using ESLint --fix, Prettier --write, Black, and/or ruff --fix. Use dryRun:true to preview changes without writing files.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        fixers: {
          type: 'array',
          items: { type: 'string', enum: ['eslint', 'prettier', 'black', 'ruff'] },
          description: 'Which fixers to run. Omit to run all available ones.',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, preview what would change without writing any files (default false).',
        },
      },
    },
    handler: healthTools.runAutoFix,
  },
  {
    name: 'check_security',
    description: 'Run security vulnerability scans: npm audit for Node projects, pip-audit/safety for Python.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
    },
    handler: healthTools.checkSecurity,
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
    handler: healthTools.checkDependencies,
  },

  // ========== Enhanced Tools (Armed) ==========
  {
    name: 'get_current_context',
    description: 'Get real-time context: active file, cursor position, problems at cursor, nearby symbols. Combines VS Code state + diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Optional workspace path.' },
      },
    },
    handler: enhancedTools.getCurrentContext,
  },
  {
    name: 'find_symbol',
    description: 'Fast symbol lookup using indexed database. Finds class/function definitions instantly.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        cwd: { type: 'string' },
        name: { type: 'string', description: 'Symbol name to find (class, function, method).' },
      },
    },
    handler: enhancedTools.findSymbol,
  },
  {
    name: 'smart_search',
    description: 'Intelligent code search: uses symbol index first (fast), falls back to text search. Returns ranked results.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        cwd: { type: 'string' },
        query: { type: 'string', description: 'Search query.' },
        type: { type: 'string', enum: ['symbol', 'text', 'all'], default: 'all', description: 'Search type.' },
        maxResults: { type: 'number', default: 20, description: 'Max results to return.' },
      },
    },
    handler: enhancedTools.smartSearch,
  },
  {
    name: 'get_quick_fixes',
    description: 'Get actionable quick fixes for problems in current file or at specific line.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        file: { type: 'string', description: 'File path (defaults to active file).' },
        line: { type: 'number', description: 'Specific line number (optional).' },
      },
    },
    handler: enhancedTools.getQuickFixes,
  },
  {
    name: 'generate_at_cursor',
    description: 'Get context-aware code generation suggestions at cursor position. Provides surrounding symbols and selection info.',
    inputSchema: {
      type: 'object',
      required: ['task'],
      properties: {
        cwd: { type: 'string' },
        task: { type: 'string', description: 'What you want to generate (e.g., "implement this method", "add error handling").' },
      },
    },
    handler: enhancedTools.generateAtCursor,
  },

  // ========== Armed: Context-Aware Tools ==========
  {
    name: 'get_cursor_context',
    description: 'Get comprehensive context at cursor position: surrounding symbols, git history, and file info.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        file: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number (1-based)' },
        column: { type: 'number', description: 'Column number' },
      },
    },
    handler: contextTools.getCursorContext,
  },
  {
    name: 'get_workspace_summary',
    description: 'Get high-level workspace overview: stats, recent files, git status.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
    },
    handler: contextTools.getWorkspaceSummary,
  },
  {
    name: 'lookup_symbol',
    description: 'Fast symbol lookup using indexed cache. Finds definitions instantly.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        cwd: { type: 'string' },
        name: { type: 'string', description: 'Symbol name to lookup' },
        includeContent: { type: 'boolean', description: 'Include surrounding code lines' },
      },
    },
    handler: contextTools.lookupSymbol,
  },
  {
    name: 'find_related',
    description: 'Find code related to a symbol or file (same-file symbols, references).',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        target: { type: 'string', description: 'Symbol name' },
        file: { type: 'string', description: 'File path' },
      },
    },
    handler: contextTools.findRelated,
  },
  {
    name: 'suggest_actions',
    description: 'Get AI-powered suggestions for next actions based on current context.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        file: { type: 'string', description: 'Current file' },
        line: { type: 'number', description: 'Current line' },
      },
    },
    handler: contextTools.suggestActions,
  },

  // ========== Armed: Generation Tools ==========
  {
    name: 'generate_code',
    description: 'Generate code based on task description and context. Provides structured prompts.',
    inputSchema: {
      type: 'object',
      required: ['task'],
      properties: {
        cwd: { type: 'string' },
        task: { type: 'string', description: 'What to generate (e.g., "implement user authentication")' },
        context: { type: 'string', description: 'Additional context' },
        location: { 
          type: 'object', 
          description: 'Where to insert',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            insert: { type: 'string', enum: ['before', 'after', 'replace'] },
          },
        },
      },
    },
    handler: generationTools.generateCode,
  },
  {
    name: 'refactor_code',
    description: 'Analyze and suggest refactoring for selected code.',
    inputSchema: {
      type: 'object',
      required: ['file', 'selection', 'operation'],
      properties: {
        cwd: { type: 'string' },
        file: { type: 'string', description: 'File path' },
        selection: { 
          type: 'object',
          description: 'Code selection',
          properties: {
            startLine: { type: 'number' },
            endLine: { type: 'number' },
          },
        },
        operation: { 
          type: 'string', 
          enum: ['extract_function', 'rename', 'inline'],
          description: 'Refactoring operation' 
        },
      },
    },
    handler: generationTools.refactorCode,
  },
  {
    name: 'add_documentation',
    description: 'Generate documentation template for a function or class.',
    inputSchema: {
      type: 'object',
      required: ['file', 'target'],
      properties: {
        cwd: { type: 'string' },
        file: { type: 'string', description: 'File path' },
        target: { type: 'string', description: 'Symbol name or line number' },
      },
    },
    handler: generationTools.addDocumentation,
  },
  {
    name: 'generate_test',
    description: 'Generate test cases for a function or class.',
    inputSchema: {
      type: 'object',
      required: ['file', 'target'],
      properties: {
        cwd: { type: 'string' },
        file: { type: 'string', description: 'File path' },
        target: { type: 'string', description: 'Symbol name to test' },
      },
    },
    handler: generationTools.generateTest,
  },
];

function registerAllTools(server) {
  for (const tool of toolDefinitions) {
    server.registerTool(tool);
  }
}

module.exports = {
  toolDefinitions,
  registerAllTools,
};
