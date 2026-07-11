# Src Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the interpreter out of `tests/001-basic.ts` into `src/` modules split by concern, leaving the test file as a harness that imports from `src/`, and add a `bin/slight.ts` CLI that runs `.slight` files.

**Architecture:** Pure code move — no behavior changes. Seven `src/` modules (`debug`, `terms`, `parser`, `builtins`, `syscalls`, `konts`, `strand`, plus an `index.ts` barrel) extracted bottom-up in dependency order so `node tests/001-basic.ts` stays runnable after every task. Verification is a baseline diff of the test suite output captured before any change.

**Tech Stack:** TypeScript run directly with `node` (type stripping — relative imports MUST use explicit `.ts` extensions). `tsc` build to `js/` via `npm run build`. No test framework.

**Spec:** `docs/superpowers/specs/2026-07-11-src-restructure-design.md`

## Global Constraints

- **This is a pure move.** Do not rename, reorder, reformat, or "improve" any moved code. The only permitted edits to moved code are: adding `export` keywords, adding `import` statements, and the two ownership changes named in Task 3 (`time`/`time/end` into `initalizeEnv`, `@ARGV` out of the test harness).
- Output of `node tests/001-basic.ts` (plain and `DEBUG=1`) must be byte-identical to the baseline after every task, modulo the `...run: <N>ms` timing line.
- Relative imports use explicit `.ts` extensions everywhere (e.g. `from './terms.ts'`) — required by node type stripping.
- Match the file's existing style: spaces inside parens in signatures (`foo (a : T) : R`), aligned type annotations, factory functions named after their types.
- `<scratchpad>` below means the session scratchpad directory (absolute path). Baseline files live there, never in the repo.
- No `timeout` command exists on this macOS — don't use it in verification commands.
- Do not move `haltKey`/`mailKey`/`sysKey` into `konts.ts` — they are scheduler details and go with `strand.ts`.

## File Structure

- Create: `src/debug.ts`, `src/terms.ts`, `src/parser.ts`, `src/builtins.ts`, `src/syscalls.ts`, `src/konts.ts`, `src/strand.ts`, `src/index.ts`, `bin/slight.ts`
- Modify: `tests/001-basic.ts` (shrinks each task; ends as test program + `main()` + imports), `tsconfig.json`, `package.json`
- Scratchpad (not committed): `<scratchpad>/baseline-plain.txt`, `<scratchpad>/baseline-debug.txt`

The section banners (`// ----…----`) in `tests/001-basic.ts` mark the cut lines. Declarations are identified by name below; find them by name, not by line number (line numbers shift as tasks delete code).

---

### Task 1: Baseline capture + tooling bump

**Files:**
- Modify: `package.json` (typescript ^5.5 → ^5.8), `tsconfig.json` (two new compiler options)
- Create: `<scratchpad>/baseline-plain.txt`, `<scratchpad>/baseline-debug.txt`

**Interfaces:**
- Produces: the two baseline files every later task diffs against, and a toolchain where `.ts`-extension imports both run under node and compile under `tsc`.

- [ ] **Step 1: Capture baselines BEFORE any other change**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings > <scratchpad>/baseline-plain.txt
DEBUG=1 node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings > <scratchpad>/baseline-debug.txt
wc -l <scratchpad>/baseline-plain.txt <scratchpad>/baseline-debug.txt
```

Expected: both files non-empty; plain one ends with the `DONE:` group (TOTAL/HALT/ERROR counts).

- [ ] **Step 2: Record pre-existing build status**

Run: `npm run build; echo "exit: $?"`

Record the result. If it fails (e.g. TS1208, because the single file has no imports/exports and `isolatedModules` is on), that is a pre-existing condition — the restructure itself fixes it once files become modules. Do not fix anything here; just record.

- [ ] **Step 3: Bump TypeScript and add tsconfig flags**

Run: `npm install -D typescript@^5.8`

In `tsconfig.json`, inside `compilerOptions`, add after the `"isolatedModules": true,` line:

```json
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
```

(`rewriteRelativeImportExtensions` is what lets `tsc` emit working `.js` imports from `.ts`-extension sources; it requires TS ≥ 5.7.)

- [ ] **Step 4: Verify nothing changed at runtime**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-plain.txt
```

Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: bump typescript to ^5.8, allow .ts-extension imports"
```

---

### Task 2: Extract `src/debug.ts` and `src/terms.ts`

**Files:**
- Create: `src/debug.ts`, `src/terms.ts`
- Modify: `tests/001-basic.ts`

**Interfaces:**
- Produces:
  - `src/debug.ts`: `export const DEBUG : boolean`
  - `src/terms.ts`: everything from the top of the current file through `pprint` — types `LITERAL, LIST, CALLABLE, TERM, Nil, Cons, Sym, Pid, Str, Num, Bool, ERROR, Env, Lambda, Builtin`; predicates `isNil, isCons, isSym, isPid, isStr, isNum, isBool, isTrue, isFalse, isError, isBuiltin, isLambda, isEnv, isLiteral, isList, isCallable`; constructors/helpers `nil, cons, car, cdr, cadr, cddr, num, str, bool, sym, lambda, raise, list, newPid, newEnv, bind, lookup, bindParams, uncons, eq, pprint`. All exported.

- [ ] **Step 1: Create `src/debug.ts`**

```ts
export const DEBUG : boolean = process.env["DEBUG"] && process.env["DEBUG"] == '1' ? true : false;
```

(This is the existing `const DEBUG` line from `tests/001-basic.ts` with `export` added.)

- [ ] **Step 2: Create `src/terms.ts`**

Cut from `tests/001-basic.ts` everything from the `type LITERAL = ...` line through the end of `function pprint (...) { ... }` (the block between the first two `// ----` banners after the DEBUG line, i.e. the three sections: type defs, predicates, constructors/helpers — ending just before the `function parse` banner). Paste into `src/terms.ts` unchanged, then prefix every top-level `type` and `function` and the `const nil` with `export`.

