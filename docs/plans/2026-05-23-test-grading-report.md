# Unit Tests Grading Report Plan

**Goal:** Produce a full grading report for unit tests, classifying by signal strength and usefulness, with actionable recommendations.
**Architecture:** Use automated scanning to classify tests by assertion strength (schema-only vs semantic). Then deep-review low-signal candidates for line-referenced evidence. Compile report with counts and priorities.
**Tech:** Node.js test files, repo grep/read tools, optional subagent for broad scan.

### Task 1: Inventory and baseline classification

**Files:**
- Read: test/**/*.js
- Tools: file search + pattern grep

- [x] Step 1: Enumerate all test files.
- [x] Step 2: Classify by heuristics (schema/shape-only vs semantic vs integration-contract).
- [x] Step 3: Tag each file with a grade (A/B/C/D) and confidence.

### Task 2: Evidence for low-signal tests

**Files:**
- Read: lowest-signal test files (top 10-15 candidates)

- [x] Step 1: Inspect assertions for weak checks (existence/type only).
- [x] Step 2: Capture line-referenced evidence for each candidate.

### Task 3: Produce report

**Files:**
- Output in chat with linked file references

- [x] Step 1: Summarize counts per grade/category.
- [x] Step 2: List full file-level grading (all tests).
- [x] Step 3: Highlight low-signal tests with evidence and improvement ideas.

---

## Report Summary

**Scope**
- Coverage: all files under `test/*.js` in this repo.
- Unit vs integration: grading is based on assertion signal strength, not test type.

**Method**
- Automated scan: flag tests dominated by type/existence checks.
- Manual review: sample low-signal candidates with line-level evidence.
- Grading is heuristic and intended to guide cleanup, not to mandate deletion.

**Root cause (why low-signal tests exist)**
- Contract-first bias: many tests were written to lock output shape for CLI/AI consumers, not to validate semantics.
- Regression scars: after specific bugs, small guard tests were added that only assert existence/type and never upgraded.
- Mixed test taxonomy: unit, integration, and contract tests live together under `test/`, so “unit” expectations leak into contract tests.
- Fast test pressure: to keep `test:fast` quick, tests avoid heavy setup and default to shape checks.
- Lack of negative cases: most tests do not assert failure or exclusion behavior, so false positives slip through.

**Sharper root cause (decision + tradeoff)**
- Decision owner: project owner (you) prioritized CLI/AI output stability and speed over semantic depth in early iterations.
- Phase tradeoff: Wave 1/2 focused on shipping usable CLI outputs quickly; tests were written as “schema locks” to avoid breaking userspace.
- Enforcement gap: no explicit policy to upgrade guard tests into semantic tests once bugs were fixed, so thin tests accumulated.
- Scope compression: single test folder + no unit/integration split made it easy to label contract checks as “unit tests,” inflating the low-signal bucket.
- Tooling shortcut: fast-path coverage goals favored cheap type checks over expensive fixture-driven assertions.

**Grading rubric**
- A: Semantic/algorithmic regression-sensitive assertions.
- B: Contract/integration guards with meaningful checks.
- C: Mostly shape/existence/type checks.
- D: Helper/runner scripts with no assertions.

**Counts**
- A: 31
- B: 105
- C: 0
- D: 2

## Low-signal candidates (evidence)

