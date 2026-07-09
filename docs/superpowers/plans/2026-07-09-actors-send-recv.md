# Actors (send/recv) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `(send pid msg)` / `(recv)` actor message passing to the concurrent Lisp interpreter, built on a generalized block/wake core that also fixes the two open join-vs-errored-child bugs.

**Architecture:** Everything that blocks (`join` today, `recv` now, channels later) becomes one scheduler operation: park a process under a string wait key (`halt:<pid>`, `mail:<chanId>`), and resume it later via `Return(value, env, kont)`. Mailboxes are internal channel-shaped objects (`{id, queue}`) so first-class channels are a small follow-up. Send is fire-and-forget (never blocks, unbounded mailbox); recv is FIFO; send to a dead pid silently succeeds; joining a faulted child propagates the fault.

**Tech Stack:** TypeScript, single file `tests/001-basic.ts`, run with plain `node` (v23 native type stripping). No test framework — verification is via probe programs.

**Spec:** `docs/superpowers/specs/2026-07-09-actors-send-recv-design.md`

## Global Constraints

- ALL interpreter changes go in `tests/001-basic.ts` — this project is deliberately a single-file sketch. Do not split it into modules.
- No test framework. Verification = `tests/probe.sh '<program>'` (created in Task 1) plus diffing the full built-in suite against a baseline. `timeout` does not exist on this macOS shell — every probe must terminate on its own.
- Match existing style: 4-space indent, kont types as plain object types + factory functions with the same name, `switch (true)` dispatch, no braces around `case` bodies, error strings in the existing voice.
- The continuation-protocol invariant must hold: stack-value-consuming frames (`EVAL_HEAD`, `EVAL_ARGS`, `APPLY`, `DEFINE`, `COND`, `SCOPE_EXIT`, `SEND`) are only ever entered with a value via the `RETURN` dispatch inside `step`.
- Inside `kontinue`'s big switch, `case` bodies share one scope — do not reuse the identifiers `done`, `args`, `local`, `name`, `value`, `head`, `tail`, `exprs`, `params`, `body`, `found`, `cond`, `if_true`, `if_false` for new case-level `let`s.
- `DEBUG=1 node ...` prints step traces; new scheduler actions should log under `if (DEBUG)` in the existing `#### :` / `<<<< :` style.
- Commit after every task, short lowercase messages like the existing history (`join`, `deadlock detection stuff`). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Line numbers below are as of commit `31ad0f4`. If they have drifted, match by the quoted code content.

---

### Task 1: Probe harness and baseline

**Files:**
- Create: `tests/probe.sh`
- Baseline (not committed): `/tmp/slight-baseline.txt`

**Interfaces:**
- Produces: `tests/probe.sh '<lisp source>'` — runs `tests/001-basic.ts` with the given program substituted for the built-in `test_source`; prints the interpreter's `DONE:` block. All later tasks use this.

- [ ] **Step 1: Write the harness**

```bash
#!/usr/bin/env bash
# usage: tests/probe.sh '<slight program>'
# Runs tests/001-basic.ts with the given program in place of test_source.
# Must be run from the repo root. Pass DEBUG=1 in the environment for traces.
set -euo pipefail
TMP="$(mktemp -d)/probe.ts"
PROBE_SRC="$1" python3 - "$TMP" <<'PY'
import os, sys
s = open('tests/001-basic.ts').read()
target = 'let source = ``;'
assert target in s, 'could not find the source variable to replace'
s = s.replace(target, 'let source = `' + os.environ['PROBE_SRC'] + '`;')
open(sys.argv[1], 'w').write(s)
PY
node "$TMP" 2>&1 | grep -v -e 'ExperimentalWarning' -e 'trace-warnings' || true
```

Save as `tests/probe.sh`, then: `chmod +x tests/probe.sh`

- [ ] **Step 2: Verify the harness works**

Run: `./tests/probe.sh '(+ 1 2)'`
Expected:
```
DONE:
  PID[1]  HALTED:  3
```