`src/terms.ts` needs no imports.

- [ ] **Step 3: Rewire `tests/001-basic.ts`**

Delete the moved code and the `const DEBUG` line from `tests/001-basic.ts`. At the top of the file add:

```ts
import { DEBUG } from '../src/debug.ts';
import {
    type TERM, type LIST, type LITERAL, type CALLABLE,
    type Nil, type Cons, type Sym, type Pid, type Str, type Num, type Bool,
    type ERROR, type Env, type Lambda, type Builtin,
    isNil, isCons, isSym, isPid, isStr, isNum, isBool, isTrue, isFalse,
    isError, isBuiltin, isLambda, isEnv, isLiteral, isList, isCallable,
    nil, cons, car, cdr, cadr, cddr, num, str, bool, sym, lambda, raise,
    list, newPid, newEnv, bind, lookup, bindParams, uncons, eq, pprint,
} from '../src/terms.ts';
```

- [ ] **Step 4: Verify against baseline**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-plain.txt
DEBUG=1 node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-debug.txt
npm run build
```

Expected: both diffs empty; build succeeds (the files are modules now).

- [ ] **Step 5: Commit**

```bash
git add src/debug.ts src/terms.ts tests/001-basic.ts
git commit -m "refactor: extract src/debug.ts and src/terms.ts from tests/001-basic.ts"
```

---

### Task 3: Extract `src/parser.ts` and `src/builtins.ts` (with `time`/`time/end` ownership move)

**Files:**
- Create: `src/parser.ts`, `src/builtins.ts`
- Modify: `tests/001-basic.ts`

**Interfaces:**
- Consumes: `src/terms.ts` exports from Task 2.
- Produces:
  - `src/parser.ts`: `export function parse (source : string) : TERM[]`
  - `src/builtins.ts`: `export function liftUnOp`, `liftBinOp`, `liftListOp`, `liftNumBinOp`, `liftNumBoolOp`, `export function initalizeEnv (core : Env | undefined = undefined) : Env` — where `initalizeEnv` now ALSO binds `time` and `time/end`.

- [ ] **Step 1: Create `src/parser.ts`**

Move `function parse` from `tests/001-basic.ts` unchanged, prefixed with `export`. Add at top:

```ts
import { type TERM, list, str, num, bool, sym } from './terms.ts';
```

- [ ] **Step 2: Create `src/builtins.ts`**

Move the five `lift*` functions and `initalizeEnv` from `tests/001-basic.ts` unchanged, each prefixed with `export`. Add at top:

```ts
import {
    type TERM, type LIST, type Env, type Builtin, type Num, type Bool, type ERROR,
    isNil, isCons, isNum, isStr, isList,
    nil, cons, car, cdr, cadr, cddr, num, str, bool, sym, raise,
    newEnv, bind, eq, list, pprint,
} from './terms.ts';
```

- [ ] **Step 3: Move `time`/`time/end` into `initalizeEnv`**

In `tests/001-basic.ts`, the harness currently does:

```ts
env = bind( sym('time'),     liftUnOp('time',     (t) => { if (!isStr(t)) return raise(`time expects a STR label, not ${t.type}`);     console.time(t.value);    return nil; }), env );
env = bind( sym('time/end'), liftUnOp('time/end', (t) => { if (!isStr(t)) return raise(`time/end expects a STR label, not ${t.type}`); console.timeEnd(t.value); return nil; }), env );
```

Delete those two lines from the harness and add them (verbatim, same style as the other bindings) inside `initalizeEnv` in `src/builtins.ts`, after the `pprint` binding and before `return env;`.

Also delete the `@ARGV` binding line from the harness (`env = bind( sym('@ARGV'), ... )`) — per the spec it becomes the CLI's job (Task 6). The test program does not use `@ARGV`, `time`, or `time/end`, so output is unaffected.

- [ ] **Step 4: Rewire `tests/001-basic.ts`**

Delete the moved code. Add imports:

```ts
import { parse } from '../src/parser.ts';
import { initalizeEnv } from '../src/builtins.ts';
```

Prune now-unused names from the Task 2 import block if the build complains; otherwise leave the block alone.

- [ ] **Step 5: Verify against baseline**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-plain.txt
DEBUG=1 node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-debug.txt
npm run build
```

