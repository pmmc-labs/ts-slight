# `connect` / `disconnect` — external event streams as actor mailboxes

**Date:** 2026-07-26
**Status:** Approved

## Purpose

Let a slight actor consume a JS-side event stream. `(connect :keypress (KeyCatcher))`
spawns an actor exactly like `fork`, then subscribes it to a named event source;
every event the source produces arrives in the actor's mailbox as an ordinary
message. `(disconnect pid)` detaches the stream. First source: terminal
keypresses via `node:readline`.

Driving example (`examples/scratchpad.slight`):

```lisp
(defun KeyCatcher ()
    (let key (recv))
    (case key
        ("q"   (pprint "goodbye"))
        (#true
            (pprint key)
            (KeyCatcher))))

(let keyboard (connect :keypress (KeyCatcher)))
(send keyboard "h")   ;; explicit sends and stream events interleave freely
(send keyboard "q")
(join keyboard)
```

## Architecture

Three layers, mirroring the existing `SYSCALLS` pattern. `strand.ts` stays
platform-agnostic; all Node/tty concerns live in the source implementation.

### 1. EventSource registry

```ts
export type EventSource = (emit : (t : TERM) => void) => (() => void);
export const EVENT_SOURCES : Map<string, EventSource> = new Map();
```

Calling a source starts it and returns its `stop` function. The Strand knows
only this interface. Registered from `extensions.ts` (Node build); a browser
build can register its own sources against the same interface.

### 2. Strand changes

- **`connections : Map<number, { source : string, stop : () => void }>`** —
  pid ident → the source name it holds plus its stop function. One entry per
  connected pid; the source name is what the busy-source check scans for.
- **`connect` special form** (in `kontinue`, beside `fork` handling):
  syntax `(connect :name body...)`. The tail's first element is the
  reader-produced `(quote name)` form; the name is extracted without
  evaluation, and the remaining exprs are the unevaluated body, as in `fork`.
  Order of operations: validate the source name exists in `EVENT_SOURCES`
  **before** spawning (unknown source raises an error, no orphan process);
  then `spawnProcess`, start the source with
  `emit = (term) => this.sendMessage(pid, term)`, record the stop function,
  and return the pid.
- **Single subscriber:** each source may back at most one live connection.
  A second `connect` to a busy source raises an error (checked before
  spawning). Fan-out is done in-language by forwarding from one actor.
- **`disconnect` special form:** `(disconnect expr)` evaluates `expr` to a
  pid, calls that pid's stop function, removes the map entry, and returns the
  pid. The actor keeps running as a normal process. Disconnecting a pid with
  no live connection raises an error. Non-pid argument raises an error.
- **Auto-disconnect on halt:** `haltProcess` (both HALT and ERR paths) stops
  and removes the pid's connection if one exists. After `KeyCatcher` halts on
  `"q"`, the connection dies and the interpreter can exit.
- **Run-loop liveness:** live connections count as "the outside world may
  still deliver," like inflight syscalls:

  ```ts
  } else if (this.inflight > 0 || this.connections.size > 0) {
      await this.sleepUntilWoken();
  ```

  This exempts `recv`-blocked connected actors from `sweepDeadlocked`. The
  existing wake path (`sendMessage → deliver → enqueueProcess → wake`)
  already handles events arriving while the loop sleeps.
- **Teardown safety:** the `run` loop body is wrapped in `try/finally`; the
  `finally` stops every remaining connection. This covers normal exit,
  interpreter errors, and early returns — the terminal is never left in raw
  mode by the scheduler's doing.

### 3. The `keypress` source (`extensions.ts`)

```ts
EVENT_SOURCES.set('keypress', (emit) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    const onKey = (s : string | undefined, key : { name? : string, ctrl : boolean }) => {
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

- **Event shape:** each keypress arrives as a plain `Str` — the character for
  printables (`"q"`), readline's `key.name` for specials (`"up"`,
  `"escape"`, `"backspace"`). No modifier info for now.
- **Ctrl-C:** intercepted by the source, never delivered to actors. It runs
  `stop()` (restoring the terminal) and exits the process with code 130.
- **`pause()` on stop matters:** a resumed stdin keeps the Node process alive
  even after the scheduler loop returns.
- **`isTTY` guard:** allows piped/non-tty stdin (e.g. tests) without crashing
  on `setRawMode`.

## Error handling summary

| Situation                         | Behavior                                  |
| --------------------------------- | ----------------------------------------- |
| `connect` to unknown source name  | raise, no process spawned                 |
| `connect` to busy source          | raise, no process spawned                 |
| `disconnect` of unconnected pid   | raise                                     |
| connected actor halts or errors   | source stopped automatically              |
| interpreter error / loop exit     | all sources stopped via `finally`         |
| event sent after actor halted     | dropped silently (existing `sendMessage`) |

## Testing

- Unit-level: a synthetic in-test EventSource (registered into
  `EVENT_SOURCES`) that emits a scripted sequence — verifies spawn, delivery
  order against interleaved explicit `send`s, auto-disconnect on halt, and
  that the loop exits with no explicit `disconnect`.
- `disconnect` detaches without killing: after disconnect, explicit `send`
  still reaches the actor; the loop exits once it halts.
- Error cases from the table above.
- The real `keypress` source is exercised manually via
  `examples/scratchpad.slight` (raw tty behavior isn't reasonably unit
  testable).

## Out of scope

- Multi-subscriber sources / fan-out (do it in-language).
- Structured key events with modifiers (revisit when TUI work needs it).
- Killing an actor from `disconnect` (no kill mechanism exists yet).
- Browser event sources (the registry interface is the extension point).
