/**
 * Django framework detection query — tree-sitter query for content-based detection.
 *
 * Matches:
 *   - Django Commands: class Command(BaseCommand)
 *   - Django Admin: admin.site.register(...)
 *   - Django Signals: @receiver(...) decorator or .connect(...) calls
 *   - Django REST Framework: @api_view(...) or subclasses of
 *     APIView / ModelViewSet / ViewSet / GenericAPIView
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * all filtering is done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
; class Command(BaseCommand) and DRF class-based views
(class_definition
  name: (identifier) @class_name
  superclasses: (argument_list) @class_bases
)

; admin.site.register(...)
(call
  function: (attribute
    object: (attribute
      object: (identifier) @admin_root
      attribute: (identifier) @admin_mid
    )
    attribute: (identifier) @admin_method
  )
)

; any .connect(...) call (Django signal registration style)
(call
  function: (attribute
    object: (_) @connect_obj
    attribute: (identifier) @connect_method
  )
)

; bare decorators: @receiver
(decorator
  (identifier) @bare_decorator
)

; call decorators with identifier function: @api_view(...), @receiver(...)
(decorator
  (call
    function: (identifier) @call_decorator_name
  )
)
`;

const DRF_VIEW_BASES = new Set(['APIView', 'ModelViewSet', 'ViewSet', 'GenericAPIView']);

const REASON_PRIORITY = {
  'django-command': 1,
  'django-rest-framework': 2,
  'django-admin': 3,
  'django-signal': 4,
};

function extractBaseNames(basesText) {
  if (!basesText) return [];
  // argument_list text includes parentheses, e.g. "(BaseCommand)" or "(APIView, Mixin)"
  const inner = basesText.replace(/^\(|\)$/g, '');
  return inner
    .split(',')
    .map(s => {
      const trimmed = s.trim();
      const parts = trimmed.split('.');
      return parts[parts.length - 1];
    })
    .filter(Boolean);
}

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  const candidates = [];

  for (const match of matches) {
    // Django Command / DRF class inheritance
    const className = match.class_name?.text;
    if (className && match.class_bases) {
      const baseNames = extractBaseNames(match.class_bases.text);

      if (className === 'Command' && baseNames.includes('BaseCommand')) {
        candidates.push({ reason: 'django-command' });
      }

      if (baseNames.some(b => DRF_VIEW_BASES.has(b))) {
        candidates.push({ reason: 'django-rest-framework' });
      }
    }

    // admin.site.register(...)
    if (
      match.admin_root?.text === 'admin' &&
      match.admin_mid?.text === 'site' &&
      match.admin_method?.text === 'register'
    ) {
      candidates.push({ reason: 'django-admin' });
    }

    // .connect(...)
    if (match.connect_method?.text === 'connect') {
      candidates.push({ reason: 'django-signal' });
    }

    // @receiver
    if (match.bare_decorator?.text === 'receiver') {
      candidates.push({ reason: 'django-signal' });
    }

    // @api_view(...) / @receiver(...)
    const callName = match.call_decorator_name?.text;
    if (callName === 'api_view') {
      candidates.push({ reason: 'django-rest-framework' });
    } else if (callName === 'receiver') {
      candidates.push({ reason: 'django-signal' });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason]);

  return {
    framework: 'django',
    reason: candidates[0].reason,
    isEntry: true,
    entryPointWeight: ENTRY_WEIGHT.MEDIUM,
  };
}

module.exports = {
  language: 'python',
  framework: 'django',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
