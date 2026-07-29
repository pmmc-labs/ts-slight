# slight: Vision

*2026-07-29. Distilled from a working session; grounded in the code as it
exists at this commit. Speculation is quarantined in the final section.*

## What slight is

slight is a small Lisp whose control state lives entirely in the runtime
rather than the host stack. Processes, suspension, scheduling, fault
delivery, and killing are ordinary data operations because a process is
just a kont chain and a mailbox. Everything below follows from that one
invariant: **control state is data the scheduler owns.**

The system today (all shipped, all tested):

- **Kont machine** (`src/konts.ts`, `src/strand.ts`): every pending
  computation is an explicit kont chain. Suspension at arbitrary depth is
  free — demonstrated by the meta-circular interpreter in
  `examples/scratchpad.slight`, where `(yield ...)` sprinkled through a
  meta-eval time-slices two evaluations mid-recursion.
- **Deterministic scheduler with faults**: single-threaded, cooperative,
  explicit preemption points (yield, recv, join, syscall, quota), FIFO
  runqueue. Killed processes fault with `KILLED` and a trace; blocked
  process graphs that can never progress are swept and faulted with
  `DEADLOCKED` instead of hanging.
- **Actors**: `fork` / `send` / `recv` / `join` / `kill`, million-process
  scale (`examples/million-forks.slight`), immutable terms so interleaving
  cannot corrupt state.
- **Event sources**: `connect` subscribes an actor to a JS event stream
  (`:keypress` today); the outside world arrives as mailbox messages.
- **Syscall boundary**: all JS interop (timers, files, tty, time) crosses
  one async boundary.
- **Late binding** (load-bearing, see below): global functions resolve by
  name at call time against a shared mutable root env.

## The determinism claim, stated defensibly

> The scheduler is a deterministic state machine; all nondeterminism
> enters through the syscall/event boundary.

Between blocking points, execution is exactly as deterministic as a
sequential program. The complete list of divergence sources: `rand`,
wall-clock reads, arrival order of overlapping syscall completions, and
`connect` event streams. Every item crosses the one boundary.

Evidence already in the tree: `examples/fixed-tournament.slight` asserts
that every game ends with counters exactly `(R R-1)` — an
interleaving-dependent result that would be flaky by design in Erlang.
We already program against deterministic scheduling as a guarantee.

Corollary (not yet built, but implied): log the sequence of syscall
results and connected events, replay the log, and the entire interleaving
replays bit-for-bit.

## The goal

**Smalltalk-style liveness with actor bulkheads.** In Smalltalk, liveness
is fragile because everything shares one object memory — a bad poke wedges
the image. Actors give liveness with bulkheads: kill and restart the
broken part while the image keeps running. The concurrency exists to serve
the liveness.

The recent work is already liveness machinery, whether or not it was
framed that way: `kill` (remove a broken part), `connect` (live input),
`slight/eval` in the text editor (evaluate inside a running program),
deadlock sweep (mistakes fault loudly instead of wedging).

## Idioms the examples established

1. **Server loop**: state in tail-call args, `(yield (Server new-state))`
   as `become`. (`simple-db-server`, `fixed-tournament`,
   `game-of-life-actors`.)
2. **Synchronous facades**: a closure wrapping send+recv makes an actor
   callable; `Point` (closure) and `PointActor` (process) satisfy the same
   protocol interchangeably (`active-objects`). Location transparency
   between objects and processes.
3. **Ephemeral forks**: short-lived processes as timers and futures
   (`tail-chase-game` fade animations, `game-of-life-actors`
   neighborhood-watch).
4. **World-as-actor**: `connect` makes the keyboard a mailbox; the same
   actor runs unmodified against a synthetic scripted source
   (`tests/400-connect-test.ts` does exactly this). Interactive programs
   are testable by source substitution.
5. **Meta-interpretation as a control knob**: yields in a meta-eval buy
   chosen preemption granularity; fuel, stepping, and sandboxing are
   writable in slight itself.

## The load-bearing facts (verified in source)

These three facts make hot code reload *already true semantically*; only
the door is missing:

1. Symbol→function resolution happens at call time — `lookup` walks the
   env chain when `(Editor ...)` is evaluated (`src/terms.ts`,
   `lookup`). Nothing caches the function value in a kont.
2. Top-level defuns are hoisted into one shared mutable `MapEnv`
   (`src/strand.ts`, `spawnInitProcess`); `bind` on a MENV mutates the
   map in place.
3. Forks share that MENV by reference — `snapshotEnv` pins rib frames but
   stops at the MENV boundary (`src/terms.ts`, `snapshotEnv`).

Therefore: rebind a name in the shared MENV while the image runs, and
every server loop picks up the new definition on its next iteration. The
tail call is the reload point — Erlang's qualified-call semantics,
automatic. The current invariant "MENV is only written before processes
run" can be relaxed safely on a single-threaded scheduler: writes happen
at step boundaries by construction.

