# Kont-Chain Error Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the quadratic `expr_stack` machinery and reconstruct error traces at halt time by walking the kont chain, with call/args info carried on `SCOPE_EXIT` frames.

**Architecture:** The kont chain is already the call stack: after TCO exactly one `SCOPE_EXIT` survives per active, non-elided call. We move call identity (`call : CALLABLE, args : LIST`) onto `ScopeExit`, delete the parallel `proc.expr_stack` entirely (and its per-eval/per-apply allocations), and render a `trace : string[]` in `haltProcess` when a process dies as `ERR`.

**Tech Stack:** TypeScript 5.9 (strict, `module: nodenext`, compiled to `js/` via `tsc`), Node 22, plain `node:assert` test files.

**Spec:** `docs/superpowers/specs/2026-07-23-kont-chain-traces-design.md`

## Global Constraints

- No new dependencies.
- Match existing style: 4-space indent, `let`-heavy, single-quote imports with `.ts` extensions.
- Tail-collapse rule: a collapsed `SCOPE_EXIT` keeps the **new** call's `call`/`args` and the old frame's continuation.
- Trace cap: first/last **10** call frames with an elision line; **5** innermost context konts.
- Build command is `npm run build` (wipes and regenerates `js/`). Tests run from `js/tests/`.

---

### Task 1: Baselines and failing trace tests

**Files:**
- Create: `tests/300-trace-test.ts`
- No source changes; captures pre-change behavior for later diffing.

**Interfaces:**
- Consumes: `parse`, `expand`, `initalizeEnv`, `Strand`, `ProcessResult` from `src/index.ts` (all already exported).
- Produces: `tests/300-trace-test.ts`, which Task 2 must make pass. It reads `err.trace : string[]` on the `ERR` variant of `ProcessResult` — the field Task 2 introduces.

- [ ] **Step 1: Create a work branch**

```bash
git switch -c kont-chain-traces
```

- [ ] **Step 2: Capture baselines from the current build**

```bash
npm run build
node js/tests/050-env-test.js > /tmp/baseline-050.txt 2>&1
node js/tests/200-env-test.js > /tmp/baseline-200.txt 2>&1
npm run self-test > /tmp/baseline-selftest.txt 2>&1
node js/bin/slight.js examples/active-objects.slight > /tmp/baseline-active-objects.txt 2>&1
node js/bin/slight.js examples/ping-pong.slight > /tmp/baseline-ping-pong.txt 2>&1
npm run bench > /tmp/baseline-bench.txt 2>&1 || true
tail -20 /tmp/baseline-bench.txt
```

Expected: env tests print their `ok - ...` lines, self-test completes, examples produce their normal output. Bench may take a while; if it errors, note it and move on (comparison becomes optional in Task 3).

- [ ] **Step 3: Write the failing trace tests**

Create `tests/300-trace-test.ts`:

```ts
import assert from 'node:assert';
import { parse, expand, initalizeEnv, Strand, type ProcessResult } from '../src/index.ts';

async function run (source : string) : Promise<ProcessResult[]> {
    let exprs  = expand(parse(source));
    let strand = new Strand();
    return strand.run( exprs, initalizeEnv() );
}

// call-frame lines look like `     0 : (level-3 42)`; context lines like `  in RETURN : ...`
const isFrameLine = (line : string, name : string) : boolean =>
    new RegExp(`^\\s+\\d+ : \\(${name} `).test(line);

// -- deep non-tail error: call frames present, innermost-first ----------------
{
    let results = await run(`
        (defun level-3 (x) (car x))
        (defun level-2 (x) (+ 1 (level-3 x)))
        (defun level-1 (x) (+ 1 (level-2 x)))
        (level-1 42)
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');

    let i3 = err.trace.findIndex((l) => isFrameLine(l, 'level-3'));
    let i2 = err.trace.findIndex((l) => isFrameLine(l, 'level-2'));
    let i1 = err.trace.findIndex((l) => isFrameLine(l, 'level-1'));
    assert.ok( i3 >= 0, 'trace has a (level-3 42) frame' );
    assert.ok( i2 >= 0, 'trace has a (level-2 42) frame' );
    assert.ok( i1 >= 0, 'trace has a (level-1 42) frame' );
    assert.ok( i3 < i2 && i2 < i1, 'call frames are innermost-first' );
    assert.ok( err.trace[i3]!.includes('(level-3 42)'), 'frame shows the args' );
}

