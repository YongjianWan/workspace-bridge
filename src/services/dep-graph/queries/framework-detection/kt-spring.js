/**
 * Spring-Kotlin framework detection query — tree-sitter query for content-based detection.
 *
 * Matches: @RestController / @Controller / @RequestMapping / @GetMapping /
 *          @PostMapping / @PutMapping / @DeleteMapping / @PatchMapping /
 *          @FeignClient / @Scheduled / @Async / @EventListener /
 *          @KafkaListener / @RabbitListener / @JmsListener / @Retryable
 * Grammar: Kotlin (tree-sitter-kotlin).
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * any filtering must be done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
[
  (annotation
    (user_type
      (type_identifier) @name
    )
  )
  (annotation
    (constructor_invocation
      (user_type
        (type_identifier) @name
      )
    )
  )
]
`;

const VALID_ANNOTATIONS = new Set([
  'RestController',
  'Controller',
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
  'FeignClient',
  'Scheduled',
  'Async',
  'EventListener',
  'KafkaListener',
  'RabbitListener',
  'JmsListener',
  'Retryable',
]);

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const nameText = match.name?.text;
    if (nameText && VALID_ANNOTATIONS.has(nameText)) {
      return {
        framework: 'spring-kotlin',
        reason: 'spring-annotation',
        isEntry: true,
        entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'kotlin',
  framework: 'spring-kotlin',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
