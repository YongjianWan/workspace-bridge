/**
 * Spring framework detection query — tree-sitter query for content-based detection.
 *
 * Matches: @RestController, @Controller, @RequestMapping, @GetMapping, @PostMapping,
 *          @PutMapping, @DeleteMapping, @PatchMapping, @FeignClient, @Scheduled,
 *          @Async, @EventListener, @KafkaListener, @RabbitListener, @JmsListener,
 *          @Retryable, @Component, @Service, @Repository, @Bean
 * Grammar: Java (tree-sitter-java).
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * any filtering must be done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
[
  (marker_annotation
    name: (identifier) @annotation
  )
  (annotation
    name: (identifier) @annotation
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
  'Component',
  'Service',
  'Repository',
  'Bean',
]);

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const name = match.annotation?.text;
    if (VALID_ANNOTATIONS.has(name)) {
      return {
        framework: 'spring',
        reason: 'spring-annotation',
        isEntry: true,
        entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'java',
  framework: 'spring',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