Expected: both diffs empty; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/parser.ts src/builtins.ts tests/001-basic.ts
git commit -m "refactor: extract src/parser.ts and src/builtins.ts; time/time-end become builtins"
```

---

### Task 4: Extract `src/syscalls.ts` and `src/konts.ts`

**Files:**
- Create: `src/syscalls.ts`, `src/konts.ts`
- Modify: `tests/001-basic.ts`

**Interfaces:**
- Consumes: `src/terms.ts` exports.
- Produces:
  - `src/syscalls.ts`: `export const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>>` with the `sleep` entry registered (module-level mutable Map — host embedders register syscalls by importing it).
  - `src/konts.ts`: types `Kontinuation, EvalExpr, EvalHead, EvalArgs, Apply, Return, Define, Cond, Send, Syscall, ScopeExit, Drop, Err, Block, Yield, Halt, Kontinue, Chan, WaitFor, Process`; functions `pprintKont, ThrowError, RaiseError, EvalExpr, EvalHead, EvalArgs, Apply, Return, Define, Cond, Drop, Block, Send, Syscall, Yield, Halt, ScopeExit`. All exported.

- [ ] **Step 1: Create `src/syscalls.ts`**

Move the `const SYSCALLS = ...` declaration and the `SYSCALLS.set('sleep', ...)` call unchanged, with `export` on the const. Add at top:

```ts
import { type TERM, isNum } from './terms.ts';
```

- [ ] **Step 2: Create `src/konts.ts`**

Move from `tests/001-basic.ts`, unchanged except for `export` prefixes:

1. The kontinuation block: `type Kontinuation` through the factory functions ending with `ScopeExit` (types `EvalExpr … Halt`, the `Kontinue` union, `pprintKont`, `ThrowError`, `RaiseError`, and every kont factory function).
2. The process-model types that currently sit just below the wait-key helpers: `type Chan`, `type WaitFor`, `type Process`.

Do NOT move `haltKey`, `mailKey`, `sysKey` — they stay behind for Task 5 (`strand.ts`).

Add at top of `src/konts.ts`:

```ts
import {
    type TERM, type LIST, type CALLABLE, type Env, type Sym, type Pid, type ERROR,
    raise, pprint,
} from './terms.ts';
```

Note: `WaitFor` must be declared before (or is hoisted for) the `Block` factory that references it — type declarations hoist, so the original relative order can be kept as-is; just keep both halves in this one file.

- [ ] **Step 3: Rewire `tests/001-basic.ts`**

Delete the moved code. Add imports:

```ts
import { SYSCALLS } from '../src/syscalls.ts';
import {
    type Kontinue, type Chan, type WaitFor, type Process,
    pprintKont, ThrowError, RaiseError,
    EvalExpr, EvalHead, EvalArgs, Apply, Return, Define, Cond,
    Drop, Block, Send, Syscall, Yield, Halt, ScopeExit,
} from '../src/konts.ts';
```

- [ ] **Step 4: Verify against baseline**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-plain.txt
DEBUG=1 node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-debug.txt
npm run build
```

Expected: both diffs empty; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/syscalls.ts src/konts.ts tests/001-basic.ts
git commit -m "refactor: extract src/syscalls.ts and src/konts.ts"
```

---

### Task 5: Extract `src/strand.ts`, add `src/index.ts` barrel

**Files:**
- Create: `src/strand.ts`, `src/index.ts`
- Modify: `tests/001-basic.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces:
  - `src/strand.ts`: `export class Strand` (public API used by callers: `run (exprs : TERM[], env : Env) : Promise<Process[]>`), plus module-private `haltKey`/`mailKey`/`sysKey`.
  - `src/index.ts`: barrel re-exporting all modules.
  - `tests/001-basic.ts` is now ONLY: imports, `test_source`, `source`, the parse/env setup, `main()`, and the trailing comment block.

- [ ] **Step 1: Create `src/strand.ts`**

Move `haltKey`, `mailKey`, `sysKey`, and `class Strand` from `tests/001-basic.ts` unchanged; `export` only the class (the key helpers stay module-private). Add at top:

