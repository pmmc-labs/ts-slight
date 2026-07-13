# Env Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-frame `Map` envs with linearly-scanned rib (assoc-list) frames above Map-backed root layers, and give `fork` an O(1) env snapshot so parent bindings made after fork no longer leak to the child.

**Architecture:** `Env` becomes a discriminated union: `MapEnv` ('MENV') for the three root layers (@ARGV root, builtins, top-level defuns) and `RibEnv` ('RENV') for every local frame (spawn locals, lambda applications, `let`s). Ribs have a mutable `head` pointer to an immutable node chain; `bind` prepends, `lookup` scans. `snapshotEnv` at fork pins the child to the fork-time head via structural sharing.

**Tech Stack:** TypeScript 5.9 (strict, ESM, `.ts` import extensions), compiled via `tsc` to `js/`, Node >= 23. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-env-refactor-design.md`

## Global Constraints

- Run all commands from the repo root (`main()`/`prove()` load `./lib/Prelude.slight` relative to cwd).
- Never edit anything under `js/` — it is `tsc` output, rebuilt by every npm script.
- Match existing code style: 4-space indent, spaces inside braces (`{ type : 'MENV', ... }`), `let` over `const`, discriminated unions with string `type` tags.
- The test harness has no failing exit code: verify by TAP output. A passing run has **zero** `not ok` lines and no `# looks like you failed` line.
- Semantics constraint from the spec: only the innermost frame of a process is ever written (`DEFINE` targets `kont.env`; `bindParams` always makes a fresh frame). Do not add any code path that writes a non-innermost frame.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

- `examples/fib.slight` — **create** (Task 1): pure-compute benchmark used as the step-rate regression guard.
- `src/terms.ts` — **modify** (Tasks 2, 3): env types, `newMapEnv`/`newRibEnv`, `bind`, `lookup`, `bindParams`, `snapshotEnv`, `isEnv`, `pprint`.
- `src/builtins.ts` — **modify** (Task 2): `initalizeEnv` builds a `MapEnv`.
- `src/index.ts` — **modify** (Task 2): root env becomes `newMapEnv`.
- `src/strand.ts` — **modify** (Tasks 2, 3): defun layer becomes `newMapEnv`; `spawnProcess` builds a `RibEnv` (Task 2) over a snapshot (Task 3).
- `tests/050-env-test.ts` — **create** (Tasks 2, 3): TS-level unit tests for the env ops.
- `tests/200-env-test.ts` — **create** (Task 3): slight-level tests (fork isolation, shadowing, deep lookup) via `prove`.
- `NOTES.md` — **modify** (Task 3): mark the env-sharing leak resolved.
- `src/konts.ts`, `src/parser.ts`, `src/syscalls.ts` — untouched (konts.ts only imports the `Env` type name, which survives).

---

### Task 1: Baseline benchmarks + fib example

**Files:**
- Create: `examples/fib.slight`
- Temporarily edit (restored): `examples/erlang-challange.slight`

**Interfaces:**
- Consumes: nothing.
- Produces: `examples/fib.slight` (used again in Task 4), and recorded baseline numbers that Task 4 compares against.

- [ ] **Step 1: Create the fib benchmark example**

Create `examples/fib.slight`:

```lisp
(defun fib (n)
    (if (< n 2) n
        (+ (fib (- n 1)) (fib (- n 2)))))

(time-it "fib")
(sys/io/print-ln "fib(27) = " (fib 27))
(time-it/end "fib")

;; -----------------------------------------------------------------------------
;; Timings (fib 27, compiled js, this machine)
;; -----------------------------------------------------------------------------
;; before env refactor : <fill in from Task 1>
;; after  env refactor : <fill in from Task 4>
;; -----------------------------------------------------------------------------
```

- [ ] **Step 2: Run it and record the baseline**

Run: `npm run build && node js/bin/slight.js examples/fib.slight`

Expected output shape:

```
fib(27) = 196418
fib: <N>ms
slight-run: <N>ms
```

Replace `<fill in from Task 1>` in the comment block with the `fib:` time. Run it three times and record the middle value.

- [ ] **Step 3: Record the actor-ladder baseline at 1M**

```bash
sed -i '' 's/(let actor-count 5000000)/(let actor-count 1000000)/' examples/erlang-challange.slight
node js/bin/slight.js examples/erlang-challange.slight
git checkout -- examples/erlang-challange.slight
```

