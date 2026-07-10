# Async Syscalls on the Wait/Wake Core

**Date:** 2026-07-10
**Target:** `tests/001-basic.ts` (the concurrent Lisp interpreter sketch)
**Status:** Approved design, pending implementation plan

## Goal

Add `(syscall '<name> args ...)` — a blocking call into the JS host that
returns a Promise. The calling process parks until the promise settles and
resumes with its result (or faults with its rejection), while other
processes keep running. This gives the interpreter timeouts, delays, and a
door to all of JS's async IO, riding the same wait/wake core that `join`
and `recv` use.

## Decisions made

| Decision | Choice | Rationale |
|---|---|---|
| Surface syntax | Generic `(syscall 'name args ...)` special form | Interpreter stays closed: new syscalls are table entries, not `kontinue` edits. Friendly names like `(sleep ms)` become prelude wrappers later |
| Event-loop yield cadence | One macrotask hop (`setImmediate`) after every `step()` slice | Timers/IO fire on time regardless of CPU-bound processes; ~24k hops for fib(27) ≈ low single-digit % overhead; quota knob already exists if it ever shows in profiles |
| Idle behavior | Sleep on a wake signal, never spin | `(sleep 5000)` with nothing runnable costs zero CPU; `enqueueProcess` resolves the signal on any delivery |
| Deadlock rule | Sweep only when running is empty AND no syscalls in flight | Any pending syscall means the world can still change; with zero in flight, "blocked forever" is provable again |
| Failure channel | Promise rejection → `deliverFault` | A failed syscall faults the process; `join` on it propagates — zero new error machinery |
| Marshalling | Each syscall table entry owns both directions (TERM → JS in, JS → TERM out) | `kontinue` and the scheduler never see raw JS values |

## Non-goals (explicitly deferred)

- A prelude of friendly wrappers (`(sleep ms)`, etc.) beyond the base
  builtins — upcoming separate work, unblocked by this.
- Runner/driver polish (file loading, argv handling) — same.
- `recv` with timeout as a primitive. Once `(syscall 'sleep ms)` exists it
  is a library pattern: fork a timer process that sends a `'TIMEOUT`
  message, race it against real mail in the existing mailbox.
- Cancellation of in-flight syscalls. Nothing can observe a leaked
  `sleep` today; revisit if a syscall ever holds a real resource.
- Browser portability of the hop (`setImmediate` is Node-only; a
  `MessageChannel` shim can come later if ever needed).

## Design

### 1. The async run loop (the structural change)

Promises only settle when the JS stack unwinds, so `run()` cannot stay a
closed synchronous loop. It becomes `async run() : Promise<Process[]>`,
and the nested `while (running.length > 0)` dissolves — the outer loop
picks one thing to do per turn:

```typescript
while (true) {
    if (this.running.length > 0) {
        let proc = this.running.pop()!;
        this.step(proc, this.DEFAULT_QUOTA);
        this.park(proc);              // existing dispatch switch, extracted
        await this.hop();             // macrotask: timers/IO/promises fire
    } else if (this.inflight > 0) {
        await this.sleepUntilWoken(); // idle: parked on the JS event loop
    } else if (this.blocked.size > 0) {
        this.sweepDeadlocked();       // existing sweep, extracted
    } else {
        break;
    }
}
```

Three branches = three states of the world: work to do, waiting on the
host, or settled (deadlock or done). The `else if` ordering *is* the
deadlock guard. `step` and `kontinue` do not change; the inner machine
stays synchronous.

Extracted methods (refactor of the current `run` body, no behavior
change): `park(proc)` — the halt/yield/block/requeue switch;
`sweepDeadlocked()` — the existing quiescence sweep; `hop()` —
`new Promise(r => setImmediate(r))`. The hop must be a macrotask:
microtasks (`await Promise.resolve()`) drain without turning the event
loop, so timers would never fire. `setTimeout(0)` clamps to ~1ms and would
destroy throughput.

### 2. Idle wake signal

```typescript
private wake : (() => void) | undefined;

private sleepUntilWoken () : Promise<void> {
    return new Promise((resolve) => this.wake = resolve);
}

private enqueueProcess (proc : Process) : void {
    this.running.unshift(proc);
    if (this.wake) { this.wake(); this.wake = undefined; }
}
```

