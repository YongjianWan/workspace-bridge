const assert = require('assert');
const { parseRust } = require('../src/services/dep-graph/parsers/rust-ast');

const RUST_SOURCE = `
use std::io::{self, Read};
use std::collections::HashMap;
use serde_json;
use crate::utils::helper;

pub fn hello() {}

pub struct Point;

pub enum Color { Red, Green }

pub trait Drawable {}

pub type MyInt = i32;

pub mod utils {}

pub const MAX: u32 = 100;

pub static COUNT: u32 = 0;

pub use std::io::Read;

pub use crate::utils::Helper as MyHelper;

impl Point {
    pub fn new() -> Self {}
    fn private() {}
}

fn not_exported() {}

struct NotExported;
`;

async function testRustAstSchema() {
  const result = await parseRust(RUST_SOURCE);

  assert.strictEqual(result.parseMode, 'ast', 'Should use AST mode');

  // imports
  assert(result.imports.includes('std::io'), 'Should have std::io import');
  assert(result.imports.includes('std::io::Read'), 'Should have std::io::Read import');
  assert(result.imports.includes('std::collections::HashMap'), 'Should have HashMap import');
  assert(result.imports.includes('serde_json'), 'Should have serde_json import');
  assert(result.imports.includes('crate::utils::helper'), 'Should have crate::utils::helper import');

  // importRecords imported field
  const hashMapImport = result.importRecords.find((r) => r.source === 'std::collections::HashMap');
  assert(hashMapImport, 'Should have HashMap importRecord');
  assert.deepStrictEqual(hashMapImport.imported, ['HashMap'], 'Should extract imported symbol from simple use');

  const ioImport = result.importRecords.find((r) => r.source === 'std::io');
  assert(ioImport, 'Should have std::io importRecord from self');
  assert.deepStrictEqual(ioImport.imported, ['io'], 'Should extract imported symbol from self');

  const readImport = result.importRecords.find((r) => r.source === 'std::io::Read');
  assert(readImport, 'Should have std::io::Read importRecord');
  assert.deepStrictEqual(readImport.imported, ['Read'], 'Should extract imported symbol from use_list');

  const myHelperImport = result.importRecords.find((r) => r.source === 'crate::utils::Helper');
  assert(myHelperImport, 'Should have crate::utils::Helper importRecord');
  assert.deepStrictEqual(myHelperImport.imported, ['MyHelper'], 'Should extract alias from use_as');

  // exports
  assert(result.exports.includes('hello'), 'Should export hello');
  assert(result.exports.includes('Point'), 'Should export Point');
  assert(result.exports.includes('Color'), 'Should export Color');
  assert(result.exports.includes('Drawable'), 'Should export Drawable');
  assert(result.exports.includes('MyInt'), 'Should export MyInt');
  assert(result.exports.includes('utils'), 'Should export utils');
  assert(result.exports.includes('MAX'), 'Should export MAX');
  assert(result.exports.includes('COUNT'), 'Should export COUNT');
  assert(result.exports.includes('Read'), 'Should reexport Read');
  assert(result.exports.includes('MyHelper'), 'Should reexport MyHelper');

  // not exported
  assert(!result.exports.includes('not_exported'), 'Should not export private fn');
  assert(!result.exports.includes('NotExported'), 'Should not export private struct');
  assert(!result.exports.includes('private'), 'Should not export impl private fn');

  // export records kinds
  const helloRec = result.exportRecords.find((r) => r.name === 'hello');
  assert(helloRec, 'Should have hello exportRecord');
  assert.strictEqual(helloRec.kind, 'function');
  assert(typeof helloRec.lineStart === 'number', 'hello should have lineStart');

  const pointRec = result.exportRecords.find((r) => r.name === 'Point');
  assert.strictEqual(pointRec.kind, 'struct');

  const colorRec = result.exportRecords.find((r) => r.name === 'Color');
  assert.strictEqual(colorRec.kind, 'enum');

  const traitRec = result.exportRecords.find((r) => r.name === 'Drawable');
  assert.strictEqual(traitRec.kind, 'trait');

  const typeRec = result.exportRecords.find((r) => r.name === 'MyInt');
  assert.strictEqual(typeRec.kind, 'type');

  const modRec = result.exportRecords.find((r) => r.name === 'utils');
  assert.strictEqual(modRec.kind, 'module');

  const constRec = result.exportRecords.find((r) => r.name === 'MAX');
  assert.strictEqual(constRec.kind, 'const');

  const staticRec = result.exportRecords.find((r) => r.name === 'COUNT');
  assert.strictEqual(staticRec.kind, 'static');

  const reexportRec = result.exportRecords.find((r) => r.name === 'MyHelper');
  assert.strictEqual(reexportRec.kind, 'reexport');

  // functionRecords
  assert(result.functionRecords.some((r) => r.name === 'hello'), 'Should have hello functionRecord');
  assert(result.functionRecords.some((r) => r.name === 'new'), 'Should have new functionRecord from impl');
  assert(!result.functionRecords.some((r) => r.name === 'private'), 'Should not have private functionRecord');
  assert(!result.functionRecords.some((r) => r.name === 'not_exported'), 'Should not have not_exported functionRecord');

  console.log('rust-ast-parser-test: ok');
}

async function testRustAstUseListReexport() {
  const source = `
pub use std::io::{self, Write};
`;
  const result = await parseRust(source);
  assert(result.exports.includes('io'), 'Should reexport io from self');
  assert(result.exports.includes('Write'), 'Should reexport Write');
  console.log('rust-ast-use-list-reexport: ok');
}

async function main() {
  await testRustAstSchema();
  await testRustAstUseListReexport();
  console.log('All rust-ast-parser tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