Expected output shape (record `setup:`, `start:`, `slight-run:`):

```
INIT with 1000000 actors
READY
setup: <N>s
START
start: <N>s
ALL DONE: 1000000 at PID[2]
slight-run: <N>s
```

Report the three numbers in your task report — they are the Task 4 comparison baseline. (Compiled js may differ slightly from the ts-node numbers in the example's comment history; that is why we capture a fresh baseline.)

- [ ] **Step 4: Commit**

```bash
git add examples/fib.slight
git commit -m "add fib example as step-rate benchmark, record pre-refactor baseline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rib representation swap (semantics-preserving)

**Files:**
- Modify: `src/terms.ts:16-18` (types), `src/terms.ts:38` (`isEnv`), `src/terms.ts:87-118` (`newEnv`/`bind`/`lookup`/`bindParams`), `src/terms.ts:164` (`pprint` ENV case)
- Modify: `src/builtins.ts:98-99` (`initalizeEnv` head)
- Modify: `src/index.ts:41-43` (`main` root env), `src/index.ts:69` (`prove` env)
- Modify: `src/strand.ts:144-146` (`spawnProcess`), `src/strand.ts:210-211` (`run` signature + defun layer), imports at `src/strand.ts:2-8`
- Create: `tests/050-env-test.ts`

**Interfaces:**
- Consumes: existing `Sym`, `TERM`, `LIST`, `raise`, `pprint` from `src/terms.ts`.
- Produces (Task 3 and all of `src/` rely on these exact names):
  - `type RibNode = { name : string, value : TERM, next : RibNode | undefined }`
  - `type MapEnv = { type : 'MENV', bindings : Map<string,TERM>, parent : MapEnv | undefined }`
  - `type RibEnv = { type : 'RENV', head : RibNode | undefined, parent : Env }`
  - `type Env = MapEnv | RibEnv`
  - `newMapEnv(parent? : MapEnv) : MapEnv`
  - `newRibEnv(parent : Env) : RibEnv`
  - `bind<E extends Env>(name : Sym, value : TERM, env : E) : E` (mutates; MENV sets the Map, RENV prepends a node)
  - `lookup(name : Sym, env : Env) : TERM` (ERROR term when unbound)
  - `bindParams(params : LIST, args : LIST, env : Env) : RibEnv | ERROR`
  - `initalizeEnv(core? : MapEnv) : MapEnv`
  - `Strand.run(exprs : TERM[], env : MapEnv)`
  - `newEnv` is **deleted** — nothing may import it after this task.

- [ ] **Step 1: Write the failing unit test**

Create `tests/050-env-test.ts`:

```ts
import assert from 'node:assert';
import {
    sym, num, list,
    newMapEnv, newRibEnv, bind, lookup, bindParams,
    isError, isEnv,
} from '../src/index.ts';

// map layer: bind and lookup
let root = newMapEnv();
bind( sym('x'), num(1), root );
assert.deepEqual( lookup(sym('x'), root), num(1), 'MENV bind/lookup' );

// map layers chain: defuns layer over builtins layer
let defuns = newMapEnv(root);
bind( sym('f'), num(99), defuns );
assert.deepEqual( lookup(sym('f'), defuns), num(99), 'MENV local hit' );
assert.deepEqual( lookup(sym('x'), defuns), num(1),  'MENV parent fallthrough' );

// rib frame over map: local hit and fallthrough
let frame = newRibEnv(defuns);
bind( sym('y'), num(2), frame );
assert.deepEqual( lookup(sym('y'), frame), num(2), 'RENV local hit' );
assert.deepEqual( lookup(sym('x'), frame), num(1), 'RENV -> MENV fallthrough' );

// shadowing: re-bind prepends, newest node wins
bind( sym('y'), num(3), frame );
assert.deepEqual( lookup(sym('y'), frame), num(3), 'newest rib node wins' );

// unbound name -> ERROR term (not a throw)
assert.ok( isError( lookup(sym('nope'), frame) ), 'unbound is ERROR' );

// bindParams builds a rib frame directly
let params = list( sym('a'), sym('b') );
let callf  = bindParams( params, list( num(10), num(20) ), defuns );
assert.ok( !isError(callf), 'bindParams ok' );
if (!isError(callf)) {
    assert.equal( callf.type, 'RENV', 'bindParams returns a rib frame' );
    assert.deepEqual( lookup(sym('a'), callf), num(10) );
    assert.deepEqual( lookup(sym('b'), callf), num(20) );
    assert.deepEqual( lookup(sym('x'), callf), num(1), 'params frame falls through' );
    assert.ok( isEnv(callf) );
}

// arity mismatches still return ERROR
assert.ok( isError( bindParams( params, list(num(1)), defuns ) ),                 'missing arg' );
assert.ok( isError( bindParams( params, list(num(1), num(2), num(3)), defuns ) ), 'extra arg' );

console.log('ok - env unit tests passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build`

Expected: FAIL — `tsc` errors that `src/index.ts` (re-exporting `src/terms.ts`) has no exported member `newMapEnv` / `newRibEnv`.

- [ ] **Step 3: Replace the Env types and ops in `src/terms.ts`**

Replace line 16 (`export type Env = { type : 'ENV', ... }`) with:

```ts
export type RibNode  = { name : string, value : TERM, next : RibNode | undefined }
export type MapEnv   = { type : 'MENV', bindings : Map<string,TERM>, parent : MapEnv | undefined }
export type RibEnv   = { type : 'RENV', head : RibNode | undefined,  parent : Env }
export type Env      = MapEnv | RibEnv
```

Replace `isEnv` (line 38) with:

```ts
export function isEnv (t : TERM) : t is Env  { return t.type == 'MENV' || t.type == 'RENV' }
```

Replace `newEnv`, `bind`, `lookup`, `bindParams` (lines 87–118) with:

```ts
export function newMapEnv (parent : MapEnv | undefined = undefined) : MapEnv {
    return { type : 'MENV', bindings : new Map<string,TERM>(), parent }
}

export function newRibEnv (parent : Env) : RibEnv {
    return { type : 'RENV', head : undefined, parent }
}

// NOTE: mutates env in place -- MENV overwrites the Map entry, RENV
// prepends a node (a re-bind shadows; lookup finds the newest first)
export function bind<E extends Env> (name : Sym, value : TERM, env : E) : E {
    if (env.type == 'MENV') {
        env.bindings.set( name.ident, value );
    } else {
        env.head = { name : name.ident, value, next : env.head };
    }
    return env;
}

export function lookup (name : Sym, env : Env) : TERM {
    let ident = name.ident;
    let e : Env | undefined = env;
    while (e != undefined) {
        if (e.type == 'RENV') {
            let node = e.head;
            while (node != undefined) {
                if (node.name == ident) return node.value;
                node = node.next;
            }
        } else {
            let found = e.bindings.get(ident);
            if (found !== undefined) return found;
        }
        e = e.parent;
    }
    return raise(`Unable to find ${name.ident} in Env`);
}

export function bindParams (params : LIST, args : LIST, env : Env) : RibEnv | ERROR {
    let head : RibNode | undefined = undefined;
    while (!isNil(params)) {
        if (isNil(args))          return raise(`ARITY MISMATCH! missing ${pprint(params)} parameter`);
        if (!isSym(params.first)) return raise(`Expected parameter to be a symbol, wtf!`);
        head   = { name : params.first.ident, value : args.first, next : head };
        params = params.rest;
        args   = args.rest;
    }
    if (!isNil(args)) return raise(`ARITY MISMATCH! got extra args ${pprint(args)}`);
    return { type : 'RENV', head, parent : env };
}
```

Replace the `isEnv` case in `pprint` (line 164) with:

```ts
    case isEnv(t)     : {
        if (t.type == 'MENV') return `{MENV[${t.bindings.size}] ${t.parent ? pprint(t.parent) : '~'}}`;
        let names = [];
        for (let n = t.head; n != undefined; n = n.next) names.push(n.name);
        return `{RENV(${names.join(' ')}) ${pprint(t.parent)}}`;
    }
```

- [ ] **Step 4: Update `src/builtins.ts`**

Replace the head of `initalizeEnv` (lines 98–99):

```ts
export function initalizeEnv (core : MapEnv | undefined = undefined) : MapEnv {
    let env : MapEnv = newMapEnv( core );
```

Update the import at the top: replace `newEnv` with `newMapEnv` and add `MapEnv` to the type imports. The `env = bind( sym(...), ..., env )` chains need no changes (generic `bind` returns `MapEnv`).

- [ ] **Step 5: Update `src/index.ts`**

In `main()` (lines 41–43), replace `newEnv()`:

```ts
    let env = newMapEnv();
    env = bind( sym('@ARGV'), list( ...process.argv.slice(3).map((arg) => str(arg)) ), env );
    env = initalizeEnv( env );
```

Update the import: `newEnv` → `newMapEnv`. `prove()` needs no changes (`initalizeEnv()` already returns the right thing).

- [ ] **Step 6: Update `src/strand.ts`**

Imports (lines 2–8): replace `newEnv` with `newMapEnv, newRibEnv`; add `MapEnv` to the type imports.

`run` (lines 210–211):

```ts
    async run (exprs : TERM[], env : MapEnv) : Promise<Process[]> {
        env = newMapEnv( env ); // for the (defun)s
```

`spawnProcess` (line 146):

```ts
        let local = newRibEnv( env );
```

- [ ] **Step 7: Build and run the unit test**

Run: `npm run build && node js/tests/050-env-test.js`
Expected: `ok - env unit tests passed`

- [ ] **Step 8: Run the full self-test**

Run: `node js/tests/100-self-test.js | grep -cE "not ok|looks like you failed"`
Expected: `0` (grep exits 1 with count 0 — that is the pass condition)

Also eyeball the tail of `node js/tests/100-self-test.js`: it must end with the `1..<N>` plan line and a `tests:` timing, no `# looks like you failed`.

- [ ] **Step 9: Commit**

```bash
git add src/terms.ts src/builtins.ts src/index.ts src/strand.ts tests/050-env-test.ts
git commit -m "env: rib frames over Map root layers

Local frames become linearly-scanned assoc lists (RENV); the three
root layers (@ARGV, builtins, defuns) stay Map-backed (MENV).
Semantics preserved: bind mutates the innermost frame in place.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Fork-time env snapshot

**Files:**
- Modify: `src/terms.ts` (add `snapshotEnv` after `newRibEnv`)
- Modify: `src/strand.ts` (`spawnProcess`, plus import)
- Modify: `tests/050-env-test.ts` (append snapshot unit tests)
- Create: `tests/200-env-test.ts`
- Modify: `NOTES.md` (env-sharing section)

**Interfaces:**
- Consumes: `RibEnv`, `Env`, `newRibEnv`, `bind`, `lookup` from Task 2 (exact signatures above).
- Produces: `snapshotEnv(env : Env) : Env` — RENV in, fresh RibEnv sharing `head`/`parent` out; MENV returned as-is.

- [ ] **Step 1: Write the failing slight-level test**

Create `tests/200-env-test.ts`:

```ts
import { prove } from '../src/index.ts';

prove(`

    ;; fork isolation: a parent (let) after fork must not leak to the child.
    ;; The child does not run until the parent blocks on join, so the
    ;; rebinding always happens before the child reads iso-x.
    (let iso-x 1)
    (let iso-pid (fork iso-x))
    (let iso-x 2)

    ;; deep lookup: locals, enclosing frames, and builtins
    (defun make-add3 (a) (lambda (b) (lambda (c) (+ a (+ b c)))))

    ;; shadowing within one scope: newest binding wins
    (let sh 1)
    (let sh (+ sh 10))

(run-tests (list
    (diag "env semantics")

    (is (join iso-pid) 1 "... child sees the fork-time binding, not the later one")
    (is iso-x 2          "... parent sees its own rebinding")

    (is (((make-add3 1) 2) 3) 6 "... nested lambda frames resolve through the chain")

    (is sh 11 "... re-let shadows, newest binding wins")
))

`).catch((e) => {
    console.error(String(e));
    process.exit(1);
});
```

- [ ] **Step 2: Run it to verify the isolation test fails**

Run: `npm run build && node js/tests/200-env-test.js`

Expected: the first test FAILS (this is today's leak — the child sees `2`):

```
not ok 1 - ... child sees the fork-time binding, not the later one
#        got: 2
#   expected: 1
```

and the remaining three tests pass.

- [ ] **Step 3: Add `snapshotEnv` to `src/terms.ts`**

After `newRibEnv`:

```ts
// O(1) fork-time snapshot: shares the node chain, pins the head.
// The parent keeps prepending to its own live head; the snapshot
// never sees those. MENV layers are only written before processes
// run, so they are safe to share as-is.
export function snapshotEnv (env : Env) : Env {
    if (env.type == 'MENV') return env;
    return { type : 'RENV', head : env.head, parent : env.parent };
}
```

- [ ] **Step 4: Use it in `spawnProcess` (src/strand.ts)**

Add `snapshotEnv` to the terms import, then:

```ts
        let local = newRibEnv( snapshotEnv(env) );
```

- [ ] **Step 5: Append snapshot unit tests**

Append to `tests/050-env-test.ts` (before the final `console.log`), and add `snapshotEnv` to its import list:

```ts
// snapshot: pinned head, parent keeps moving
let live = newRibEnv(root);
bind( sym('s'), num(1), live );
let snap = snapshotEnv(live);
bind( sym('s'), num(2), live );
assert.deepEqual( lookup(sym('s'), live), num(2), 'live env sees the re-bind' );
assert.deepEqual( lookup(sym('s'), snap), num(1), 'snapshot is pinned at fork time' );

// snapshot of a map layer is the layer itself
assert.equal( snapshotEnv(root), root, 'MENV snapshot is identity' );
```

- [ ] **Step 6: Build and run both test files**

Run: `npm run build && node js/tests/050-env-test.js && node js/tests/200-env-test.js`

Expected: `ok - env unit tests passed`, then all four slight tests `ok`, ending `1..4` with no `not ok` lines.

- [ ] **Step 7: Run the full self-test**

Run: `node js/tests/100-self-test.js | grep -cE "not ok|looks like you failed"`
Expected: `0`

- [ ] **Step 8: Update NOTES.md**

In the "### Env sharing" section of `NOTES.md`, insert this line directly after the heading line (`### Env sharing. Since you've confirmed...`), keeping the options text below it for history:

```markdown
RESOLVED 2026-07-13: rib envs + snapshotEnv at fork (structural sharing,
O(1)) — see docs/superpowers/specs/2026-07-13-env-refactor-design.md.
Remaining known hole: a lambda created pre-fork and invoked in the child
reads the parent's live frame (fixing that needs persistent envs).
```

- [ ] **Step 9: Commit**

```bash
git add src/terms.ts src/strand.ts tests/050-env-test.ts tests/200-env-test.ts NOTES.md
git commit -m "env: O(1) snapshot at fork fixes post-fork binding leak

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Post-refactor benchmarks

**Files:**
- Modify: `examples/fib.slight` (fill in the "after" timing)
- Temporarily edit (restored): `examples/erlang-challange.slight`

**Interfaces:**
- Consumes: baseline numbers recorded in Task 1 (fib time; 1M-actor setup/start/total).
- Produces: the pass/fail verdict on the spec's success criteria, and the answer to the spec's open question (does 5M fit in the default heap?).

- [ ] **Step 1: fib step-rate check**

Run: `npm run build && node js/bin/slight.js examples/fib.slight` (three times, take the middle `fib:` value)

Expected: within a few percent of the Task 1 baseline — **equal or faster**. The spec's criterion: a regression of more than a few percent fails the task; report it rather than rationalizing it.

Fill the `after env refactor :` line in `examples/fib.slight` with the result.

- [ ] **Step 2: Actor ladder at 1M**

```bash
sed -i '' 's/(let actor-count 5000000)/(let actor-count 1000000)/' examples/erlang-challange.slight
node js/bin/slight.js examples/erlang-challange.slight
git checkout -- examples/erlang-challange.slight
```

Expected: `setup:`/`start:`/`slight-run:` at or below the Task 1 baseline. Report all three against baseline.

- [ ] **Step 3: The open question — 5M on the default heap**

Run (note: default heap, no `--max-old-space-size`):

```bash
node js/bin/slight.js examples/erlang-challange.slight
```

Expected: either `ALL DONE: 5000000 at PID[2]` (the footprint win closed the gap) or an OOM crash (it didn't). Both are valid findings — record which, plus the timings if it completes.

- [ ] **Step 4: Commit and report**

```bash
git add examples/fib.slight
git commit -m "record post-env-refactor benchmark results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Report: fib before/after, 1M ladder before/after, and the 5M-default-heap verdict.

---

## Self-Review Notes

- Spec coverage: types/ops/call-sites (Task 2), snapshot + fork fix (Task 3), all three spec tests (050 covers shadowing+deep-lookup at unit level, 200 covers all three at slight level), fib + ladder benchmarks incl. the 5M open question (Tasks 1, 4). Non-goals untouched.
- The fork-isolation test's determinism argument (child cannot run before the parent blocks on `join`, because fork no longer yields the parent and the parent's segment is far under the 10k-step quota) is stated in the test's comment.
- `newEnv` deletion is deliberate and stated in Task 2's Produces block so no stale import survives.