**Caveat that must appear in every design**: late binding only helps code
that goes through symbol lookup. `(let f Editor)` or a closure held in
state keeps the old value. The server-loop idiom naturally avoids this;
the rule is the same one Smalltalk and Erlang live with.

## The layered roadmap

Each layer needs only the layers below it. Layers 1–3 exist.

```
6. notebook as deploy        (run = deploy; failures render in cells)
5. distribution + migration  (Merkle sync, remote spawn, moving konts)
4b. hash-cons store          (fact base + blackboard + commit/merge refs)
4a. workspace/notebook       (live eval, cells, server actor protocol)
--- everything below is built ---
3. actors                    (fork/send/recv/join/kill, connect)
2. deterministic scheduler   (faults, deadlock sweep, quota)
1. kont machine              (control state as data)
```

### Layer 4a: Workspace/notebook

Not a REPL — a Smalltalk workspace with notebook-style cells. The unit is
the persistent document, evaluated piecewise inside the live image.

The slight-specific twist no mainstream notebook has: **a cell's output
can be a PID** — a live thing later cells send to, kill, or connect. The
notebook is an inspector over a running actor system, not a transcript.

Implementation sketch:

- **Protocol-first.** A workspace server actor owns the document and eval
  semantics; front-ends are dumb clients. TUI first (the text editor in
  `examples/text-editor.slight` already has buffer, cursor, rendering,
  keybindings, ctrl-e, save/load), browser later, others possible.
  Message sketch: `(:eval-cell id source)`, `(:cell-result id term)`,
  `(:cell-fault id error trace)`, `(:doc-sync ...)`. Rule that keeps the
  protocol migration-compatible for free: **protocol messages are plain
  terms — never closures, never PIDs-with-location-assumptions.**
- **Documents are plain `.slight` files with cell-delimiter comments**
  (jupytext-style, e.g. `;; %%`). Every notebook is a valid script
  (`slight notebook.slight` runs it top to bottom), diffs are clean,
  the existing editor loads it unchanged. Persisted outputs, if they ever
  earn their keep, go in a sidecar file — deferred until wanted.
  This is the *interim* truth: 4a ships before the store exists, so the
  file is the document. Once the store (4b) lands, the fact base is the
  document and the `.slight` file becomes its projection — still the
  git-visible, human-editable interchange form, no longer the substrate.
- **The door into the image**: an eval mode that binds `defun` into the
  shared root MENV instead of a local env (relaxing the pre-run-only
  invariant). ctrl-e on a defun then redefines it for every running
  actor. This is the single change that makes the editor the image's
  front door rather than a program the image runs.

### Layer 4b: Hash-cons store — fact base with commit/merge refs

The persistence substrate. Not lines in text files: **hash-consed terms
in a content-addressed store**, wrapped in a git-like commit/merge
interface. Terms are immutable trees, so content-addressing is
definitional — equal structure, equal hash, automatic structural sharing.
A snapshot is one root hash. This is git's architecture (immutable object
store + mutable refs) with terms instead of blobs; Unison proved the
code-as-content-addressed-terms half (read their rename/dependency
handling before designing this — they hit every rake first).

**The store is a blackboard, not a filesystem.** Its base type is the
Prolog-style fact — a term asserted into a database. Actors interact with
it the way blackboard-architecture agents do:

- `assert` / `retract` facts (terms),
- `query` by pattern (unification against the fact base, Datalog-flavored),
- `subscribe` to topics/patterns — matching facts arrive as mailbox
  messages, exactly like `connect` but with the store as the source.

Consequences, in order of importance:

- **Documents are databases.** A notebook is a set of facts; cells can
  assert facts; later cells (or other actors, or other nodes) query and
  subscribe to them. The document/database distinction dissolves.
- **Facts hash-cons perfectly**: a fact base is a set of term hashes;
  dedup is automatic; a commit is a snapshot of the set plus the
  name→hash ref map.
- **Subscription unifies the event model**: `connect` (outside world →
  mailbox) and `subscribe` (store → mailbox) are the same shape. The
  blackboard becomes the coordination medium between actors that never
  hold references to each other.

Merge semantics, and the design commitment behind them:

- *Definitions and documents merge.* A patch is a set of name rebindings
  and fact assertions/retractions; a conflict is two branches rebinding
  the same name or contradicting the same fact; resolution is choosing or
  hand-merging terms. Term-level diffs beat line diffs (formatting noise
  vanishes).
