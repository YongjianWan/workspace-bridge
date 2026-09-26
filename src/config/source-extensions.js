/**
 * KNOWN_SOURCE_EXTENSIONS — source extensions the tool recognizes as code
 * but that no parser claims (registry has no entry for them).
 *
 * Why this exists (P0-3): discovery filters the tree against the active
 * parser extension set, so a file like `Player.cs` never enters the index —
 * and every downstream count (coverage, warnings) only ever sees indexed
 * files. The observed failure: a Unity repo analyzed at coverageRatio=1 with
 * C# silently missing (L1-4). `file-index.js` consults this list during the
 * walk to count what no parser claims and feed warnings[] + the coverage
 * denominator.
 *
 * The membership test is `KNOWN_SOURCE_EXTENSIONS.has(ext) &&
 * !registry.findByExt(ext)` — registering a language later auto-claims its
 * extensions here without editing this list.
 *
 * Rationale for what is deliberately NOT here:
 * - Shell/batch/PowerShell (.sh .bash .zsh .ps1 .bat .cmd): infra/CI scripts,
 *   not import-graph source. Flagging every repo's deploy scripts as a
 *   high-severity drop would train consumers to ignore the warning. (This
 *   repo itself ships setup-global-cli.ps1.)
 * - Data/schema dialects (.sql .proto .graphql) and doc/config formats: role
 *   detection already classifies these as config, not code.
 * - Script variants of languages we parse (.kts .gradle .pyw .pyi): build/
 *   stub files of an already-covered language; flagging every Gradle or
 *   typed-Python repo would be noise, and their absence from the import graph
 *   is not an "unsupported language" gap.
 *
 * Adding an entry: only multi-file programming languages where an import
 * graph exists in principle. Each entry costs a severity-high warning and
 * coverage on every repo containing the extension, so it must be a language
 * we would actually parse if we had a parser for it.
 */
const KNOWN_SOURCE_EXTENSIONS = new Set([
  // .NET family (the P0-3 report's example: .cs)
  '.cs', '.fs', '.vb',
  // JVM-adjacent: java/.kt are registered, these are not
  '.scala', '.groovy',
  // mainstream application languages
  '.rb', '.php', '.pl', '.pm', '.lua', '.coffee',
  // mobile / systems languages
  '.swift', '.dart', '.m', '.mm', '.zig', '.nim', '.cr',
  // data-science / scientific
  '.r', '.jl',
  // functional / BEAM
  '.ex', '.exs', '.erl', '.hrl', '.hs', '.ml', '.mli', '.clj', '.cljs', '.elm', '.purs',
  // smart-contract
  '.sol',
  // C/C++ dialect extensions the cpp registry does not claim (.c/.cpp/.cc/.h/.hpp do)
  '.cxx', '.hxx', '.hh',
  // long-tail languages still carrying an import/unit graph
  '.pas', '.d', '.f90', '.tcl',
]);

module.exports = { KNOWN_SOURCE_EXTENSIONS };
