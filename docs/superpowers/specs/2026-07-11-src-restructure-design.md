# Restructure: interpreter moves from tests/001-basic.ts into src/

**Date:** 2026-07-11
**Status:** Approved

## Goal

`tests/001-basic.ts` (~1150 lines) currently contains the entire interpreter
plus its test program. Move the interpreter into `src/` split by concern,
leaving `tests/001-basic.ts` as a test harness that imports from `src/`, and
add a `bin/slight.ts` CLI that runs `.slight` files (making
`examples/even-odd-actors.slight` runnable).

This is a **pure move** — no behavior changes. The output of
`node tests/001-basic.ts` must be identical before and after (modulo the
`...run` timing line). This supersedes the earlier "do not split the file"
constraint from the async-syscalls plan.

## Module layout

```
src/
  debug.ts     — export const DEBUG (env-var read); future home for real logging
  terms.ts     — TERM types, predicates (isNil…), constructors (cons, num, sym…),
                 list/uncons, env (newEnv, bind, lookup, bindParams), eq, pprint
  parser.ts    — parse()                         (depends on: terms)
  builtins.ts  — lift* helpers, initalizeEnv()   (depends on: terms)
  syscalls.ts  — SYSCALLS table + sleep          (depends on: terms)
  konts.ts     — Kontinuation types + factories (EvalExpr, Return…), pprintKont,
                 WaitFor, Chan, Process types    (depends on: terms)
  strand.ts    — class Strand: scheduler, step/kontinue, defun scan in run()
                 (depends on: terms, konts, syscalls, debug)
  index.ts     — barrel re-export
tests/
  001-basic.ts — embedded test program + main(), imports from src
bin/
  slight.ts    — runs a .slight file given on argv
```

Cut-line rationale:

- `terms.ts` is the fat one (~370 lines) but is one concern: the data
  language. Env stays with terms (`lookup` returns ERROR terms, `pprint`
  prints envs — splitting them creates a circular boundary).
- `konts.ts` owns `Process`/`Chan`/`WaitFor` too — konts reference `WaitFor`,
  `Process` is `{pid, kont, …}`; one cluster. `strand.ts` is purely behavior.
- `SYSCALLS` stays a module-level mutable Map in `syscalls.ts` so host
  embedders can register syscalls by importing it — same semantics as today.
- `DEBUG` gets its own `debug.ts`: the scattered `if (DEBUG) console.log`
  sites will later consolidate into proper logging there.

## Builtins ownership

- `time` and `time/end` move into `initalizeEnv()` in `builtins.ts` — they
  are general-purpose development tools.
- `@ARGV` is bound by the CLI (`bin/slight.ts`), which was always its
  intention. The test harness does not bind it.

## Entry points

- `tests/001-basic.ts` keeps its embedded test program and `main()`,
  importing everything it needs from `src/`.
- `bin/slight.ts`: `node bin/slight.ts examples/even-odd-actors.slight` —
  reads the file, parses, builds the env (`initalizeEnv` + `@ARGV`), runs a
  `Strand`, prints the halted/error summary like today's `main()`.

## Build/run mechanics

- Relative imports use explicit `.ts` extensions (required by node's type
  stripping, which is how the project runs).
- Bump `typescript` from ^5.5 to ^5.7+ and add to tsconfig:
  `allowImportingTsExtensions: true` and `rewriteRelativeImportExtensions:
  true`, so `npm run build` (tsc → `js/`) keeps emitting working `.js`
  imports.
- `src/` is already in the tsconfig `include`; no path changes needed.
- Style: match the existing file's conventions (spaces inside parens in
  signatures, aligned type annotations, factory functions named after their
  types).

## Error handling

Unchanged — this is a move. Existing throw-vs-ERROR decisions stay where
they are (NOTES.md tracks the open error-site cleanup separately).

## Testing / verification

1. **Before touching anything:** capture baseline output of
   `node tests/001-basic.ts`, plain and with `DEBUG=1`.
2. After the move: diff against baseline — identical modulo the timing line.
3. `npm run build` passes clean.
4. `node bin/slight.ts examples/even-odd-actors.slight` executes the actors
   example sensibly (new capability — no baseline; confirm it runs).

## Out of scope

- No refactoring of interpreter logic, error sites, env sharing, or parser
  fixes (all tracked in NOTES.md).
- No test framework — verification stays baseline-diff based.
- No logging system yet; `debug.ts` just exports the flag.