Every delivery path already funnels through `enqueueProcess`, so any
resume — syscall settle, and for free any future external event source —
wakes the scheduler. Never idle-spin on `hop()`: a `setImmediate` loop
busy-polls at 100% CPU.

### 3. The `syscall` special form

Mirrors `send` exactly: args evaluated by the existing `EvalArgs`
machinery into a new `Syscall` kont (same shape as `Send`). The `SYSCALL`
kont case validates (at least one arg, first arg a Sym — the name) and
returns a `Block` with a new `WaitFor` variant:

```typescript
type WaitFor =
    | { target : 'JOIN',    pid : Pid }
    | { target : 'RECV' }
    | { target : 'SYSCALL', name : string, args : TERM[] }
```

### 4. Dispatch (in `park`, alongside JOIN and RECV)

```typescript
case 'SYSCALL': {
    let key = sysKey(++this.SYS_SEQ);   // `sys:<n>` — unique per call
    this.awaitKey(key, proc);
    this.inflight++;
    this.dispatchSyscall(wait.name, wait.args)
        .then((result) => { this.inflight--; this.deliver(key, result); },
              (e)      => { this.inflight--; this.deliverFault(key, raise(String(e))); });
}
```

Per-call unique keys mean no collisions and exactly one waiter per key.
`deliver`/`deliverFault`/`awaitKey` are used untouched. The two-argument
`.then(onOk, onErr)` (not `.then().catch()`) scopes the rejection handler
to the dispatch promise, so a hypothetical throw inside `deliver` cannot
double-decrement `inflight`. `dispatchSyscall` is `async` so a table
entry that throws synchronously becomes a rejection instead of unwinding
the scheduler.

### 5. The syscall table

```typescript
const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>> = new Map();
```

Module-level, beside the interpreter. Each entry unmarshals its own TERM
args and marshals its JS result back to a TERM; a bad arg is a rejected
promise, which is already the fault path. `dispatchSyscall` returns a
rejected promise for an unknown name, so it drains through the same
`.catch` → `deliverFault` channel — one failure path for everything.

v1 ships exactly one entry, which exercises every mechanism:

```typescript
SYSCALLS.set('sleep', ([ms]) => {
    if (ms == undefined || !isNum(ms)) return Promise.reject(`sleep expects (ms : NUM)`);
    return new Promise((resolve) => setTimeout(() => resolve(ms), ms.value));
});
```

`(syscall 'sleep 100)` returns the ms slept.

### 6. Ripples

- `run()` returns `Promise<Process[]>` → top-level driver wraps in an
  async `main()` (less disruptive than converting the file to ESM for
  top-level await).
- `pprintKont`'s BLOCK case learns the SYSCALL variant.
- Nothing else: no changes to konts in `step`, no changes to `kontinue`'s
  existing cases, no changes to join/recv/send paths.

### 7. Verification plan

Scratchpad probes in the established style (copy the file, swap the
`source` variable, run with plain `node`):

1. `(syscall 'sleep 100)` alone — resumes with 100, run loop exits.
2. Two processes: one sleeps 200ms, one computes — computer's result
   arrives while sleeper is parked; both complete (proves timers fire
   during CPU-bound slices).
3. Sleeping process + `join`er — joiner gets the sleeper's result.
4. `(syscall 'nope)` — process faults with unknown-syscall error;
   joiner propagates it.
5. `(syscall 'sleep "soon")` — rejected promise → fault, not crash.
6. Deadlock regression: mutual join cycle still reports `DEADLOCKED!`
   (running empty, inflight zero).
7. Not-deadlock: A joins B, B sleeps — completes normally, no sweep.
8. Idle CPU check: `(syscall 'sleep 2000)` alone, eyeball that the
   process isn't spinning (wall time ≈ 2s, negligible CPU).
9. Timer-race pattern: recv-with-timeout via a forked timer process
   sending `'TIMEOUT` — the deferred-feature story actually works.
10. Full existing test suite unchanged (final list, nested fork/join
    tree = 30).
11. Perf spot-check: fib(24) before/after — hop overhead within
    single-digit %.
