# Async Syscalls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `(syscall '<name> args ...)` — processes park on a JS Promise and resume with its result while the scheduler keeps running other processes on the JS event loop.

**Architecture:** The synchronous `run()` loop becomes an async three-branch loop (work / waiting-on-host / settled) that hops the macrotask queue once per scheduler slice. A `SYSCALL` variant of `WaitFor` parks the caller under a unique `sys:<n>` wait key; the promise's `.then`/`.catch` feed the existing `deliver`/`deliverFault` wake paths. `step()` and `kontinue()`'s existing cases do not change.

**Tech Stack:** TypeScript run directly with `node` (v23 type stripping). No test framework — verification is scratchpad probes (source-substituted copies of the interpreter) plus a baseline diff of the built-in test suite.

**Spec:** `docs/superpowers/specs/2026-07-10-async-syscalls-design.md`

## Global Constraints

- All interpreter work happens in the single file `tests/001-basic.ts` — the file IS the project (per NOTES.md, "the TS file is the executable spec"). Do not split it.
- The hop must be a **macrotask** (`setImmediate`) — never `Promise.resolve()` (microtasks don't turn the event loop) and never `setTimeout(0)` (clamps to ~1ms).
- Never idle-spin on the hop; idle waiting uses the wake signal.
- The deadlock sweep may only run when `running` is empty AND `inflight` is zero. The `else if` ordering in `run()` encodes this — preserve it.
- **Commits are performed by the user.** Do not run `git commit`. Each task ends at a verified checkpoint; report and pause there.
- No `timeout` command exists on this macOS — don't use it in verification commands.
- Match the file's existing style: spaces inside parens in signatures (`foo (a : T) : R`), aligned type annotations, factory functions named after their types.

## File Structure

- Modify: `tests/001-basic.ts` — all interpreter changes.
- Create (scratchpad, NOT committed): `<scratchpad>/probe.py` — probe harness; `<scratchpad>/*.sl` — probe programs; `<scratchpad>/baseline.txt` — pre-change suite output.

Where steps say `<scratchpad>`, use the session scratchpad directory (an isolated temp dir), creating files with absolute paths.

---

### Task 1: Behavior-preserving `run()` refactor — extract `park` and `sweepDeadlocked`

**Files:**
- Modify: `tests/001-basic.ts` (the `run` method, currently ~lines 605–673)
- Create: `<scratchpad>/probe.py`, `<scratchpad>/baseline.txt`

**Interfaces:**
- Consumes: existing `Strand` methods `step`, `haltProcess`, `yieldProcess`, `blockProcess`, `awaitKey`, `enqueueProcess`, `mailKey`.
- Produces: `private park (proc : Process) : void` and `private sweepDeadlocked () : void` — Task 2 rebuilds the loop around them, Task 3 adds a `SYSCALL` arm inside `park`.

- [ ] **Step 1: Capture the baseline**

```bash
node tests/001-basic.ts 2>/dev/null | grep -v '\.\.\.run' > <scratchpad>/baseline.txt
cat <scratchpad>/baseline.txt
```

Expected: the `DONE:` group with `TOTAL`, `HALT`, `ERROR` counts (the `...run` timing line is stripped because it varies). Keep this file — every task diffs against it.

- [ ] **Step 2: Write the probe harness**

Create `<scratchpad>/probe.py`:

```python
#!/usr/bin/env python3
# usage: python3 probe.py <program.sl> [env DEBUG=1 for step traces]
# Patches a copy of tests/001-basic.ts: swaps in the program source and
# forces the per-process DONE report on (normally DEBUG-only).
import sys, pathlib, re, subprocess

root = pathlib.Path('/Users/stevan/Projects/runtimes/ts-slight')
src  = (root / 'tests/001-basic.ts').read_text()
prog = pathlib.Path(sys.argv[1]).read_text()

anchor = 'let source = ``;'
assert anchor in src, 'source anchor not found'
src = src.replace(anchor, 'let source = `' + prog + '`;')

# force the per-process DONE report on; regex tolerates the indentation
# this block gains when Task 2 wraps the driver in async main()
report = re.compile(r"console\.group\('DONE:'\);\s*\n(\s*)if \(DEBUG\) \{")
assert report.search(src), 'report anchor not found'
src = report.sub(lambda m: f"console.group('DONE:');\n{m.group(1)}if (true) {{", src, count=1)

out = pathlib.Path(sys.argv[1]).with_suffix('.probe.ts')
out.write_text(src)
r = subprocess.run(['node', str(out)], capture_output=True, text=True)
print(r.stdout, end='')
if r.returncode != 0:
    print(r.stderr, file=sys.stderr, end='')
sys.exit(r.returncode)
```

Sanity-check it before any interpreter change — create `<scratchpad>/smoke.sl`:

```lisp
(pprint (+ 1 2))
```

```bash
cd <scratchpad> && python3 probe.py smoke.sl
```

Expected: `3`, then `PID[1]  HALTED:  ()` inside the `DONE:` group (pprint returns nil).

- [ ] **Step 3: Extract `park` and `sweepDeadlocked`**

In `tests/001-basic.ts`, add two private methods to `Strand` directly above `run` (after `spawnProcess`). Their bodies are the existing code moved verbatim from `run`'s inner loop and sweep, with braces added around the BLOCK case:

```typescript
    private park (proc : Process) : void {
        switch (proc.kont.type) {
        case 'ERR'   :
        case 'HALT'  :
            this.haltProcess(proc);
            break;
        case 'YIELD' :
            this.yieldProcess(proc);
            break;
        case 'BLOCK' : {
            let wait = proc.kont.on;
            if (wait === undefined) throw new Error(`Expected wait target from BLOCK, got undefined`);
            if (wait.target == 'JOIN') {
                this.blockProcess( wait.pid, proc );
            } else {
                this.awaitKey( mailKey(proc.mailbox.id), proc );
            }
            break;
        }
        default:
            if (DEBUG) console.log(`!!!! : Quota exhausted for ${ pprint(proc.pid) }, refilling`);
            this.enqueueProcess(proc);
        }
    }

    private sweepDeadlocked () : void {
        let procs = [ ...this.blocked.values() ].flat();
        this.blocked.clear();
        procs.forEach((p) => {
            p.kont = RaiseError('DEADLOCKED!', p.kont);
            this.enqueueProcess(p);
        });
    }
```

Then replace `run`'s entire `while (true) { ... }` loop (everything between `let init_pid = this.spawnProcess( to_run, env, undefined );` and `return [ ...this.halted.values() ];`) with:

```typescript
        while (true) {
            if (this.running.length > 0) {
                let proc = this.running.pop()!;
                if (DEBUG) console.log(`>>>> : Switching to ${ pprint(proc.pid) }`);
                this.step(proc, this.DEFAULT_QUOTA);
                this.park(proc);
            } else if (this.blocked.size > 0) {
                this.sweepDeadlocked();
            } else {
                break;
            }
        }
```

Note the shape change: the old nested `while (this.running.length > 0)` disappears — the outer loop drains one process per iteration. The old code reassigned `proc = this.step(...)`; `step` mutates `proc.kont` in place and returns the same object, so the reassignment was cosmetic and is dropped.

- [ ] **Step 4: Verify no behavior change**

```bash
node tests/001-basic.ts 2>/dev/null | grep -v '\.\.\.run' | diff <scratchpad>/baseline.txt -
```

Expected: no output (exit 0). Also run the actor example through the probe — create `<scratchpad>/evenodd-check.sl` with the full contents of `examples/even-odd-actors.slight` (copy the file), then:

```bash
cd <scratchpad> && cp /Users/stevan/Projects/runtimes/ts-slight/examples/even-odd-actors.slight evenodd-check.sl && python3 probe.py evenodd-check.sl
```

Expected: the four answers line prints `((IT-IS-EVEN!) (IT-IS-EVEN!) (IT-IS-ODD!) (IT-IS-EVEN!))` (order per the example's sends: 100 even, 36 even, 57 odd, 92 even), all processes `HALTED`, none `ERRORED`.

- [ ] **Step 5: Checkpoint** — report the diff result and pause for user review. Do not commit.

---

### Task 2: Async run loop — `hop`, wake signal, `inflight`, async `main`

**Files:**
- Modify: `tests/001-basic.ts` (`Strand` fields, `enqueueProcess`, `run`, and the top-level driver ~lines 1003–1025)

**Interfaces:**
- Consumes: `park`, `sweepDeadlocked` from Task 1.
- Produces: `async run (exprs : TERM[], env : Env) : Promise<Process[]>`; private field `inflight : number` and method `sleepUntilWoken () : Promise<void>` — Task 3's syscall dispatch increments/decrements `inflight` and relies on `enqueueProcess` firing the wake signal.

- [ ] **Step 1: Add the scheduler async plumbing**

In `Strand`, next to the other private fields (`PID_SEQ` etc.):

```typescript
    private inflight = 0;
    private wake : (() => void) | undefined;
```

Add two private methods beside `enqueueProcess`:

```typescript
    private hop () : Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    private sleepUntilWoken () : Promise<void> {
        return new Promise((resolve) => this.wake = resolve);
    }
```

Modify `enqueueProcess` to fire the wake signal:

```typescript
    private enqueueProcess (proc : Process) : void {
        this.running.unshift(proc);
        if (this.wake != undefined) {
            this.wake();
            this.wake = undefined;
        }
    }
```

- [ ] **Step 2: Make `run` async with the three-branch loop**

Change the signature to `async run (exprs : TERM[], env : Env) : Promise<Process[]>` and the loop (from Task 1) to:

```typescript
        while (true) {
            if (this.running.length > 0) {
                let proc = this.running.pop()!;
                if (DEBUG) console.log(`>>>> : Switching to ${ pprint(proc.pid) }`);
                this.step(proc, this.DEFAULT_QUOTA);
                this.park(proc);
                await this.hop();
            } else if (this.inflight > 0) {
                await this.sleepUntilWoken();
            } else if (this.blocked.size > 0) {
                this.sweepDeadlocked();
            } else {
                break;
            }
        }
```

The branch order is load-bearing: the sweep is unreachable while any syscall is in flight, which is the deadlock-soundness guarantee from the spec.

- [ ] **Step 3: Wrap the driver in an async `main`**

The file has no `package.json`, so `node` treats it as CommonJS — no top-level await. Replace the driver block (from `let strand = new Strand();` through `console.groupEnd();`) with the same code wrapped:

```typescript
async function main () {
    let strand = new Strand();

    console.time('...run');
    let halted = await strand.run(exprs, env);
    console.timeEnd('...run');

    console.group('DONE:');
    if (DEBUG) {
        for (const proc of halted) {
            if (proc.kont.type == 'HALT') {
                console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
            } else if (proc.kont.type == 'ERR') {
                console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
            } else {
                console.log(pprint(proc.pid), ' WTF! is this?', proc);
            }
        }
    } else {
        console.log("TOTAL : ", halted.length);
        console.log("HALT  : ", halted.filter((p) => p.kont.type == 'HALT').length);
        console.log("ERROR : ", halted.filter((p) => p.kont.type == 'ERR').length);
    }
    console.groupEnd();
}

main();
```

(The inner code is byte-identical to what it wraps; only indentation and the `await` change. `exprs` and `env` remain module-level and are closed over. The probe harness's report anchor is a regex that tolerates the new indentation — confirm by running the smoke probe in Step 4.)

- [ ] **Step 4: Verify behavior unchanged**

```bash
node tests/001-basic.ts 2>/dev/null | grep -v '\.\.\.run' | diff <scratchpad>/baseline.txt -
cd <scratchpad> && python3 probe.py smoke.sl && python3 probe.py evenodd-check.sl
```

Expected: empty diff; smoke prints `3`; even/odd prints the same four answers as Task 1. Also verify the deadlock sweep still fires — create `<scratchpad>/selfjoin.sl`:

```lisp
(pprint 'before)
(join $$)
```

```bash
cd <scratchpad> && python3 probe.py selfjoin.sl
```

Expected: `before`, then `PID[1]  ERRORED:  E!DEADLOCKED!`.

- [ ] **Step 5: Perf spot-check the hop cost**

Create `<scratchpad>/fib24.sl`:

```lisp
(defun fib (n)
    (if (< n 2)
        n
        (+ (fib (- n 1)) (fib (- n 2)))))
(pprint (fib 24))
```

```bash
cd <scratchpad> && python3 probe.py fib24.sl && python3 probe.py fib24.sl && python3 probe.py fib24.sl
```

Expected: `46368` each run, with the `...run:` timing line in the probe output (`console.time` writes to stdout, which the probe passes through). Baseline measured 2026-07-10 pre-change: ~205–210ms. Acceptance: ≤ ~230ms (hop adds ~5.7k `setImmediate` round-trips ≈ single-digit ms). If it's 2× baseline, something is wrong (most likely `setTimeout` clamping snuck in) — stop and investigate.

- [ ] **Step 6: Checkpoint** — report diff + timings, pause for user review. Do not commit.

---

### Task 3: The `syscall` special form, table, and dispatch

**Files:**
- Modify: `tests/001-basic.ts` — `WaitFor` type (~line 479), kont types/union/factories (~lines 358–470), `pprintKont` (~lines 390–409), key helpers (~line 474), `Strand` (`SYS_SEQ`, `dispatchSyscall`, `park`'s BLOCK arm), `kontinue` (`EVAL_EXPR` special forms ~line 752, new `SYSCALL` kont case beside `SEND` ~line 805), and the `SYSCALLS` table (module level, after `initalizeEnv`).

**Interfaces:**
- Consumes: `awaitKey`, `deliver`, `deliverFault`, `raise`, `inflight` (Task 2), `EvalArgs` machinery.
- Produces: the user-visible `(syscall '<name> args ...)` form; `const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>>` with a `'sleep'` entry.

- [ ] **Step 1: Write the failing probe first**

Create `<scratchpad>/sleep100.sl`:

```lisp
(pprint (syscall 'sleep 100))
```

```bash
cd <scratchpad> && python3 probe.py sleep100.sl
```

Expected NOW (before implementing): `PID[1]  ERRORED:  E!Unable to find syscall in Env` — `syscall` is just an unbound symbol today. This is the red step.

- [ ] **Step 2: Add the types, factory, key helper, and pprint case**

Next to `mailKey` (~line 475):

```typescript
function sysKey (n : number) : string { return `sys:${n}` }
```

Extend `WaitFor`:

```typescript
type WaitFor =
    | { target : 'JOIN',    pid : Pid }
    | { target : 'RECV' }
    | { target : 'SYSCALL', name : string, args : TERM[] }
```

Add the kont type beside `Send` (~line 366), add `| Syscall` to the `Kontinue` union, and a factory beside `Send`'s (~line 455):

```typescript
type Syscall   = { type : 'SYSCALL'    } & Kontinuation
```

```typescript
function Syscall (env : Env, kont : Kontinue) : Syscall {
    return { type : 'SYSCALL', env, kont }
}
```

In `pprintKont`, add `case 'SYSCALL'   : break;` beside `case 'SEND'`, and update the BLOCK case so a syscall wait prints its target:

```typescript
    case 'BLOCK'      : kontStr += ` =: ${kont.on == undefined ? '' : (kont.on.target == 'JOIN' ? pprint(kont.on.pid) : kont.on.target)}`; break;
```

- [ ] **Step 3: Add the special form and the SYSCALL kont case**

In `kontinue`'s `EVAL_EXPR` special-form switch, beside `case 'send':`:

```typescript
                    case 'syscall':
                        return EvalArgs( tail, [], kont.env, Syscall( kont.env, kont.kont ) );
```

Add the kont case beside `case 'SEND':` (unique variable names — the switch cases share one scope):

```typescript
        case 'SYSCALL':
            if (returned == undefined) return RaiseError(`Expected args returned to SYSCALL, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to SYSCALL, got something else`, kont);
            let sys_args = uncons(returned);
            let sys_name = sys_args.shift();
            if (sys_name == undefined) return RaiseError(`syscall expects (syscall '<name> args ...)`, kont);
            if (!isSym(sys_name))      return RaiseError(`syscall expects a symbol name, got ${sys_name.type}`, kont);
            return Block( kont.env, kont.kont, { target : 'SYSCALL', name : sys_name.ident, args : sys_args } );
```

(Like RECV's Block and unlike JOIN's, this Block is returned directly from `kontinue` — it never receives a `returned` value, so the existing `BLOCK` kont case's pid-check path is untouched.)

- [ ] **Step 4: Add the table and scheduler dispatch**

Module level, after `initalizeEnv` (~line 352):

```typescript
// -----------------------------------------------------------------------------

const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>> = new Map();

SYSCALLS.set('sleep', (args : TERM[]) : Promise<TERM> => {
    let ms = args[0];
    if (ms == undefined || !isNum(ms)) return Promise.reject(`sleep expects (ms : NUM)`);
    return new Promise((resolve) => setTimeout(() => resolve(ms), ms.value));
});
```

In `Strand`, add `private SYS_SEQ = 0;` beside `CHAN_SEQ`, and beside `sendMessage`:

```typescript
    private dispatchSyscall (name : string, args : TERM[]) : Promise<TERM> {
        let sys = SYSCALLS.get(name);
        if (sys == undefined) return Promise.reject(`Unknown syscall '${name}'`);
        return sys(args);
    }
```

In `park`, replace the BLOCK arm's `if (wait.target == 'JOIN') ... else ...` with a switch:

```typescript
        case 'BLOCK' : {
            let wait = proc.kont.on;
            if (wait === undefined) throw new Error(`Expected wait target from BLOCK, got undefined`);
            switch (wait.target) {
            case 'JOIN':
                this.blockProcess( wait.pid, proc );
                break;
            case 'RECV':
                this.awaitKey( mailKey(proc.mailbox.id), proc );
                break;
            case 'SYSCALL': {
                let key = sysKey(++this.SYS_SEQ);
                this.awaitKey( key, proc );
                this.inflight++;
                this.dispatchSyscall(wait.name, wait.args)
                    .then((result) => { this.inflight--; this.deliver(key, result); })
                    .catch((e)     => { this.inflight--; this.deliverFault(key, raise(String(e))); });
                break;
            }
            }
            break;
        }
```

- [ ] **Step 5: Green the first probe, then run the behavior probes**

```bash
cd <scratchpad> && python3 probe.py sleep100.sl
```

Expected: `100`, `PID[1]  HALTED:  ()`. Then create and run each of the following (all under `<scratchpad>/`, run via `python3 probe.py <file>`):

`concurrent.sl` — timers fire during CPU-bound slices (spec probe 2):

```lisp
(defun spin (n)
    (if (== n 0)
        0
        (spin (- n 1))))
(let sleeper (fork (syscall 'sleep 250)))
(spin 200000)
(pprint (join sleeper))
```

Expected: `250`; both procs HALTED. Timing check: run `node concurrent.probe.ts` directly — `...run` should be ~250–350ms. If it's ~480ms+ the timer was starved until quiescence (hop not working): stop and investigate. (`(spin 200000)` is ~6.2M machine steps ≈ 230ms of pure CPU; sequential would be ~480ms.)

`joinsleep.sl` — join a sleeping process, and prove sleep isn't a deadlock (spec probes 3 and 7):

```lisp
(pprint (join (fork (do (syscall 'sleep 150) 42))))
```

Expected: `42`, both HALTED, no `DEADLOCKED!`.

`badname.sl` — unknown syscall faults and propagates through join (spec probe 4):

```lisp
(let p (fork (syscall 'nope)))
(join p)
```

Expected: both procs ERRORED with `E!Unknown syscall 'nope'`.

`badarg.sl` — rejected promise faults, no crash (spec probe 5):

```lisp
(syscall 'sleep "soon")
```

Expected: `PID[1]  ERRORED:  E!sleep expects (ms : NUM)`.

`selfjoin.sl` (from Task 2) — deadlock sweep regression (spec probe 6):

Expected: unchanged — `E!DEADLOCKED!`.

`recvtimeout.sl` — the library-level recv-with-timeout pattern (spec probe 9):

```lisp
(let main $$)
(fork (do (syscall 'sleep 500) (send main '(TIMEOUT))))
(fork (send main '(DATA 42)))
(pprint (recv))
```

Expected: `(DATA 42)` — the real message beats the timer. The run still lasts ~500ms (the timer must settle before `inflight` hits 0 and the loop can exit); its late `(TIMEOUT)` send to the halted root is silently dropped — both are correct per the fire-and-forget spec. Then the timeout-wins variant, `recvtimeout2.sl`:

```lisp
(let main $$)
(fork (do (syscall 'sleep 100) (send main '(TIMEOUT))))
(pprint (recv))
```

Expected: `(TIMEOUT)` after ~100ms.

- [ ] **Step 6: Idle CPU check (spec probe 8)**

Create `<scratchpad>/sleep2s.sl` containing `(syscall 'sleep 2000)`, then:

```bash
cd <scratchpad> && python3 probe.py sleep2s.sl && time node sleep2s.probe.ts
```

Expected: real ≈ 2.1s, user+sys ≈ 0.1s (node startup only). If user time is ~2s the scheduler is spinning — the `sleepUntilWoken` branch isn't being taken.

- [ ] **Step 7: Checkpoint** — report all probe results and timings, pause for user review. Do not commit.

---

### Task 4: Full regression and perf sweep

**Files:** none modified — verification only.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Suite diff**

```bash
node tests/001-basic.ts 2>/dev/null | grep -v '\.\.\.run' | diff <scratchpad>/baseline.txt -
```

Expected: empty. Then the actor example:

```bash
cd <scratchpad> && python3 probe.py evenodd-check.sl
```

Expected: same four answers as Task 1, no ERRORED procs.

- [ ] **Step 2: Perf comparison**

```bash
cd <scratchpad> && python3 probe.py fib24.sl && node fib24.probe.ts && node fib24.probe.ts && node fib24.probe.ts
```

Expected: `46368` each time; `...run` within ~10% of the 2026-07-10 baseline (~205–210ms). Record the numbers.

- [ ] **Step 3: Spec checklist**

Walk the spec's 11-probe verification plan and confirm each maps to a passed probe: 1→`sleep100`, 2→`concurrent`, 3+7→`joinsleep`, 4→`badname`, 5→`badarg`, 6→`selfjoin`, 8→`sleep2s`, 9→`recvtimeout`+`recvtimeout2`, 10→suite diff + even/odd, 11→fib24 timings.

- [ ] **Step 4: Final checkpoint** — report the full results table to the user for review and commit. Deferred follow-ups to mention: prelude wrappers (`(defun sleep (ms) (syscall 'sleep ms))`), runner polish, browser hop shim — all out of scope per the spec.