// -- error inside a tail loop: exactly one frame survives TCO -----------------
{
    let results = await run(`
        (defun loop (n)
            (if (== n 0) (car 99)
                (loop (- n 1))))
        (loop 1000)
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');

    let loop_frames = err.trace.filter((l) => isFrameLine(l, 'loop'));
    assert.equal( loop_frames.length, 1, 'exactly one loop frame survives TCO' );
    assert.ok( loop_frames[0]!.includes('(loop 0)'), 'the frame shows the current call, not the first' );
    assert.ok( err.trace.length < 25, `trace is bounded, got ${err.trace.length} lines` );
}

// -- deep non-tail recursion: trace is capped with an elision line ------------
{
    let results = await run(`
        (defun sink (n)
            (if (== n 0) (car 99)
                (+ 1 (sink (- n 1)))))
        (sink 100)
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');

    let sink_frames = err.trace.filter((l) => isFrameLine(l, 'sink'));
    assert.equal( sink_frames.length, 20, 'capped at first 10 + last 10 call frames' );
    assert.ok( err.trace.some((l) => l.includes('frame(s) elided')), 'elision line present' );
}

// -- 1M tail calls complete (previously quadratic / unrunnable) ---------------
{
    let start = performance.now();
    let results = await run(`
        (defun countdown (n)
            (if (== n 0) :done
                (countdown (- n 1))))
        (countdown 1000000)
    `);
    let ms = performance.now() - start;
    let halt = results[0];
    if (halt == undefined || halt.type != 'HALT') throw new Error('expected a HALT result');
    assert.ok( ms < 30000, `1M tail calls should be seconds, took ${Math.round(ms)}ms` );
    console.log(`# 1M tail calls in ${Math.round(ms)}ms`);
}

console.log('ok - trace tests passed');
```

- [ ] **Step 4: Run the build to verify the tests fail**

```bash
npm run build
```

Expected: FAIL — `tsc` errors on `tests/300-trace-test.ts` with TS2339 `Property 'trace' does not exist` (the `ERR` variant of `ProcessResult` still carries `expr_stack`). Do not commit yet — the tree doesn't build until Task 2.

---

### Task 2: Move call info onto ScopeExit, delete expr_stack, render traces

**Files:**
- Modify: `src/konts.ts:32` (type) and `src/konts.ts:145-148` (constructor)
- Modify: `src/strand.ts` (imports, `Process`, `ProcessResult`, `haltProcess`, `spawnProcess`, `EVAL_EXPR`, `APPLY`, `DROP`, `SCOPE_EXIT`)
- Modify: `src/debug.ts` (TRACE + `dumpKont`/`pprintKont` SCOPE_EXIT lines; new `renderTrace`)
- Modify: `src/index.ts:100` (ERR printing)
- Test: `tests/300-trace-test.ts` (written in Task 1)

**Interfaces:**
- Consumes: `ScopeExit` call sites and the `expr_stack` sites found in Task 1's tree.
- Produces:
  - `ScopeExit(call : CALLABLE, args : LIST, env : Env, kont : Kontinue) : ScopeExit` in `src/konts.ts`, type `{ type : 'SCOPE_EXIT', call : CALLABLE, args : LIST } & Kontinuation`.
  - `renderTrace(kont : Kontinue, context_frames? : number, call_cap? : number) : string[]` in `src/debug.ts`.
  - `ProcessResult` ERR variant: `{ type : 'ERR', error : ERROR, pid : Pid, steps : number, trace : string[] }`.
  - `Process` no longer has `expr_stack`.

- [ ] **Step 1: Rework `ScopeExit` in `src/konts.ts`**

Replace the type (line 32):

```ts
export type ScopeExit = { type : 'SCOPE_EXIT', call : CALLABLE, args : LIST } & Kontinuation
```

Replace the constructor (lines 145–148). The invariant that the constructor never produces adjacent `SCOPE_EXIT`s means the collapse branch cannot recurse:

```ts
// A tail call collapses into the frame it replaces: the new call's
// identity, the old frame's continuation. Elided frames are invisible
// to traces (Erlang/Scheme semantics).
export function ScopeExit (call : CALLABLE, args : LIST, env : Env, kont : Kontinue) : ScopeExit {
    if (kont.type == 'SCOPE_EXIT') return { type : 'SCOPE_EXIT', call, args, env, kont : kont.kont };
    return { type : 'SCOPE_EXIT', call, args, env, kont }
}
```

`CALLABLE` and `LIST` are already imported in `konts.ts`.

- [ ] **Step 2: Delete expr_stack from `src/strand.ts` and pass call info to ScopeExit**

Six edits, top to bottom:

**(a)** Replace the two import blocks at the top of the file. This drops the now-unused `type Cons`, `type Num`, `num`, `cadr`, `cddr`, `str`, and `bool` (`cons` is still used by the `lambda` special form) and adds `renderTrace` to the debug import:

```ts
import { DEBUG, LOG, TRACE, dumpKont, renderTrace } from './debug.ts';
import {
    type TERM, type Env, type MapEnv, type Pid, type ERROR, type LIST,
    isCons, isSym, isList, isNil, isPid, isError, isBool, isTrue, isFalse, isNum,
    isLambda, isBuiltin, isCallable,
    NIL, car, cdr, cons, uncons, list, sym, lambda,
    newPid, newMapEnv, newRibEnv, snapshotEnv, bind, lookup, bindParams, raise, pprint,
} from './terms.ts';
```

(The `konts.ts` and `syscalls.ts` imports are unchanged.)

**(b)** `Process` (line ~51) — remove `expr_stack`:

```ts
export type Process = {
    pid        : Pid,
    kont       : Kontinue,
    steps      : number,
    mailbox    : Chan,
}
```

**(c)** `ProcessResult` ERR variant (line ~61):

```ts
export type ProcessResult =
    | { type : 'HALT', result : TERM,  pid : Pid, steps : number }
    | { type : 'ERR',   error : ERROR, pid : Pid, steps : number, trace : string[] }
```

**(d)** `haltProcess` ERR branch (line ~198):

```ts
        } else if (proc.kont.type == 'ERR') {
            this.deliverFault( haltKey(proc.pid), proc.kont.error );
            proc_result = { type : 'ERR', error : proc.kont.error, pid : proc.pid, steps : proc.steps, trace : renderTrace(proc.kont) }
        } else {
```

**(e)** `spawnProcess` (line ~219) — remove `expr_stack : []`:

```ts
        let proc : Process = { pid, kont, steps : 0, mailbox : { id : ++this.CHAN_SEQ, queue : [] } };
```

**(f)** In `kontinue()`, remove all four `-- EXPR-SCOPE --` blocks:

- `EVAL_EXPR` (line ~366): delete the three lines pushing the `:EVAL` marker (`proc.expr_stack.push( list( sym(':EVAL'), kont.expr ));` and its two comment fences).
- `APPLY` lambda case (line ~502): delete the whole marker-push block (the `proc.expr_stack.push(list( sym(':APPLY'), ...))` call with its `:step`/`:depth`/`:call`/`:args` lines and comment fences), and pass the call info to `ScopeExit`. The case becomes:

```ts
            case isLambda(kont.call):
                let local = bindParams( kont.call.params, args, kont.call.env );
                if (isError(local)) return ThrowError(local, kont);
                return Eval( kont.call.body, local, ScopeExit( kont.call, args, kont.env, kont.kont ) )
```

- `DROP` (line ~549) becomes:

```ts
        case 'DROP':
            return kont.kont;
```

- `SCOPE_EXIT` (line ~621) becomes:

```ts
        case 'SCOPE_EXIT':
            if (returned == undefined) return RaiseError(`Expected result returned to SCOPE_EXIT, got undefined`, kont);
            return Return( returned, kont.env, kont.kont )
```

- [ ] **Step 3: Update `src/debug.ts` — SCOPE_EXIT rendering and `renderTrace`**

**(a)** Add `uncons` to the terms import:

```ts
import { pprint, uncons } from './terms.ts';
```

**(b)** In `TRACE`, the `SCOPE_EXIT` branch (line ~53) — `entry_step` is gone; show the call:

```ts
    case 'SCOPE_EXIT':
        console.log(
            [
                proc.pid.ident.toString().padStart(4, '0'),
                proc.steps.toString().padStart(6, '0'),
                `${proc.kont.type.padStart(11, ' ')} < ${pprint(proc.kont.call)}`
            ].join(' | '),
        );
        break;
```

**(c)** In `dumpKont`, replace the `SCOPE_EXIT` case:

```ts
    case 'SCOPE_EXIT' : return `${kont.type} : ${pprint(kont.call)}`;
```

**(d)** In `pprintKont`, replace the `SCOPE_EXIT` case:

```ts
    case 'SCOPE_EXIT' : kontStr += ` ${pprint(kont.call)}`; break;
```

**(e)** Add `renderTrace` at the bottom of the file:

```ts
// Reconstruct an error trace by walking the kont chain: the innermost
// pending konts give expression-level context, and each surviving
// SCOPE_EXIT is one call frame (tail-elided frames are invisible).
// Deep chains are capped Python-style: first/last `call_cap` frames.
export function renderTrace (kont : Kontinue, context_frames : number = 5, call_cap : number = 10) : string[] {
    if (kont.type == 'ERR') kont = kont.kont;

    let lines : string[] = [];

    let walk : Kontinue = kont;
    let context = 0;
    while (walk.type != 'HALT' && context < context_frames) {
        lines.push(`  in ${dumpKont(walk)}`);
        context++;
        walk = walk.kont;
    }

    let frames : string[] = [];
    walk = kont;
    while (walk.type != 'HALT') {
        if (walk.type == 'SCOPE_EXIT') {
            let name = walk.call.type == 'LAMBDA'
                ? (walk.call.name != undefined ? walk.call.name.ident : '<lambda>')
                : walk.call.name;
            frames.push(`(${[ name, ...uncons(walk.args).map(pprint) ].join(' ')})`);
        }
        walk = walk.kont;
    }

    let fmt = (f : string, i : number) : string => `  ${i.toString().padStart(4, ' ')} : ${f}`;
    if (frames.length > (2 * call_cap) + 1) {
        lines.push( ...frames.slice(0, call_cap).map(fmt) );
        lines.push(`  ... ${frames.length - (2 * call_cap)} frame(s) elided ...`);
        lines.push( ...frames.slice(-call_cap).map((f, i) => fmt(f, frames.length - call_cap + i)) );
    } else {
        lines.push( ...frames.map(fmt) );
    }
    return lines;
}
```

- [ ] **Step 4: Update ERR printing in `src/index.ts`**

Replace line 100 (`proc.expr_stack.reverse().forEach(...)`) with:

```ts
            proc.trace.forEach((line) => console.log(line));
```

- [ ] **Step 5: Build and run the trace tests**

```bash
npm run build
node js/tests/300-trace-test.js
```

Expected: build succeeds; test prints `# 1M tail calls in <ms>ms` (expect low thousands) and `ok - trace tests passed`.

- [ ] **Step 6: Commit**

```bash
git add src/konts.ts src/strand.ts src/debug.ts src/index.ts tests/300-trace-test.ts
git commit -m "kont-chain error traces, remove expr_stack

ScopeExit now carries call+args; traces are rendered at halt time by
walking the ERR kont chain. Removes the per-eval/per-apply marker
allocations and the O(stack) depth reduce that made tail loops quadratic.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Regression and performance verification

**Files:**
- No changes; runs the suite built in Task 2 against the Task 1 baselines.

**Interfaces:**
- Consumes: baselines in `/tmp/baseline-*.txt` from Task 1; the built `js/` tree from Task 2.
- Produces: verified branch ready for merge.

- [ ] **Step 1: Existing unit tests**

```bash
node js/tests/050-env-test.js
node js/tests/200-env-test.js
```

Expected: same `ok - ...` output as `/tmp/baseline-050.txt` / `/tmp/baseline-200.txt`.

- [ ] **Step 2: Self-test diff**

```bash
npm run self-test > /tmp/after-selftest.txt 2>&1
diff <(grep -v 'tests:' /tmp/baseline-selftest.txt) <(grep -v 'tests:' /tmp/after-selftest.txt)
```

Expected: no diff (the `tests:` timing line is excluded; step counts may legitimately shrink slightly if any self-test errors intentionally — if the diff shows only `step(s)` count changes on ERR processes, that is acceptable; any HALT result change is a regression).

- [ ] **Step 3: Examples diff**

```bash
node js/bin/slight.js examples/active-objects.slight > /tmp/after-active-objects.txt 2>&1
node js/bin/slight.js examples/ping-pong.slight > /tmp/after-ping-pong.txt 2>&1
diff <(grep -v 'slight-run' /tmp/baseline-active-objects.txt) <(grep -v 'slight-run' /tmp/after-active-objects.txt)
diff <(grep -v 'slight-run' /tmp/baseline-ping-pong.txt) <(grep -v 'slight-run' /tmp/after-ping-pong.txt)
```

Expected: no diff (timing lines excluded).

- [ ] **Step 4: Tail-loop timing spot-check**

```bash
cat > /tmp/tco-timing.slight <<'EOF'
(defun tail-call-demo (n)
    (if (== n 0) :done
       (tail-call-demo (- n 1))))
(pprint (tail-call-demo 1000000))
EOF
node js/bin/slight.js /tmp/tco-timing.slight
```

Expected: `done` and `slight-run:` around 2s (pre-change: 40k took 33s; 1M was unrunnable).

- [ ] **Step 5: Bench comparison (skip if Task 1 bench failed)**

```bash
npm run bench > /tmp/after-bench.txt 2>&1
tail -20 /tmp/baseline-bench.txt
tail -20 /tmp/after-bench.txt
```

Expected: steps/s equal or better than baseline (marker allocations removed from the hot path). Record both numbers in the final report. A regression here is a stop-and-investigate.

- [ ] **Step 6: Error-output smoke test (human-readable trace)**

```bash
cat > /tmp/trace-demo.slight <<'EOF'
(defun boom (x) (car x))
(defun middle (x) (+ 1 (boom x)))
(defun top (x) (+ 1 (middle x)))
(top 42)
EOF
node js/bin/slight.js /tmp/trace-demo.slight
```

Expected: `PID[1]  ERRORED: ` with the raise message, followed by `in ...` context lines and numbered call frames `(boom 42)`, `(middle 42)`, `(top 42)` innermost-first.

- [ ] **Step 7: Merge decision**

Use the superpowers:finishing-a-development-branch skill to merge `kont-chain-traces` back to `main` (or open a PR, per user preference).