- [ ] **Step 3: Capture the full-suite baseline**

Run: `node tests/001-basic.ts 2>/dev/null > /tmp/slight-baseline.txt && cat /tmp/slight-baseline.txt`
Expected: a `DONE:` block ending with `PID[1]  HALTED:` and a list beginning `(#true #false 720 8 40320 ...)`. Every later task re-runs the suite and diffs against this file. Do not commit it.

- [ ] **Step 4: Commit**

```bash
git add tests/probe.sh
git commit -m "probe harness for running test programs"
```

---

### Task 2: Generalized wait/wake core + join fault propagation

**Files:**
- Modify: `tests/001-basic.ts:466-537` (Strand fields, `blockProcess`, `haltProcess`), `tests/001-basic.ts:539-565` (`spawnProcess`)

**Interfaces:**
- Produces (later tasks rely on these exact members of `Strand`):
  - `procs : Map<number, Process>` — every process ever spawned, never deleted.
  - `haltKey(pid: Pid): string` / `mailKey(chanId: number): string` — module-level helpers returning `halt:<n>` / `mail:<n>`.
  - `awaitKey(key: string, proc: Process): void` — park a waiter.
  - `deliver(key: string, value: TERM): void` — resume all waiters on key with value.
  - `deliverFault(key: string, error: ERROR): void` — fault all waiters on key.
  - `blocked` is now `Map<string, Process[]>` (was `Map<number, Process[]>`).

- [ ] **Step 1: Run the two failing regression probes (verify current broken behavior)**

Run: `./tests/probe.sh '(let p (fork (nope))) (join p)'`
Expected: raw crash — `Error: The halted process should have HALT` with a JS stack trace.

Run: `./tests/probe.sh '(let p (fork (do (yield 0) (nope)))) (join p)'`
Expected:
```
DONE:
  PID[2]  ERRORED:  E!Unable to find nope in Env
  PID[1]  ERRORED:  E!DEADLOCKED!
```
(PID[1] misreported as deadlocked — that's the bug.)

- [ ] **Step 2: Add wait-key helpers (module level, just above `type Process`, line ~464)**

```typescript
function haltKey (pid : Pid) : string { return `halt:${pid.ident}` }
function mailKey (chan_id : number) : string { return `mail:${chan_id}` }
```

- [ ] **Step 3: Change the Strand fields (lines 469-471)**

```typescript
    public running : Process[]             = [];
    public halted  : Map<number,Process>   = new Map<number,Process>();
    public blocked : Map<string,Process[]> = new Map<string,Process[]>();
    public procs   : Map<number,Process>   = new Map<number,Process>();
```

- [ ] **Step 4: Add the unified park/resume/deliver methods (after `enqueueProcess`)**

```typescript
    private awaitKey (key : string, proc : Process) : void {
        if (DEBUG) console.log(`#### : Blocking ${pprint(proc.pid)} on ${key}`);
        let waiters = this.blocked.get(key) ?? [];
        this.blocked.set(key, [ ...waiters, proc ]);
    }

    private resumeWaiter (proc : Process, resumed : TERM) : void {
        if (proc.kont.type == 'HALT' || proc.kont.type == 'ERR')
            throw new Error(`Cannot resume a finished process`);
        if (DEBUG) console.log(`<<<< : Resuming ${pprint(proc.pid)}`);
        proc.kont = Return( resumed, proc.kont.kont.env, proc.kont.kont );
        this.enqueueProcess(proc);
    }

    private faultWaiter (proc : Process, error : ERROR) : void {
        if (DEBUG) console.log(`<<<< : Faulting ${pprint(proc.pid)}`);
        proc.kont = ThrowError( error, proc.kont );
        this.enqueueProcess(proc);
    }

    // NOTE: resumes ALL waiters with the same value. Right for halt
    // keys (join is a broadcast); mail keys only ever have one waiter
    // (the mailbox owner). A shared first-class channel would need a
    // deliver-to-one variant.
    private deliver (key : string, value : TERM) : void {
        let waiters = this.blocked.get(key);
        if (waiters == undefined) return;
        this.blocked.delete(key);
        waiters.forEach((p) => this.resumeWaiter(p, value));
    }

    private deliverFault (key : string, error : ERROR) : void {
        let waiters = this.blocked.get(key);
        if (waiters == undefined) return;
        this.blocked.delete(key);
        waiters.forEach((p) => this.faultWaiter(p, error));
    }