- *Running state does not merge — it rebuilds.* Two divergent kont chains
  have no meaningful merge (git doesn't merge binaries). Checkpoints are
  picked, not merged. **The store carries truth; the runtime carries
  motion; motion is always reconstructible from truth.** Computation whose
  results must survive merges deposits them as facts — that is the
  notebook's deepest job: the place where computation leaves its mergeable
  residue.

Acyclicity note: Merkle DAGs cannot have cycles, and closure→env→MENV→
closure would be one. The existing MENV boundary cuts it: closures
serialize rib frames by value and the root by symbolic reference. Late
binding is load-bearing here too — definitions reference each other
through names, and names live in the ref layer, not the object store.

### Layer 5: Distribution and migration

Origin story kept for honesty: this began as a workaround for macOS
lacking accessible framebuffers — use a browser window as the display.
It generalizes: a multi-window notebook workspace spanning two runtimes,
programmed as if one.

Decomposition (each piece independently testable):

1. **Serialization** = putting terms in the store. The store is the wire
   format, the image format, and the merge substrate — one mechanism,
   four uses (snapshot, migrate, sync, merge). Builtins and syscall
   handlers serialize *by name* and re-link against the target runtime's
   registry (Erlang's external-fun rule).
2. **Transport & handshake**: slight starts a web server, opens a browser
   to it via child process, browser calls back ready, **websocket is
   established first**, then payloads move over it — one connection whose
   liveness matters, shared by migration and mailbox forwarding.
   (`src/browser.ts` already builds for browser; the browser node needs
   transport plus event sources — `:dom-events` as that world's
   `:keypress`.)
3. **Distribution**: location-transparent PIDs; `(send pid ...)` routes
   over the socket; messages to a migrated process's old address forward.
   Sync between nodes is Merkle diff: exchange root hashes, ship missing
   objects — same protocol for a browser tab or a laptop offline for a
   week.
4. **Migration**: serialize a parked kont chain + mailbox, ship, resume.
   Remote spawn (`fork-on`) is a strict subset and comes first — it
   already delivers "control the browser window from ctrl-e in the
   editor": once PIDs are location-transparent, that is just
   `(send browser-actor ...)` from an evaluated cell.

**Capability asymmetry**: a migrated process calling `tty/write` in a
browser hits a syscall that does not exist there. Start by faulting it
(loud, honest, matches the deadlock-sweep philosophy); per-syscall
proxying back over the socket is an additive feature later.

### Layer 6: Notebook as deploy

Deploying is running a notebook. The notebook is then five things at
once — no existing system unifies them:

1. **Workspace** — poke the live image (Smalltalk half).
2. **Document** — mergeable truth in the store, versioned in the commit
   layer (git half).
3. **Deploy script** — evaluation forks servers onto nodes (Erlang-release
   half, minus the ceremony).
4. **Dashboard** — a deployed server is a PID a cell holds; `join` faults,
   KILLED, DEADLOCKED *render in the cell that deployed the thing*, with a
   trace, next to the code that caused it.
5. **Audit log** — the run is captured in git; what was deployed, by what
   code, and what happened is one commit chain.

The loop: run the notebook → a cell goes red → adjust → hot-reload to the
distributed nodes (late binding + Merkle sync) → re-run the deploy. Ops is
the workspace pointed at remote nodes; there is no separate ops tooling.

Honesty about the deploy semantics: a deploy is "converge nodes on a
commit hash and restart affected processes." The notebook run is the
human-facing driver of a sync operation. Rollback is deploying the
previous hash.

**Known rake, named now**: deploy-by-notebook inherits the notebook
disease — out-of-order execution (rerunning cell 7 after editing cell 3 in
a half-deployed world burned Jupyter-based ops). The antidote is
architectural and must be a stated principle: **cells declare toward the
store; the store is the truth; the run is just the driver.** Hidden
session state accumulated across cells is the failure mode. The
server-loop idiom and the state-rebuilds commitment both push the right
way.

## Design commitments (decisions already made)

1. Late binding through the shared root MENV is the reload mechanism; the
   tail call is the reload point.
2. Protocol messages are plain terms — no closures, no located PIDs.
3. Notebook files are valid `.slight` scripts (delimiter comments);
   outputs are ephemeral until proven otherwise.
4. The store is a blackboard: Prolog-style facts, unification queries,
   pattern subscriptions delivered as mailbox messages.
5. Definitions and facts merge; running state rebuilds from merged truth.
   Checkpoints are picked, never merged.
6. Missing capabilities fault; proxying is per-syscall and additive.
7. Websocket before payload; one connection per peer.
8. Cells declare toward the store; no hidden cross-cell session state.

## Build order

1. **Workspace/notebook** (4a): live root-env eval + workspace server
   actor + cell-aware TUI. Needs nothing from below; stays
   migration-compatible via commitment 2.
2. **Store** (4b): hash-consed term store, fact assert/query/subscribe,
   then the commit/ref layer. Immediately useful for image snapshots.
3. **Distribution + browser node** (5): transport, remote send, remote
   spawn (`fork-on`), Merkle sync.
4. **Migration** (5): serialization + distribution composed, plus mailbox
   forwarding.
5. **Deploy** (6): mostly idiom and polish on top of 1–4.

## Deferred (speculation, deliberately not designed)

- Record/replay of syscall/event logs (the determinism corollary).
- CRDT-style merging of running state — explicitly rejected for now in
  favor of commitment 5.
- Persisted cell outputs (sidecar files) — until wanted.
- Syscall proxying for migrated processes — per-syscall, on demand.
- Kont poisoning for self-kill `(kill $)` — needs its own design
  conversation.
- Other front-ends beyond TUI and browser.
