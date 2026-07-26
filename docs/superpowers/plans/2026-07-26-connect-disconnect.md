# `connect` / `disconnect` Event Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `(connect :source body...)` spawns an actor like `fork` and feeds it every event from a named JS-side event source; `(disconnect pid)` detaches the source without killing the actor. First real source: terminal keypresses.

**Architecture:** An `EVENT_SOURCES` registry (mirroring `SYSCALLS`) keeps `strand.ts` platform-agnostic; the Strand tracks live connections per pid, counts them as run-loop liveness (like inflight syscalls), auto-disconnects on actor halt, and tears everything down in a `finally`. The Node `keypress` source (readline + raw mode + Ctrl-C intercept) lives in `extensions.ts`.

**Spec:** `docs/superpowers/specs/2026-07-26-connect-disconnect-design.md` — read it first.

**Tech Stack:** TypeScript (strict), Node builtins only (`node:readline`), plain `node:assert` test scripts.

## Global Constraints

- No new npm dependencies; Node builtins only.
- tsconfig is strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns` are all on. Guard every indexed access.
- Imports use explicit `.ts` extensions (`rewriteRelativeImportExtensions` is on).
- Build/run tests from the repo root: `npm run build && node js/tests/<name>.js`.
- Tests are plain scripts using `node:assert` with top-level `{}` blocks per case, ending with a `console.log('ok - ...')` line (see `tests/300-trace-test.ts` for the house style).
- Match existing code style: aligned `:` in type/field declarations, sparse comments stating constraints only.
- Single-subscriber sources: at most one live connection per source name.

---

### Task 1: EventSource registry, `connect` special form, run-loop liveness, auto-disconnect

**Files:**
- Create: `src/sources.ts`
- Modify: `src/strand.ts` (imports; new field + methods; `kontinue` special forms at ~line 436; arity list at ~line 447-466; `haltProcess`; `run` loop)
- Modify: `src/index.ts` (add re-export)
- Test: `tests/400-connect-test.ts`

**Interfaces:**
- Consumes: existing `spawnProcess`, `sendMessage`, `haltProcess`, `run` in `Strand`; `raise`, `isError`, `isCons`, `isSym`, `car`, `cdr`, `uncons` from `terms.ts` (all already imported in `strand.ts`).
- Produces: `EVENT_SOURCES : Map<string, EventSource>` and `type EventSource = (emit : (t : TERM) => void) => (() => void)` in `src/sources.ts`; `Strand` private methods `connectProcess(source_name, exprs, env, ppid) : Pid | ERROR` and `stopConnection(pid : Pid) : boolean` (Task 2 calls `stopConnection`); `connections : Map<number, { source : string, stop : () => void }>` field.

- [ ] **Step 1: Create the registry**

`src/sources.ts`:

```ts
import { type TERM } from './terms.ts';

// -----------------------------------------------------------------------------

// An EventSource is started by calling it with an emit callback; it returns
// its stop function. Sources are single-subscriber: at most one live
// connection per source name (enforced by the Strand, not here).
export type EventSource = (emit : (t : TERM) => void) => (() => void);

export const EVENT_SOURCES : Map<string, EventSource> = new Map();
```

Add to `src/index.ts` beside the other re-exports:

```ts
export * from './sources.ts';
```

- [ ] **Step 2: Write the failing tests**

Create `tests/400-connect-test.ts`:

```ts
import assert from 'node:assert';
import {
    parse, expand, initalizeEnv, Strand, EVENT_SOURCES, str, isNum,
    type ProcessResult,
} from '../src/index.ts';

async function run (source : string) : Promise<{ results : ProcessResult[], strand : Strand }> {
    let exprs   = expand(parse(source));
    let strand  = new Strand();
    let results = await strand.run( exprs, initalizeEnv() );
    return { results, strand };
}

// registers a source that emits `script` one Str at a time on timers;
// the returned state records whether stop() was called
function scripted (name : string, script : string[], delay_ms : number = 5) : { stopped : boolean } {
    let state  = { stopped : false };
    let timers : NodeJS.Timeout[] = [];
    EVENT_SOURCES.set(name, (emit) => {
        script.forEach((s, i) => timers.push(setTimeout(() => emit(str(s)), delay_ms * (i + 1))));
        return () => { state.stopped = true; timers.forEach(clearTimeout); };
    });
    return state;
}