```

- [ ] **Step 5: Rewrite `blockProcess` (replace the whole method, lines 488-514)**

```typescript
    private blockProcess (blocker_pid : Pid, blockee : Process) : void {
        let finished = this.halted.get( blocker_pid.ident );
        if (finished == undefined) {
            this.awaitKey( haltKey(blocker_pid), blockee );
        } else if (finished.kont.type == 'HALT') {
            if (finished.kont.result == undefined) throw new Error(`Expected result in HALT!`);
            this.resumeWaiter( blockee, finished.kont.result );
        } else if (finished.kont.type == 'ERR') {
            this.faultWaiter( blockee, finished.kont.error );
        } else {
            throw new Error(`A halted process should be HALT or ERR`);
        }
    }
```

- [ ] **Step 6: Rewrite `haltProcess` (replace the whole method, lines 516-537)**

```typescript
    private haltProcess (proc : Process) : void {
        if (DEBUG) console.log(`#### : Halting ${pprint(proc.pid)}`);
        if (proc.kont.type == 'HALT') {
            if (proc.kont.result === undefined) throw new Error(`Expected result in HALT!`);
            this.deliver( haltKey(proc.pid), proc.kont.result );
        } else if (proc.kont.type == 'ERR') {
            this.deliverFault( haltKey(proc.pid), proc.kont.error );
        }
        this.halted.set( proc.pid.ident, proc );
    }
```

- [ ] **Step 7: Register processes in `spawnProcess` (replace the last two lines of the method, lines 562-564)**

```typescript
        let proc : Process = { pid, kont, steps : 0 };
        this.procs.set( pid.ident, proc );
        // push this so it runs immedately
        this.running.push(proc);
        return pid;
```

- [ ] **Step 8: Re-run the regression probes**

Run: `./tests/probe.sh '(let p (fork (nope))) (join p)'`
Expected (no crash, fault propagated):
```
DONE:
  PID[2]  ERRORED:  E!Unable to find nope in Env
  PID[1]  ERRORED:  E!Unable to find nope in Env
```

Run: `./tests/probe.sh '(let p (fork (do (yield 0) (nope)))) (join p)'`
Expected: same two lines as above (PID[1] gets the child's error, not DEADLOCKED).

- [ ] **Step 9: Verify deadlock and multi-waiter behavior unchanged**

Run: `./tests/probe.sh '(let p (fork (join $ppid))) (join p)'`
Expected: both PIDs `ERRORED:  E!DEADLOCKED!`

Run: `./tests/probe.sh '(let p (fork (do (yield 0) 42))) (let a (fork (join p))) (list (join p) (join a))'`
Expected: PID[1] halts with `(42 42)`.

- [ ] **Step 10: Verify the full suite is unchanged**

Run: `node tests/001-basic.ts 2>/dev/null | diff /tmp/slight-baseline.txt -`
Expected: no output (exit 0).

- [ ] **Step 11: Commit**

```bash
git add tests/001-basic.ts
git commit -m "generalized wait/wake core, join propagates child faults"
```

---

### Task 3: Mailboxes, Block generalization, and `(recv)`

**Files:**
- Modify: `tests/001-basic.ts:368` + `447-449` (Block type/constructor), `tests/001-basic.ts:399` (pprintKont), `tests/001-basic.ts:466` (Process type), `spawnProcess`, the `run` BLOCK case (lines 604-608), the `kontinue` BLOCK case (lines 741-746), and the `EVAL_EXPR` special-form dispatch (line 667).

**Interfaces:**
- Consumes: `awaitKey`, `mailKey`, `procs` from Task 2.
- Produces:
  - `type Chan = { id : number, queue : TERM[] }` (module level, internal — not a TERM).
  - `Process` gains `mailbox : Chan`.
  - `type WaitFor = { target : 'JOIN', pid : Pid } | { target : 'RECV' }`; the `Block` kont's field is now `on : WaitFor | undefined` (the `pid` field is gone).
  - `(recv)` special form: returns the oldest mailbox message or blocks.

- [ ] **Step 1: Write the failing probe**

Run: `./tests/probe.sh '(let a (fork (recv))) (quote root-done)'`
Expected today: `E!Unable to find recv in Env` for PID[2] — recv doesn't exist yet.

- [ ] **Step 2: Add `Chan` and `WaitFor`, extend `Process` (module level, around line 464)**

```typescript
type Chan    = { id : number, queue : TERM[] }
type WaitFor = { target : 'JOIN', pid : Pid } | { target : 'RECV' }

