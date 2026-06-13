/**
 * Ktor framework detection query — tree-sitter query for Kotlin content-based detection.
 *
 * Matches:
 *   - `routing { ... }` blocks
 *   - `embeddedServer(...)` calls
 *   - `fun Application.module()` extension functions
 *   - HTTP verb calls inside routing: `get("/path")`, `post("/path")`, etc.
 *
 * Grammar: Kotlin (tree-sitter-kotlin).
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * all filtering is done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
; Broad capture of call expressions whose callee is a bare identifier.
; postProcess narrows this to routing / embeddedServer / HTTP verbs.
(call_expression
  . (simple_identifier) @call_name
)

; Broad capture of function declarations.
; postProcess checks for 'fun Application.module()' shape.
(function_declaration
  (simple_identifier) @func_name
)
`;

const ROUTE_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function isInsideRouting(node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'call_expression') {
      const callee = current.children.find((c) => c.type === 'simple_identifier');
      if (callee && callee.text === 'routing') {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function hasReceiverTypeApplication(funcNode) {
  const receiverType = funcNode.children.find((c) => c.type === 'user_type');
  return receiverType && receiverType.text === 'Application';
}

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const callName = match.call_name?.text;
    if (callName) {
      if (callName === 'routing' || callName === 'embeddedServer') {
        return {
          framework: 'ktor',
          reason: 'ktor-routing',
          isEntry: true,
          entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
        };
      }

      if (ROUTE_VERBS.has(callName)) {
        const callNode = match.call_name.node.parent;
        if (callNode && isInsideRouting(callNode)) {
          return {
            framework: 'ktor',
            reason: 'ktor-routing',
            isEntry: true,
            entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
          };
        }
      }
    }

    const funcName = match.func_name?.text;
    if (funcName === 'module') {
      const funcNode = match.func_name.node.parent;
      if (funcNode && funcNode.type === 'function_declaration' && hasReceiverTypeApplication(funcNode)) {
        return {
          framework: 'ktor',
          reason: 'ktor-routing',
          isEntry: true,
          entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
        };
      }
    }
  }

  return null;
}

module.exports = {
  language: 'kotlin',
  framework: 'ktor',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
