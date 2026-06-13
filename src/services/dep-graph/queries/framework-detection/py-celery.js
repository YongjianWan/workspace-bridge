/**
 * Celery framework detection query — tree-sitter query for content-based detection.
 *
 * Matches:
 *   - @shared_task (bare or call form)
 *   - @<app>.task(...) / @<celery>.task(...) (attribute name must be "task")
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * all filtering is done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
; @shared_task (bare decorator)
(decorator
  (identifier) @bare_task
)

; @shared_task(...) (call decorator with identifier)
(decorator
  (call
    function: (identifier) @call_task
  )
)

; @app.task / @app.task(...) (attribute decorator)
(decorator
  [
    (attribute
      object: (identifier) @attr_obj
      attribute: (identifier) @attr_task
    )
    (call
      function: (attribute
        object: (identifier) @attr_obj
        attribute: (identifier) @attr_task
      )
    )
  ]
)
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    // @shared_task (bare)
    if (match.bare_task?.text === 'shared_task') {
      return makeHint();
    }

    // @shared_task(...) (call)
    if (match.call_task?.text === 'shared_task') {
      return makeHint();
    }

    // @app.task / @app.task(...)
    if (match.attr_task?.text === 'task') {
      return makeHint();
    }
  }

  return null;
}

function makeHint() {
  return {
    framework: 'celery',
    reason: 'celery-task',
    isEntry: true,
    entryPointWeight: ENTRY_WEIGHT.MEDIUM,
  };
}

module.exports = {
  language: 'python',
  framework: 'celery',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