type Process = { pid : Pid, kont : Kontinue, steps : number, mailbox : Chan }
```

- [ ] **Step 3: Generalize the Block kont**

Type (line 368):
```typescript
type Block     = { type : 'BLOCK', on : WaitFor | undefined } & Kontinuation
```

Constructor (lines 447-449):
```typescript
function Block (env : Env, kont : Kontinue, on : WaitFor | undefined = undefined) : Block {
    return { type : 'BLOCK', on, env, kont }
}
```

pprintKont case (line 399):
```typescript
    case 'BLOCK'      : kontStr += ` =: ${kont.on == undefined ? '' : (kont.on.target == 'JOIN' ? pprint(kont.on.pid) : 'RECV')}`; break;
```

- [ ] **Step 4: Give every process a mailbox in `spawnProcess`**

Add a `CHAN_SEQ` counter next to `PID_SEQ`:
```typescript
    private PID_SEQ       = 0;
    private CHAN_SEQ      = 0;
    private DEFAULT_QUOTA = 1000;
```

Then in `spawnProcess` (the lines added in Task 2):
```typescript
        let proc : Process = { pid, kont, steps : 0, mailbox : { id : ++this.CHAN_SEQ, queue : [] } };
```

- [ ] **Step 5: Update the `kontinue` BLOCK case (join's pid arrival, lines 741-746)**

```typescript
        case 'BLOCK':
            if (returned !== undefined) {
                if (!isPid(returned)) return RaiseError(`Expected PID returned to BLOCK, got ${returned.type}`, kont);
                kont.on = { target : 'JOIN', pid : returned };
            }
            return kont;
```

- [ ] **Step 6: Update the `run` BLOCK case (lines 604-608)**

```typescript
                case 'BLOCK' :
                    let wait = proc.kont.on;
                    if (wait === undefined) throw new Error(`Expected wait target from BLOCK, got undefined`);
                    if (wait.target == 'JOIN') {
                        this.blockProcess( wait.pid, proc );
                    } else {
                        this.awaitKey( mailKey(proc.mailbox.id), proc );
                    }
                    break;
