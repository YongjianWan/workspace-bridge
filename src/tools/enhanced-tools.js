/**
 * Enhanced tools - Armed with real-time context
 */
const { SymbolIndex } = require('../services/symbol-index');
const { DiagnosticMonitor } = require('../services/diagnostic-monitor');
const { VSCodeBridge } = require('../services/vscode-bridge');
const { findWorkspaceRoot, detectWorkspace } = require('../utils/path');
const { runCommand, runCommandAsync } = require('../utils/command');
const path = require('path');

// Global service instances
const services = {
  symbolIndex: null,
  diagnosticMonitor: null,
  vscodeBridge: null,
};

function initServices(rootPath) {
  if (!services.symbolIndex) {
    services.symbolIndex = new SymbolIndex();
    services.symbolIndex.build(rootPath);
  }
  if (!services.diagnosticMonitor) {
    services.diagnosticMonitor = new DiagnosticMonitor();
    services.diagnosticMonitor.start(rootPath);
  }
  if (!services.vscodeBridge) {
    services.vscodeBridge = new VSCodeBridge();
    services.vscodeBridge.start();
  }
}

/**
 * Get current context - combines VS Code state + diagnostics
 */
function getCurrentContext(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  initServices(root);

  const vscodeState = services.vscodeBridge?.getCurrentState();
  const activeFile = services.vscodeBridge?.getActiveFile();
  const cursor = services.vscodeBridge?.getCursorPosition();
  const selection = services.vscodeBridge?.getSelectedText();
  const problems = services.diagnosticMonitor?.getAllDiagnostics() || [];
  
  // Filter problems to current file and surrounding lines
  const relevantProblems = activeFile 
    ? problems.filter(p => {
        if (p.file !== activeFile) return false;
        if (!cursor) return true;
        return Math.abs(p.line - cursor.line) <= 10; // Within 10 lines
      })
    : [];

  // Get symbols near cursor
  let nearbySymbols = [];
  if (activeFile && cursor && services.symbolIndex) {
    const fileSymbols = services.symbolIndex.getSymbolsInFile(activeFile);
    nearbySymbols = fileSymbols
      .filter(s => Math.abs(s.line - cursor.line) <= 20)
      .slice(0, 5);
  }

  return {
    ok: true,
    workspaceRoot: root,
    activeFile,
    cursorPosition: cursor,
    selectedText: selection ? selection.slice(0, 500) : null,
    openFiles: services.vscodeBridge?.getOpenFiles() || [],
    currentProblems: relevantProblems.slice(0, 10),
    totalProblems: problems.length,
    nearbySymbols,
    timestamp: Date.now(),
  };
}

/**
 * Find symbol definition with index (fast)
 */
function findSymbol(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  initServices(root);

  const name = args?.name;
  if (!name) {
    return { ok: false, error: 'name parameter is required' };
  }

  const locations = services.symbolIndex?.findSymbol(name) || [];
  
  // Fallback to grep if not in index
  if (locations.length === 0) {
    // Sanitize name to prevent shell injection
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeName) {
      return { ok: false, error: 'Invalid symbol name' };
    }
    const result = runCommand(`grep -r "(class|def|function)\\s+${safeName}\\b" --include="*.py" --include="*.js" --include="*.ts" -l`, root, 10000);
    return {
      ok: true,
      name,
      fromIndex: false,
      locations: result.stdout.split('\n').filter(Boolean).map(f => ({ file: f, line: 1 })),
    };
  }

  return {
    ok: true,
    name,
    fromIndex: true,
    locationCount: locations.length,
    locations: locations.slice(0, 20),
  };
}

/**
 * Smart code search - uses symbol index + text search
 */
function smartSearch(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  initServices(root);

  const query = args?.query;
  const type = args?.type || 'all'; // 'symbol', 'text', 'all'
  const maxResults = args?.maxResults || 20;

  if (!query) {
    return { ok: false, error: 'query parameter is required' };
  }

  const results = [];

  // Search symbol index first (fast)
  if (type === 'symbol' || type === 'all') {
    const symbols = services.symbolIndex?.searchSymbols(query, maxResults) || [];
    results.push(...symbols.map(s => ({
      type: 'symbol',
      name: s.name,
      symbolType: s.type,
      file: s.file,
      line: s.line,
      signature: s.signature,
    })));
  }

  // If not enough results, do text search
  if ((type === 'text' || type === 'all') && results.length < maxResults) {
    const remaining = maxResults - results.length;
    const searchTools = require('./search-tools');
    const textResults = searchTools.searchCode({ 
      cwd: target, 
      query, 
      type: 'text',
      maxResults: remaining 
    });
    if (textResults.ok) {
      results.push(...textResults.results.map(r => ({
        type: 'text',
        file: r.file,
        line: r.line,
        content: r.content,
      })));
    }
  }

  return {
    ok: true,
    query,
    resultCount: results.length,
    results,
  };
}

/**
 * Get quick fixes for current problems
 */
async function getQuickFixes(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  initServices(root);

  const file = args?.file || services.vscodeBridge?.getActiveFile();
  const line = args?.line;

  if (!file) {
    return { ok: false, error: 'No active file' };
  }

  const problems = services.diagnosticMonitor?.getErrorsForFile(file) || [];
  const relevantProblems = line 
    ? problems.filter(p => p.line === line || Math.abs(p.line - line) <= 2)
    : problems;

  // Generate fix suggestions based on error type
  const fixes = relevantProblems.map(p => {
    let suggestion = null;
    
    if (p.message.includes('undefined name')) {
      suggestion = 'Import missing module or define the variable';
    } else if (p.message.includes('indent')) {
      suggestion = 'Fix indentation';
    } else if (p.message.includes('unused import')) {
      suggestion = 'Remove unused import';
    } else if (p.code) {
      suggestion = `Run auto-fix for ${p.code}`;
    }

    return {
      problem: p,
      suggestion,
      autoFixable: Boolean(p.code),
    };
  });

  return {
    ok: true,
    file,
    problemCount: fixes.length,
    fixes,
  };
}

/**
 * Generate code at cursor position
 */
function generateAtCursor(args) {
  const context = getCurrentContext(args);
  
  if (!context.activeFile) {
    return { ok: false, error: 'No active file' };
  }

  const task = args?.task;
  if (!task) {
    return { ok: false, error: 'task parameter is required' };
  }

  // Get surrounding context
  const nearbySymbols = context.nearbySymbols;
  const selectedText = context.selectedText;
  
  return {
    ok: true,
    context: {
      file: context.activeFile,
      cursor: context.cursorPosition,
      hasSelection: Boolean(selectedText),
      selectedLength: selectedText?.length,
      surroundingSymbols: nearbySymbols.map(s => ({
        name: s.name,
        type: s.type,
        line: s.line,
      })),
    },
    task,
    suggestion: `Based on context at ${context.activeFile}:${context.cursorPosition?.line}, you want to: ${task}`,
    // The actual generation would be done by the AI, we just provide context
  };
}

module.exports = {
  getCurrentContext,
  findSymbol,
  smartSearch,
  getQuickFixes,
  generateAtCursor,
};