1) audit-file-validation-advice-test.js
- Evidence: presence/type-only checks for validationAdvice fields.
- See [test/audit-file-validation-advice-test.js](test/audit-file-validation-advice-test.js#L9-L14)
 - Upgrade idea: assert `suggestedCommand` matches expected tool and commands are non-empty.

2) cli-pipeline-depth-test.js
- Evidence: surface output checks are mostly type/existence.
- See [test/cli-pipeline-depth-test.js](test/cli-pipeline-depth-test.js#L31-L39)
 - Upgrade idea: constrain `severity` to known values and validate `topRisks` item shape.

3) cli-pipeline-depth-test.js
- Evidence: audit-file JSON fidelity checks only shape/exists.
- See [test/cli-pipeline-depth-test.js](test/cli-pipeline-depth-test.js#L106-L114)
 - Upgrade idea: assert `impactCount` matches `impactedFiles.length` or expected bounds.

4) parser-schema-contract-test.js
- Evidence: schema/type-only checks for parser outputs.
- See [test/parser-schema-contract-test.js](test/parser-schema-contract-test.js#L18-L55)
 - Upgrade idea: add value-domain checks for `kind`, `source`, and `parseMode`.

5) container-workspace-info-test.js
- Evidence: only non-null and root equality checks.
- See [test/container-workspace-info-test.js](test/container-workspace-info-test.js#L22-L25)
 - Upgrade idea: assert other required fields (project name, stack info) are present.

6) git-tools-test.js
- Evidence: historyRisk score/level only type-checked.
- See [test/git-tools-test.js](test/git-tools-test.js#L42-L50)
 - Upgrade idea: constrain `level` to known set and validate commit record shape.

7) e2e-gitnexus-test.js
- Evidence: existence checks for schema/arrays without cross-field consistency.
- See [test/e2e-gitnexus-test.js](test/e2e-gitnexus-test.js#L18-L27)
 - Upgrade idea: cross-check `summary.counts.*` against array lengths.

**How to use this list**
- **测试升级规则**: 低信号测试只保留 1 个版本，下一轮必须补语义断言或合并掉，防止再堆积。
- C tests: cheapest to upgrade (add 1-2 assertions each).
- B tests: keep as contract guards unless flaky or redundant.
- A tests: protect core algorithms; avoid deleting.

## Full file-level grading

### A
- analysis-test.js
- audit-assembler-test.js
- audit-diff-test.js
- audit-map-test.js
- cache-consistency-test.js
- cache-test.js
- cli-exit-code-test.js
- cli-integration-test.js
- cochange-test.js
- container-lifecycle-test.js
- cpp-parser-test.js
- dead-export-confidence-test.js
- dep-graph-error-test.js
- dep-graph-incremental-test.js
- file-index-boundary-test.js
- file-index-race-test.js
- function-impact-test.js
- go-ast-parser-test.js
- graph-db-test.js
- health-tools-test.js
- honesty-engine-test.js
- integration-core-test.js
- java-parsers-test.js
- java-resolver-test.js
- pagerank-test.js
- pagerank-warmstart-integration-test.js
- parser-shared-polyglot-test.js
- phase01-quality-test.js
- recommendation-engine-test.js
- resolvers-test.js
- functionality-test.js

### B
- affected-tests-barrel-python-test.js
- affected-tests-heuristic-test.js
- affected-tests-mention-test.js
- analysis-coverage-test.js
- arrow-function-test.js
- audit-diff-compact-test.js
- audit-diff-incremental-test.js
- audit-file-validation-advice-test.js
- audit-file-watch-test.js
- cache-backup-test.js
- cache-concurrency-test.js
- cache-corruption-test.js
- cache-stale-prune-test.js
- change-type-test.js
- cli-args-validation-test.js
- cli-error-handling-test.js
- cli-exclude-backslash-test.js
- cli-fallback-test.js
- cli-mapper-adapter-test.js
- cli-pipeline-depth-test.js
- container-workspace-info-test.js
- dep-tools-test.js
- diagnostics-cache-test.js
- diagnostics-engine-test.js
- diagnostics-parser-test.js
- diagnostics-unbounded-timer-test.js
- e2e-gitnexus-test.js
- file-index-exclude-test.js
- file-index-rename-test.js
- file-summary-test.js
- formatter-direct-test.js
- formatter-e2e-test.js
- framework-patterns-test.js
- function-similarity-test.js
- git-line-ranges-test.js
- git-tools-test.js
- go-module-path-test.js
- gors-resolver-test.js
- gors-stack-detection-test.js
- gradle-task-discovery-test.js
- implicit-imports-test.js
- impact-explanations-test.js
- incremental-diff-test.js
- init-test.js
- java-dead-export-test.js
- java-gradle-checkstyle-test.js
- java-package-imports-test.js
- js-ast-dynamic-import-test.js
- js-ast-new-url-test.js
- js-regex-cjs-test.js
- kotlin-ast-parser-test.js
- language-support-matrix-test.js
- maven-module-detection-test.js
- orphan-detector-test.js
- overview-tools-concurrency-test.js
- overview-tools-test.js
- p0t5-internal-function-impact-test.js
- p1-usage-scan-test.js
- p3-impact-explanation-test.js
- p77-unresolved-imports-test.js
- parse-args-test.js
- parser-registry-test.js
- parser-schema-contract-test.js
- path-format-consistency-test.js
- path-utils-test.js
- precompute-aggregate-test.js
- precompute-hotspot-test.js
- precomputed-roundtrip-test.js
- project-map-test.js
- regression-test.js
- regression-tools-test.js
- render-command-string-test.js
- repl-edge-test.js
- repl-shutdown-test.js
- repl-test.js
- resolver-strategy-chain-test.js
- resolver-symbol-table-test.js
- risk-thresholds-test.js
- role-detection-test.js
- rust-ast-parser-test.js
- rust-module-filter-test.js
- rust-workspace-test.js
- scaffold-detector-test.js
- security-adapter-test.js
- security-test.js
- security-tools-test.js
- semgrep-scan-test.js
- severity-filter-test.js
- spawn-ast-concurrency-test.js
- spawn-ast-direct-test.js
- spawn-ast-test.js
- staged-files-test.js
- staleness-test.js
- svelte-parser-test.js
- symbol-extractors-test.js
- symbol-registry-test.js
- test-detector-test.js
- tree-tools-test.js
- vue-parser-test.js
- w2t3-command-quality-test.js
- watch-format-test.js
- watch-sigterm-test.js
- watch-test.js
- with-impact-test.js
- workspace-tools-test.js

### C

### D
- test-helpers.js
- runner.js

