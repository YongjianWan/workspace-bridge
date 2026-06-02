// @contract — git blame parser + mailmap + knowledge risk scoring unit tests
const assert = require('assert');
const { parseMailmap, parseBlamePorcelain, computeKnowledgeRisk } = require('../src/tools/git-tools');

function testParseMailmapBasic() {
  const content = `
# Comment line
Alice <alice@example.com> Bob <bob@example.com>
<canonical@example.com> <alias@example.com>
Charlie <charlie@example.com>   <alias2@example.com>
`;
  const map = parseMailmap(content);
  assert.strictEqual(map.get('bob@example.com'), 'alice@example.com');
  assert.strictEqual(map.get('alias@example.com'), 'canonical@example.com');
  assert.strictEqual(map.get('alias2@example.com'), 'charlie@example.com');
  assert.strictEqual(map.get('unknown@example.com'), undefined);
}

function testParseMailmapEmpty() {
  assert.strictEqual(parseMailmap('').size, 0);
  assert.strictEqual(parseMailmap(null).size, 0);
  assert.strictEqual(parseMailmap(undefined).size, 0);
}

function testParseBlamePorcelainBasic() {
  // Simulated git blame --porcelain output for 3 lines:
  // Line 1: author A
  // Line 2: author A
  // Line 3: author B
  const stdout = `
abc123def456abc123def456abc123def456abc123 1 1
author author A
author-mail <a@example.com>
author-time 1700000000
author-tz +0800
committer Committer
committer-mail <c@example.com>
committer-time 1700000000
committer-tz +0800
summary init
filename src/index.js
\tconst x = 1;
abc123def456abc123def456abc123def456abc124 2 2
author author A
author-mail <a@example.com>
author-time 1700000001
author-tz +0800
committer Committer
committer-mail <c@example.com>
committer-time 1700000001
committer-tz +0800
summary add
filename src/index.js
\tconst y = 2;
def456abc123def456abc123def456abc123def456 3 3
author author B
author-mail <b@example.com>
author-time 1700000002
author-tz +0800
committer Committer
committer-mail <c@example.com>
committer-time 1700000002
committer-tz +0800
summary tweak
filename src/index.js
\tconst z = 3;
`;
  const authors = parseBlamePorcelain(stdout);
  assert.strictEqual(authors.size, 2);
  const a = authors.get('a@example.com');
  assert(a, 'author A should exist');
  assert.strictEqual(a.lines, 2);
  assert.strictEqual(a.name, 'author A');
  const b = authors.get('b@example.com');
  assert(b, 'author B should exist');
  assert.strictEqual(b.lines, 1);
  assert.strictEqual(b.name, 'author B');
}

function testParseBlamePorcelainEmpty() {
  const authors = parseBlamePorcelain('');
  assert.strictEqual(authors.size, 0);
  const authors2 = parseBlamePorcelain('\n\n');
  assert.strictEqual(authors2.size, 0);
}

function testParseBlamePorcelainCompressedBlock() {
  // git blame --porcelain compresses consecutive lines from the same commit:
  // only the first line in the block has full metadata; subsequent lines
  // only emit SHA + line numbers + content.
  const stdout = `
abc123def456abc123def456abc123def456abc123 1 1 3
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0800
committer Committer
committer-mail <c@example.com>
committer-time 1700000000
committer-tz +0800
summary init
filename src/index.js
\tconst x = 1;
abc123def456abc123def456abc123def456abc123 2 2
\tconst y = 2;
abc123def456abc123def456abc123def456abc123 3 3
\tconst z = 3;
`;
  const authors = parseBlamePorcelain(stdout);
  assert.strictEqual(authors.size, 1, 'should have exactly one author');
  const alice = authors.get('alice@example.com');
  assert(alice, 'Alice should exist');
  assert.strictEqual(alice.lines, 3, 'compressed block should count all 3 lines');
  assert.strictEqual(alice.name, 'Alice');
}

function testComputeKnowledgeRisk() {
  // Single author → high
  const high = computeKnowledgeRisk({ authorCount: 1, primaryAuthorPct: 1.0 });
  assert.strictEqual(high.riskLevel, 'high');
  assert.ok(high.reason.includes('Single author'));

  // Two authors → medium
  const medium1 = computeKnowledgeRisk({ authorCount: 2, primaryAuthorPct: 0.6 });
  assert.strictEqual(medium1.riskLevel, 'medium');
  assert.ok(medium1.reason.includes('Only 2'));

  // Many authors but dominant → medium
  const medium2 = computeKnowledgeRisk({ authorCount: 5, primaryAuthorPct: 0.9 });
  assert.strictEqual(medium2.riskLevel, 'medium');
  assert.ok(medium2.reason.includes('Dominant'));

  // Well distributed → low
  const low = computeKnowledgeRisk({ authorCount: 4, primaryAuthorPct: 0.5 });
  assert.strictEqual(low.riskLevel, 'low');
  assert.ok(low.reason.includes('well distributed') || low.reason.includes('4 authors'));

  // Zero authors → unknown
  const unknown = computeKnowledgeRisk({ authorCount: 0, primaryAuthorPct: 0 });
  assert.strictEqual(unknown.riskLevel, 'unknown');
}

async function main() {
  testParseMailmapBasic();
  testParseMailmapEmpty();
  testParseBlamePorcelainBasic();
  testParseBlamePorcelainEmpty();
  testParseBlamePorcelainCompressedBlock();
  testComputeKnowledgeRisk();
}

main();
