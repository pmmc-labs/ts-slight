# Actors (send/recv) on a Generalized Wait/Wake Core

**Date:** 2026-07-09
**Target:** `tests/001-basic.ts` (the concurrent Lisp interpreter sketch)
**Status:** Approved design, pending implementation plan

## Goal

Add actor-style message passing — `(send pid msg)` and `(recv)` — to the
interpreter, built on a generalization of the block/wake machinery that
`join` already uses. Position the implementation so that first-class
channels, IVars/MVars, `recv` pattern-matching sugar, and the `actor`
form can be added later without reshaping the scheduler.

## Decisions made

| Decision | Choice | Rationale |
|---|---|---|
| Primary primitive | Hybrid: actor mailboxes first, backed by channel-shaped internals | Matches the actor-flavored sketches in NOTES.md; keeps first-class channels a ~20-line follow-up instead of a second mechanism |
| Send semantics | Fire-and-forget, unbounded mailbox (Erlang-style) | Simplest `Block` kont (never carries a value); acceptable unboundedness for an experiment |
| Recv semantics | FIFO only — `(recv)` returns the oldest message | Scheduler stays dumb; selective receive / pattern sugar can layer on later as syntax over `recv` + `cond` |
| Send to dead/unknown pid | Silently succeeds (log under DEBUG) | Erlang semantics; keeps shutdown protocols non-racy |
| Joining a faulted child | Fault propagates: joiner resumes as ERR with the child's error | Consistent with the existing `DEADLOCKED!` fault injection; fixes the two open join bugs |

## Non-goals (explicitly deferred)

- First-class `Chan` terms with `(chan)` / `(send! ch v)` / `(recv! ch)` — phase 2.
- `(recv (msg) [pat] body ...)` pattern-matching sugar, the `(actor ...)` form,
  and `schedule/send` — phase 3; the first two are syntax over `recv` + `cond`
  and `fork`, the last needs a notion of time the scheduler does not have.
- IVars and MVars as primitives. A pid + `join` already is an IVar (write-once
  cell with blocking readers); a 1-slot bounded channel is an MVar. Both are
  recoverable later as special cases if wanted.

## Design

### 1. Scheduler core refactor (the enabler)

Everything here — `join` today, `recv` now, channel receive later — is one
scheduler operation: *block until something delivers a value, then resume via
`Return(value, env, kont)`*. The refactor makes the wait key generic instead
of hard-coding "completion of pid N".

Changes to `Strand`:

- **Process registry:** `procs : Map<number, Process>`, populated in
  `spawnProcess`, never deleted. `send` needs to find live targets and needs
  to know when a target is dead; `join`-after-halt already relies on `halted`.
- **Generalized wait keys:** `blocked : Map<string, Process[]>` keyed by
  strings: `halt:<pid>` (what join uses today), `mail:<pid>` (new), and later
  `chan:<id>` with zero structural change.
- **Two methods replace the scattered block/wake logic:**
  - `awaitKey(key, proc)` — park a waiter under a key.
  - `deliver(key, value)` — pop the waiters for a key and resume each.
- **One `resumeWaiter(proc, value)` helper** used by every wake path.
  The two open join bugs live precisely in the divergence between
  `blockProcess`'s halted-lookup branch and `haltProcess`'s wake loop;
  unifying them into one helper fixes both and prevents recurrence.

The deadlock sweep in `run` is untouched: at quiescence (running empty,
blocked non-empty) every still-blocked process is faulted with `DEADLOCKED!`
regardless of what it was waiting on. Consequence worth knowing: an actor
sitting in a recv loop after all senders finish gets `DEADLOCKED!` at program
end. This is leaked-actor detection — clean shutdown (e.g. the `'SHUTDOWN`
message in the NOTES.md pub/sub sketch) is the program's responsibility.

### 2. Mailboxes (channel-shaped internals)

```typescript
type Chan    = { id : number, queue : TERM[] }   // internal only, not a TERM yet
type Process = { pid : Pid, kont : Kontinue, steps : number, mailbox : Chan }
```

The mailbox's wait key derives from its chan id. Phase 1 exposes no channel
syntax. When first-class channels arrive later: `Chan` becomes a TERM (same
pattern `Pid` followed), `(chan)`/`(send! ...)`/`(recv! ...)` reuse the same
keys, and a process's mailbox is simply "the chan it owns". With shared
channels, `deliver` waking one waiter FIFO generalizes naturally.

### 3. `send`

`(send pid msg)` needs two evaluated arguments, so it mirrors the `APPLY`
pattern: a new `Send` kont fed by the existing `EvalArgs` machinery.

- `kontinue` `EVAL_EXPR` case gains:
  `case 'send': return EvalArgs(tail, [], kont.env, Send(kont.env, kont.kont))`
- The `SEND` kont case receives the evaluated `(pid msg)` list:
  - arity != 2 or first arg not a Pid → `RaiseError` (same style as BLOCK's check);
  - target pid unknown or halted → silently succeed (DEBUG log), return msg;
  - otherwise push msg onto the target's mailbox queue; if the target is
    parked on that mail key, `deliver` (pop the queue, resume it).
  - Returns the msg to the sender (Erlang convention). The sender does not
    yield; the slice quota preempts eventually.

The queue remains the single source of truth: delivery always goes
push-then-shift, never hands the value directly to the waiter.

### 4. `recv`

`(recv)` is handled in `kontinue` (which already receives `proc`):

- mailbox non-empty → `Return(queue.shift(), env, kont.kont)`;
- empty → block on own mail key (reuses the `BLOCK`/`awaitKey` path with a
  `mail:` key instead of a `halt:` key).

Single-threaded cooperative scheduling means no lost-wakeup race. Only the
owner ever waits on its own mail key, so mail delivery wakes at most one
process.

The `Block` kont generalizes from `{ pid : Pid | undefined }` to carrying a
wait key (or the information to compute one): `halt:<pid>` for join,
`mail:<own pid>` for recv.

### 5. Error handling

- **Joining a faulted child:** the waiter resumes as `ERR` carrying the
  child's error. Implemented once in `resumeWaiter` by checking whether the
  delivering process halted or errored. Fixes both verified open bugs:
  the raw `throw` crash in `blockProcess` (join after child already ERR'd)
  and the misreported `DEADLOCKED!` (child ERRs while joiner is blocked).
- **`(recv)` never satisfied:** drains as `DEADLOCKED!` at quiescence,
  unchanged mechanism.
- **Malformed send:** `RaiseError` in the `Send` kont.

### 6. Verification plan

Scratchpad probes in the established style (copy the source file, swap the
`source` variable, run with plain `node`):

1. Ping-pong between two forked processes exchanging counted messages.
2. Producer/consumer where messages queue before the consumer recvs
   (exercises the queue path).
3. Recv-before-send (exercises the block/wake path).
4. Send to a halted pid — silent success.
5. Actor left blocked in recv at program end — gets `DEADLOCKED!`,
   other results preserved.
6. Regression: `(let p (fork (nope))) (join p)` — joiner gets the child's
   error, no crash.
7. Regression: `(let p (fork (do (yield 0) (nope)))) (join p)` — joiner gets
   the child's error, not `DEADLOCKED!`.
8. Full existing test suite unchanged (nested fork/join tree still yields 30,
   final list unchanged).
9. Integration: the NOTES.md pub/sub sketch hand-desugared to `recv` +
   `if`/`eq?` — if this runs, the primitives are sufficient for the phase-3
   sugar.