// -- happy path: events drive the actor; halt auto-disconnects; loop exits ----
{
    let src = scripted('t1', ['a', 'b', 'q']);
    let { results } = await run(`
        (defun Counter (n)
            (let key (recv))
            (if (eq? key "q") n (Counter (+ n 1))))
        (join (connect :t1 (Counter 0)))
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.ok( isNum(main.result), 'join returned the count' );
    assert.equal( (main.result as any).value, 2, 'actor counted a,b before q' );
    assert.ok( src.stopped, 'source stopped on actor halt (auto-disconnect)' );
}

// -- explicit sends interleave with stream events -----------------------------
{
    let src = scripted('t2', ['q'], 20);
    let { results } = await run(`
        (defun Counter (n)
            (let key (recv))
            (if (eq? key "q") n (Counter (+ n 1))))
        (let actor (connect :t2 (Counter 0)))
        (send actor "x")
        (send actor "y")
        (join actor)
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.equal( (main.result as any).value, 2, 'both explicit sends arrived before the scripted q' );
    assert.ok( src.stopped, 'source stopped on actor halt' );
}

// -- unknown source raises, spawns no orphan ----------------------------------
{
    let { results, strand } = await run(`(connect :no-such-source (recv))`);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('Unknown event source'), 'error names the problem' );
    assert.equal( strand.metrics().procs, 1, 'only the init process was ever spawned' );
}

