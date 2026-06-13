/**
 * Spring Boot framework detection query — tree-sitter query for content-based detection.
 *
 * Matches: @SpringBootApplication, @Configuration, @ControllerAdvice,
 *          @EnableAutoConfiguration, @Aspect
 * Grammar: Java (tree-sitter-java).
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * any filtering must be done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
(marker_annotation
  name: (identifier) @name
)
(annotation
  name: (identifier) @name
)
`;

const VALID_ANNOTATIONS = new Set([
  'SpringBootApplication',
  'Configuration',
  'ControllerAdvice',
  'EnableAutoConfiguration',
  'Aspect',
]);

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const nameText = match.name?.text;
    if (nameText && VALID_ANNOTATIONS.has(nameText)) {
      return {
        framework: 'spring-boot',
        reason: 'spring-boot-annotation',
        isEntry: true,
        entryPointWeight: ENTRY_WEIGHT.HIGH,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'java',
  framework: 'spring-boot',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