```

- [ ] **Step 7: Add the `(recv)` special form**

`(recv)` has a nil tail, so it must be handled before the `isCons(tail)` guard. In `EVAL_EXPR`'s `isCons(kont.expr)` branch, replace:

```typescript
                if (isSym(head) && isCons(tail)) {
```

with:

```typescript
                if (isSym(head) && head.ident === 'recv') {
                    if (proc.mailbox.queue.length > 0) {
                        return Return( proc.mailbox.queue.shift()!, kont.env, kont.kont );
                    }
                    return Block( kont.env, kont.kont, { target : 'RECV' } );
                }
                if (isSym(head) && isCons(tail)) {
```

- [ ] **Step 8: Run the probe — recv blocks, then deadlock-faults at quiescence**

Run: `./tests/probe.sh '(let a (fork (recv))) (quote root-done)'`
Expected:
```
DONE:
  PID[1]  HALTED:  root-done
  PID[2]  ERRORED:  E!DEADLOCKED!
```
(This is the leaked-actor detection from the spec — a recv nobody answers drains as a deadlock, and other results survive.)

- [ ] **Step 9: Verify the full suite (joins go through the new Block shape)**

Run: `node tests/001-basic.ts 2>/dev/null | diff /tmp/slight-baseline.txt -`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add tests/001-basic.ts
git commit -m "mailboxes, generalized block targets, recv"
```

---

### Task 4: `(send pid msg)`

**Files:**
- Modify: `tests/001-basic.ts` — kont union (line ~372) and type block, factory functions (~447), pprintKont, the `EVAL_EXPR` special-form switch, a new `SEND` case in `kontinue`, and a `sendMessage` method on `Strand`.

**Interfaces:**
- Consumes: `procs`, `halted`, `deliver`, `mailKey` (Task 2), `Process.mailbox` (Task 3).
- Produces: `(send <pid-expr> <msg-expr>)` special form; `Send(env, kont)` kont; `Strand.sendMessage(target_pid: Pid, msg: TERM): void`.

- [ ] **Step 1: Write the failing probe**

Run: `./tests/probe.sh '(let c (fork (recv))) (send c 42) (join c)'`
Expected today: `E!Unable to find send in Env` for PID[1] and `E!DEADLOCKED!` for PID[2].

- [ ] **Step 2: Add the Send kont type, union member, factory, and pprint**

Next to the other kont types (after `Block`, line ~368):
```typescript
type Send      = { type : 'SEND' } & Kontinuation
```

Add `| Send` to the `Kontinue` union (line ~372).

Factory (next to `Block`'s, line ~449):
```typescript
function Send (env : Env, kont : Kontinue) : Send {
    return { type : 'SEND', env, kont }
}
```

pprintKont gets:
```typescript
    case 'SEND'       : break;
```

- [ ] **Step 3: Add `sendMessage` to `Strand` (after `deliverFault`)**

```typescript
    private sendMessage (target_pid : Pid, msg : TERM) : void {
        let target = this.procs.get( target_pid.ident );
        if (target == undefined || this.halted.has( target_pid.ident )) {
            // fire-and-forget: sending to a dead or unknown pid succeeds silently
            if (DEBUG) console.log(`#### : Dropping ${pprint(msg)} sent to dead ${pprint(target_pid)}`);
            return;
        }
        target.mailbox.queue.push(msg);
        let key = mailKey(target.mailbox.id);
        if (this.blocked.has(key)) {
            // the queue stays the source of truth: push above, shift here
            this.deliver( key, target.mailbox.queue.shift()! );
        }
    }
```

- [ ] **Step 4: Add the special form to `EVAL_EXPR` (inside the `isSym(head) && isCons(tail)` switch, next to `fork`/`join`)**

```typescript
                    case 'send':
                        return EvalArgs( tail, [], kont.env, Send( kont.env, kont.kont ) );
```

- [ ] **Step 5: Add the `SEND` case to `kontinue` (next to the `BLOCK` case)**

```typescript
        case 'SEND':
            if (returned == undefined) return RaiseError(`Expected args returned to SEND, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to SEND, got something else`, kont);
            let send_args = uncons(returned);
            if (send_args.length != 2) return RaiseError(`send expects (send <pid> <msg>), got ${send_args.length} args`, kont);
            let [ send_to, send_msg ] = send_args;
            if (!isPid(send_to)) return RaiseError(`send expects a PID, got ${send_to.type}`, kont);
            this.sendMessage( send_to, send_msg );
            return Return( send_msg, kont.env, kont.kont );
```

- [ ] **Step 6: Run the block-then-wake probe**

Run: `./tests/probe.sh '(let c (fork (recv))) (send c 42) (join c)'`
Expected:
```
DONE:
  PID[2]  HALTED:  42
  PID[1]  HALTED:  42
```

- [ ] **Step 7: Run the queued-messages probe (recv after send, FIFO order)**

Run: `./tests/probe.sh '(let c (fork (do (yield 0) (yield 0) (list (recv) (recv) (recv))))) (send c 1) (send c 2) (send c 3) (join c)'`
Expected:
```
DONE:
  PID[2]  HALTED:  (1 2 3)
  PID[1]  HALTED:  (1 2 3)
```

- [ ] **Step 8: Run the dead-send and bad-send probes**

Run: `./tests/probe.sh '(let c (fork 1)) (join c) (send c 99) (quote ok)'`
Expected: PID[2] halts `1`, PID[1] halts `ok` (the send is silently dropped; `DEBUG=1` shows the Dropping line).

Run: `./tests/probe.sh '(send 5 99)'`
Expected: `PID[1]  ERRORED:  E!send expects a PID, got NUM`

- [ ] **Step 9: Verify the full suite**

Run: `node tests/001-basic.ts 2>/dev/null | diff /tmp/slight-baseline.txt -`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add tests/001-basic.ts
git commit -m "send special form, fire-and-forget message delivery"
```

---

### Task 5: Integration probes — ping-pong and pub/sub

**Files:**
- No interpreter changes expected. If a probe fails, the fix belongs in the task that owns the broken piece — reopen it rather than patching ad hoc here.

**Interfaces:**
- Consumes: everything from Tasks 2-4.

- [ ] **Step 1: Ping-pong (request/reply with addresses in messages)**

```bash
./tests/probe.sh "
(defun ponger ()
    (do
        (let msg (recv))
        (if (eq? (head msg) 'stop)
            'pong-done
            (do
                (send (head (tail msg)) (list 'pong \$\$))
                (ponger)))))

(defun pinger (target n)
    (if (== n 0)
        (do
            (send target (list 'stop \$\$))
            'ping-done)
        (do
            (send target (list 'ping \$\$))
            (let reply (recv))
            (pprint (list 'round n 'reply reply))
            (pinger target (- n 1)))))

(let pong (fork (ponger)))
(list (join (fork (pinger pong 3))) (join pong))
"
```
Expected: three `(round N reply (pong PID[2]))` lines for N = 3, 2, 1, then a `DONE:` block where PID[1] halts with `(ping-done pong-done)`. No DEADLOCKED lines.

- [ ] **Step 2: Pub/sub multicast (the NOTES.md sketch, hand-desugared)**

```bash
./tests/probe.sh "
(defun notify-all (subs item)
    (if (nil? subs) ()
        (do
            (send (head subs) (list 'item item))
            (notify-all (tail subs) item))))

(defun stop-all (subs)
    (if (nil? subs) ()
        (do
            (send (head subs) (list 'done))
            (stop-all (tail subs)))))

(defun subscriber ()
    (do
        (let m (recv))
        (if (eq? (head m) 'item)
            (do
                (pprint (list \$\$ 'received (head (tail m))))
                (subscriber))
            'sub-done)))

(defun broker (subs)
    (do
        (let m (recv))
        (if (eq? (head m) 'pub)
            (do
                (notify-all subs (head (tail m)))
                (broker subs))
            (do
                (stop-all subs)
                'broker-done))))

(let s1 (fork (subscriber)))
(let s2 (fork (subscriber)))
(let b  (fork (broker (list s1 s2))))
(send b (list 'pub 1))
(send b (list 'pub 2))
(send b (list 'stop))
(list (join b) (join s1) (join s2))
"
```
Expected: four pprint lines — each subscriber PID receives `1` before it receives `2` (interleaving between subscribers may vary) — then PID[1] halts with `(broker-done sub-done sub-done)`. No DEADLOCKED lines (the `'stop` protocol shuts every actor down cleanly).

- [ ] **Step 3: Full regression sweep**

Run every probe from Tasks 2-4 once more, plus:
`node tests/001-basic.ts 2>/dev/null | diff /tmp/slight-baseline.txt -`
Expected: all match their stated outputs; diff is empty.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "actors: verified ping-pong and pub/sub integration"
```
(If Step 1-2 required no code changes this commit may be empty — skip it in that case.)