// -- busy source raises on second connect, spawns no orphan -------------------
{
    let src = scripted('t4', ['q'], 10);
    let { results, strand } = await run(`
        (defun Sink () (let k (recv)) (if (eq? k "q") :done (Sink)))
        (let a (connect :t4 (Sink)))
        (connect :t4 (Sink))
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('already connected'), 'error names the problem' );
    assert.equal( strand.metrics().procs, 2, 'second connect spawned no orphan' );
    assert.ok( src.stopped, 'first connection still tore down cleanly' );
}

console.log('ok - connect tests passed');
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run build && node js/tests/400-connect-test.js`
Expected: FAIL — the slight-level error is `Unable to find connect in Env` (an ERR result where a HALT is expected), or a tsc error if imports are wrong. Either confirms `connect` doesn't exist yet.

- [ ] **Step 4: Implement `connect` in `src/strand.ts`**

Add the import at the top, beside the `SYSCALLS` import:

```ts
import { EVENT_SOURCES } from './sources.ts';
```

Add the field beside `procs` in the `Strand` class:

```ts
public connections : Map<number, { source : string, stop : () => void }> = new Map();
```

Add two private methods after `spawnProcess`:

```ts
// validation happens BEFORE spawning: a failed connect leaves no orphan process
private connectProcess (source_name : string, exprs : TERM[], env : Env, ppid : Pid) : Pid | ERROR {
    let source = EVENT_SOURCES.get(source_name);
    if (source == undefined) return raise(`Unknown event source ':${source_name}'`);
    for (const conn of this.connections.values()) {
        if (conn.source == source_name) return raise(`Event source ':${source_name}' is already connected`);
    }
    let pid  = this.spawnProcess( exprs, env, ppid );
    let stop = source((term) => this.sendMessage(pid, term));
    this.connections.set( pid.ident, { source : source_name, stop } );
    return pid;
}

private stopConnection (pid : Pid) : boolean {
    let conn = this.connections.get(pid.ident);
    if (conn == undefined) return false;
    conn.stop();
    this.connections.delete(pid.ident);
    return true;
}
```

In `kontinue`, add a `connect` case directly after `case 'fork':` (~line 436). The reader turns `:keypress` into `(quote keypress)`, so the source name is extracted without evaluation, and the body stays unevaluated exactly as in `fork`:

```ts
case 'connect': {
    let [ source_form, ...connect_body ] = uncons(tail);
    if (source_form == undefined || !isCons(source_form))
        return RaiseError(`connect expects (connect :source <body> ...)`, kont);
    let q    = car(source_form);
    let name = car(cdr(source_form));
    if (!isSym(q) || q.ident !== 'quote' || !isSym(name))
        return RaiseError(`connect expects a quoted source name, got ${pprint(source_form)}`, kont);
    if (connect_body.length == 0)
        return RaiseError(`connect expects a body`, kont);
    let connect_pid = this.connectProcess( name.ident, connect_body, kont.env, proc.pid );
    if (isError(connect_pid)) return ThrowError( connect_pid, kont );
    return Return( connect_pid, kont.env, kont.kont );
}
```

Add `case 'connect':` to the empty-tail arity-error list (~line 447-466, beside `case 'fork':`).

In `haltProcess`, add one line after `this.procs.delete( proc.pid.ident );`:

```ts
this.stopConnection( proc.pid );
```

(This runs on both the HALT and ERR paths — auto-disconnect on halt *or* error.)

In `run`, (a) live connections count as liveness so `recv`-blocked connected actors are not deadlock-swept, and (b) a `finally` guarantees every source is stopped no matter how the loop exits — this is what keeps the terminal out of raw mode on interpreter errors:

```ts
async run (exprs : TERM[], env : MapEnv) : Promise<ProcessResult[]> {
    let init_pid = this.spawnInitProcess( exprs, env );

    let hop_every = 25;
    try {
        while (true) {
            if (this.runqueue.hasWork()) {
                let proc = this.runqueue.pop()!;
                this.DISPATCH_SEQ++;
                if (DEBUG) LOG(`>>>> : Switching to ${ pprint(proc.pid) }`);
                this.step(proc, this.DEFAULT_QUOTA);
                this.park(proc);
                if (this.inflight > 0 && --hop_every <= 0) {
                    await this.hop();
                    hop_every = 25;
                }
            } else if (this.inflight > 0 || this.connections.size > 0) {
                await this.sleepUntilWoken();
            } else if (this.blocked.size > 0) {
                this.sweepDeadlocked();
            } else {
                break;
            }
        }
    } finally {
        for (const conn of this.connections.values()) conn.stop();
        this.connections.clear();
    }
    return [ ...this.halted.values() ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node js/tests/400-connect-test.js`
Expected: `ok - connect tests passed`, and the process exits promptly (a hang here means a timer or connection was left live).

- [ ] **Step 6: Run the existing test suite to check for regressions**

Run: `node js/tests/050-env-test.js && node js/tests/100-self-test.js && node js/tests/200-env-test.js && node js/tests/300-trace-test.js`
Expected: all pass (the `js/` dir is fresh from Step 5's build).

- [ ] **Step 7: Commit**

```bash
git add src/sources.ts src/strand.ts src/index.ts tests/400-connect-test.ts
git commit -m "feat: connect special form -- event sources feed actor mailboxes"
```

---

### Task 2: `disconnect` special form

**Files:**
- Modify: `src/konts.ts` (new kont type + constructor + union member)
- Modify: `src/strand.ts` (special form dispatch; arity list; `DISCONNECT` case in `kontinue`)
- Modify: `src/debug.ts` (three kont-type switches)
- Test: `tests/400-connect-test.ts` (append cases)

**Interfaces:**
- Consumes: `stopConnection(pid : Pid) : boolean` on `Strand` (Task 1); the `scripted` helper and `run` harness in `tests/400-connect-test.ts` (Task 1).
- Produces: `Disconnect` kont — `{ type : 'DISCONNECT' } & Kontinuation` with constructor `Disconnect(env, kont)`; `(disconnect <pid-expr>)` evaluates its argument, detaches, returns the pid.

- [ ] **Step 1: Write the failing tests**

Append to `tests/400-connect-test.ts`, before the final `console.log`:

```ts
// -- disconnect detaches without killing the actor ----------------------------
{
    // scripted far in the future: proves stop() cancels pending timers,
    // because the test would otherwise stall for a second
    let src = scripted('t5', ['z'], 1000);
    let { results } = await run(`
        (defun Sink () (let k (recv)) (if (eq? k "q") :done (Sink)))
        (let actor (connect :t5 (Sink)))
        (disconnect actor)
        (send actor "q")
        (join actor)
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.ok( src.stopped, 'disconnect stopped the source' );
}

// -- disconnect of a pid with no live connection raises -----------------------
{
    let { results } = await run(`(disconnect (fork :x))`);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('no live connection'), 'error names the problem' );
}

// -- disconnect of a non-pid raises -------------------------------------------
{
    let { results } = await run(`(disconnect 42)`);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('expects a PID'), 'error names the problem' );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node js/tests/400-connect-test.js`
Expected: FAIL — the first new case gets an ERR result (`Unable to find disconnect in Env`) instead of a HALT.

- [ ] **Step 3: Add the `Disconnect` kont to `src/konts.ts`**

Beside the `Send` type (~line 35):

```ts
export type Disconnect = { type : 'DISCONNECT' } & Kontinuation
```

Add `| Disconnect` to the `Kontinue` union (beside `| Send`). Beside the `Send` constructor:

```ts
export function Disconnect (env : Env, kont : Kontinue) : Disconnect {
    return { type : 'DISCONNECT', env, kont }
}
```

- [ ] **Step 4: Implement `disconnect` in `src/strand.ts`**

Add `Disconnect` to the `./konts.ts` import list. In the special-form switch, beside `case 'send':`:

```ts
case 'disconnect':
    return EvalArgs( tail, [], kont.env, Disconnect( kont.env, kont.kont ) );
```

Add `case 'disconnect':` to the empty-tail arity-error list.

In `kontinue`, add a case beside `case 'SEND':` (same evaluate-args-then-act shape):

```ts
case 'DISCONNECT': {
    if (returned == undefined) return RaiseError(`Expected args returned to DISCONNECT, got undefined`, kont);
    if (!isList(returned))     return RaiseError(`Expected args LIST returned to DISCONNECT, got ${pprint(returned)}`, kont);
    let dis_args = uncons(returned);
    if (dis_args.length != 1) return RaiseError(`disconnect expects (disconnect <pid>), got ${dis_args.length} args`, kont);
    let dis_pid = dis_args[0];
    if (dis_pid == undefined || !isPid(dis_pid)) return RaiseError(`disconnect expects a PID, got ${dis_pid == undefined ? 'undefined' : pprint(dis_pid)}`, kont);
    if (!this.stopConnection(dis_pid)) return RaiseError(`disconnect: ${pprint(dis_pid)} has no live connection`, kont);
    return Return( dis_pid, kont.env, kont.kont );
}
```

- [ ] **Step 5: Add `DISCONNECT` to the switches in `src/debug.ts`**

Three spots, each modeled on `SEND`:
- `TRACE` early-return list (~line 18): add `case 'DISCONNECT' :` beside `case 'SEND' :`
- `dumpKont` (~line 91): `case 'DISCONNECT' : return `${kont.type}`;`
- `pprintKont` (~line 117): `case 'DISCONNECT' : break;`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run build && node js/tests/400-connect-test.js`
Expected: `ok - connect tests passed`, prompt exit (the 1000ms-scripted case must not stall — that's the timer-cancellation proof).

- [ ] **Step 7: Run the existing suite**

Run: `node js/tests/050-env-test.js && node js/tests/100-self-test.js && node js/tests/200-env-test.js && node js/tests/300-trace-test.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/konts.ts src/strand.ts src/debug.ts tests/400-connect-test.ts
git commit -m "feat: disconnect special form -- detach a source, actor keeps running"
```

---

### Task 3: the `:keypress` source

**Files:**
- Modify: `src/extensions.ts` (imports + source registration)
- Verify with: `examples/scratchpad.slight` (already written — do not modify)

**Interfaces:**
- Consumes: `EVENT_SOURCES` from `src/sources.ts` (Task 1); `str` from `terms.ts` (already imported in `extensions.ts`).
- Produces: the `'keypress'` entry in `EVENT_SOURCES`. Events are plain `Str`s: the character for printables (`"q"`), readline's `key.name` for specials (`"up"`, `"escape"`, `"backspace"`).

- [ ] **Step 1: Register the source in `src/extensions.ts`**

Add imports at the top:

```ts
import * as readline from 'node:readline';
import { EVENT_SOURCES } from './sources.ts';
```

Add at the bottom of the file:

```ts
// :keypress -- one Str per key ("q", "up", "escape"). Ctrl-C is intercepted:
// it restores the terminal and exits (raw mode suppresses SIGINT, so without
// this the script is unkillable from the keyboard). The isTTY guards let
// piped stdin work (tests, scripted runs). pause() on stop matters: a
// resumed stdin keeps the node process alive after the scheduler exits.
EVENT_SOURCES.set('keypress', (emit) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    const onKey = (s : string | undefined, key : readline.Key) => {
        if (key.ctrl && key.name === 'c') { stop(); process.exit(130); }
        emit( str( s ?? key.name ?? '' ) );
    };
    process.stdin.on('keypress', onKey);
    const stop = () => {
        process.stdin.off('keypress', onKey);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
    };
    return stop;
});
```

- [ ] **Step 2: Build and run the full suite**

Run: `npm run build && node js/tests/400-connect-test.js && node js/tests/050-env-test.js && node js/tests/100-self-test.js && node js/tests/200-env-test.js && node js/tests/300-trace-test.js`
Expected: all pass. (No unit test for the real tty source — raw-mode behavior isn't unit-testable; the spec calls for manual verification.)

- [ ] **Step 3: Scripted end-to-end check (non-tty path)**

Run: `echo -n '' | node js/bin/slight.js examples/scratchpad.slight`
Expected: prints `h`, `e`, `l`, `l`, `o`, then `goodbye` (the explicit sends drive KeyCatcher; `"q"` halts it, auto-disconnect fires) and the process **exits on its own** with status 0. A hang here means stdin wasn't paused or the connection wasn't stopped.

- [ ] **Step 4: Human verification (interactive tty path)**

This needs a real terminal — hand it to the human (or use the `superpowers-lab:using-tmux-for-interactive-commands` skill). Write this file to the scratchpad directory as `keys.slight`:

```lisp
(defun KeyCatcher ()
    (let key (recv))
    (case key
        ("q" (pprint "goodbye"))
        (#true
            (pprint key)
            (KeyCatcher))))

(join (connect :keypress (KeyCatcher)))
```

From the repo root: `node js/bin/slight.js <scratchpad>/keys.slight`, then confirm:
1. Typed keys echo one per line, immediately (raw mode is on — no Enter needed).
2. Arrow keys print names like `up`.
3. `q` prints `goodbye` and exits cleanly; typing afterwards behaves normally (raw mode restored).
4. On a second run, Ctrl-C exits immediately with a sane terminal.

- [ ] **Step 5: Commit**

```bash
git add src/extensions.ts
git commit -m "feat: keypress event source -- readline raw-mode stream for connect"
```