```ts
import { DEBUG } from './debug.ts';
import {
    type TERM, type Env, type Pid, type ERROR,
    isCons, isSym, isList, isNil, isPid, isError, isBool, isTrue,
    isLambda, isBuiltin, isCallable,
    nil, car, cdr, cons, uncons, list, sym, lambda,
    newPid, newEnv, bind, lookup, bindParams, raise, pprint,
} from './terms.ts';
import {
    type Kontinue, type Chan, type WaitFor, type Process,
    pprintKont, ThrowError, RaiseError,
    EvalExpr, EvalHead, EvalArgs, Apply, Return, Define, Cond,
    Drop, Block, Send, Syscall, Yield, Halt, ScopeExit,
} from './konts.ts';
import { SYSCALLS } from './syscalls.ts';
```

(If `tsc` flags any of these as unused or missing, adjust the list to exactly what `Strand` references — do not change the moved code to fit the imports.)

- [ ] **Step 2: Create `src/index.ts`**

```ts
export * from './debug.ts';
export * from './terms.ts';
export * from './parser.ts';
export * from './builtins.ts';
export * from './syscalls.ts';
export * from './konts.ts';
export * from './strand.ts';
```

- [ ] **Step 3: Rewire `tests/001-basic.ts`**

Delete the moved code and prune the import blocks down to what the harness actually uses. The whole import section should now be:

```ts
import { DEBUG } from '../src/debug.ts';
import { newEnv, pprint } from '../src/terms.ts';
import { parse } from '../src/parser.ts';
import { initalizeEnv } from '../src/builtins.ts';
import { Strand } from '../src/strand.ts';
```

Everything below the imports stays exactly as it is today: `test_source`, `let source = \`\``, `let exprs = parse(source || test_source)`, the `if (DEBUG) console.log("Parsed", ...)` line, `let env = newEnv(); env = initalizeEnv( env );`, `async function main () {...}`, `main().catch(...)`.

- [ ] **Step 4: Verify against baseline**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-plain.txt
DEBUG=1 node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-debug.txt
npm run build
```

Expected: both diffs empty; build succeeds. Also sanity-check the barrel compiles by building (it's in `src/**`, so `tsc` covers it).

- [ ] **Step 5: Commit**

```bash
git add src/strand.ts src/index.ts tests/001-basic.ts
git commit -m "refactor: extract src/strand.ts, add src/index.ts barrel; test file is now a harness"
```

---

### Task 6: `bin/slight.ts` CLI + final verification

**Files:**
- Create: `bin/slight.ts`
- Test: manual — `node bin/slight.ts examples/even-odd-actors.slight`

**Interfaces:**
- Consumes: `src/index.ts` barrel.
- Produces: `node bin/slight.ts <file.slight> [args...]` — parses and runs the file; binds `@ARGV` to the args AFTER the script path (Perl semantics); prints the per-process halted/errored report.

- [ ] **Step 1: Write `bin/slight.ts`**

```ts
import { readFileSync } from 'node:fs';

import {
    DEBUG, parse, initalizeEnv, Strand,
    newEnv, bind, sym, str, list, pprint,
} from '../src/index.ts';

async function main () {
    let path = process.argv[2];
    if (path == undefined) {
        console.error(`usage: slight <file.slight> [args ...]`);
        process.exit(1);
    }

    let source = readFileSync(path, 'utf8');
    let exprs  = parse(source);

    if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

    let env = newEnv();
    env = bind( sym('@ARGV'), list( ...process.argv.slice(3).map((arg) => str(arg)) ), env );
    env = initalizeEnv( env );

    let strand = new Strand();
    let halted = await strand.run(exprs, env);

    for (const proc of halted) {
        if (proc.kont.type == 'HALT') {
            console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
        } else if (proc.kont.type == 'ERR') {
            console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
        }
    }
}

main().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
```

- [ ] **Step 2: Run the CLI against the example**

Run: `node bin/slight.ts examples/even-odd-actors.slight`

Expected: the program executes to completion and every process reports `HALTED` (no `ERRORED` lines, no thrown stack). This is a new capability with no baseline — read the output and confirm it is sensible for an even/odd actors program.

Also run: `node bin/slight.ts` — expected: usage line on stderr, exit code 1.

- [ ] **Step 3: Full final verification**

```bash
node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-plain.txt
DEBUG=1 node tests/001-basic.ts 2>&1 | grep -v -e '^\.\.\.run' -e ExperimentalWarning -e trace-warnings | diff - <scratchpad>/baseline-debug.txt
npm run build
```

Expected: both diffs empty; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add bin/slight.ts
git commit -m "feat: add bin/slight.ts CLI for running .slight files"
```
