import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * §4 constraint — "worth adding a cheap CI check that fails the build if the glob pattern
 * in generate-ast-graph.ts is ever widened beyond this repository's own src directory,
 * so this stays a structural guarantee rather than something that has to be remembered."
 *
 * This is that check. It runs in CI before the build (see .github/workflows/ci.yml).
 *
 * It asserts three things about the generator:
 *   1. The scope constants still hold their expected literal values.
 *   2. Neither constant is read from argv, env, or a config file — i.e. the scope cannot
 *      be widened at run time without editing the source, which this check would catch.
 *   3. The generator resolves paths relative to the project root only.
 */

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const GENERATOR = resolve(PROJECT_ROOT, 'src/ast-pipeline/generate-ast-graph.ts');

const EXPECTED_SOURCE_ROOT = "const SOURCE_ROOT = 'src';";
const EXPECTED_SOURCE_GLOB = "const SOURCE_GLOB = 'src/**/*.{ts,tsx}';";

/** Anything that would let an external path reach the parser. */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /process\.argv/, reason: 'reads a path from command-line arguments' },
  { pattern: /process\.env\.[A-Z_]*(?:SRC|SOURCE|PATH|REPO|DIR|ROOT)/i, reason: 'reads a source path from the environment' },
  { pattern: /https?:\/\//, reason: 'references a remote URL' },
  { pattern: /\bgit\s+clone\b/, reason: 'clones an external repository' },
  { pattern: /\bexeca\b|child_process/, reason: 'shells out, which could reach outside the repo' },
];

function fail(message: string): never {
  console.error(`\n✗ AST scope check failed\n  ${message}\n`);
  console.error(
    '  The AST pipeline is scoped exclusively to this repository\'s own source (§1, §4).\n' +
      '  Proprietary project code must never be parsed, stored, or displayed by this site.\n',
  );
  process.exit(1);
}

function main(): void {
  const source = readFileSync(GENERATOR, 'utf8');

  if (!source.includes(EXPECTED_SOURCE_ROOT)) {
    fail(`SOURCE_ROOT is no longer exactly \`${EXPECTED_SOURCE_ROOT}\` in generate-ast-graph.ts`);
  }

  if (!source.includes(EXPECTED_SOURCE_GLOB)) {
    fail(`SOURCE_GLOB is no longer exactly \`${EXPECTED_SOURCE_GLOB}\` in generate-ast-graph.ts`);
  }

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(source)) {
      fail(`generate-ast-graph.ts ${reason} (matched ${String(pattern)})`);
    }
  }

  console.log('✓ AST scope check passed — pipeline is confined to src/**/*.{ts,tsx}');
}

main();
