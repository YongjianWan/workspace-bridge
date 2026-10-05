#!/usr/bin/env node
// @fast
// @semantic
/**
 * Only top-level and class-member declarations are exports. A `val`, `fun` or class declared
 * inside a function body, lambda, initializer or accessor is local and must not be reported
 * (dead-exports would otherwise list it as an unused export).
 */
const assert = require('assert');
const { parseKotlin } = require('../src/services/dep-graph/parsers/kotlin-ast');

const SOURCE = `
package demo

val topLevel = 1
fun topFun(): Int {
    val localInFun = 2
    fun localFun() = localInFun
    class LocalClass
    val handler = { arg: Int ->
        val localInLambda = arg
        localInLambda
    }
    return localFun() + handler(1)
}

class Holder {
    val member = 1
    var counted: Int = 0
        get() {
            val localInGetter = field
            return localInGetter
        }
    init {
        val localInInit = 3
        println(localInInit)
    }
    fun method(): Int {
        val localInMethod = 4
        return localInMethod
    }
    class Nested
    companion object {
        const val LIMIT = 10
        fun create(): Holder {
            val localInCompanion = Holder()
            return localInCompanion
        }
    }
}

object Registry {
    fun lookup(name: String): String {
        val localName = name.trim()
        return localName
    }
}
`;

async function main() {
  const parsed = await parseKotlin(SOURCE);
  assert.strictEqual(parsed.parseMode, 'ast', 'the AST path must be exercised, not the regex fallback');
  const exported = new Set(parsed.exports);
  for (const expected of ['topLevel', 'topFun', 'Holder', 'member', 'counted', 'method', 'Nested', 'Registry', 'lookup', 'LIMIT', 'create']) {
    assert(exported.has(expected), `${expected} is a top-level or member declaration and must be exported`);
  }
  for (const local of ['localInFun', 'localFun', 'LocalClass', 'handler', 'localInLambda', 'localInGetter', 'localInInit', 'localInMethod', 'localInCompanion', 'localName']) {
    assert(!exported.has(local), `${local} is local to a function body and must not be exported`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
