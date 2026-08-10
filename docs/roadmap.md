# slight: Roadmap

*2026-08-10. Companion to `vision.md`. Near steps are checklists with
concrete tasks; later layers get vaguer on purpose — they are described,
not designed, and each gets its own design conversation when its turn
comes. The through-line for everything here: structure declared as data,
not emergent from closures — the property the store, migration, the
workspace, and any future checker all assume.*

## Phase 1: Foundations (patterns, records, macros)

These come before any object system. Each is a small core addition that
serves at least two roadmap layers.

### 1.1 Pattern language

One engine, three uses: `match` (ADTs), selective `recv` (actor
protocols), store `query` (later, layer 4b).

- [ ] Pattern syntax: literals, `_` wildcard, variable binding, nested
      `(:Tag p1 p2 ...)` structure patterns over tagged lists
- [ ] Pattern compiler in the reader expand pass (where `case`/`cond`/
      `when` already lower)
- [ ] `MATCH` kont family in the machine; no-match is a fault
- [ ] `(match <topic> (<pat> <body>...) ...)` special form
- [ ] Selective `recv`: `(recv (<pat> <body>...) ...)` scans the mailbox
      for the first matching message, leaves non-matching messages queued
- [ ] Port the ugliest existing example dispatch (`text-editor` key
      handling, `simple-db-server`) to `match`/`recv` as validation
- [ ] Bench before/after (`npm run bench`) — pattern dispatch should not
      regress steps/s

### 1.2 Records

The data grain: `{tag, slots}` — one new term type.

- [ ] `Record` term type in `terms.ts`; `eq`, `pprint`, type predicate
- [ ] `(data Tree (Branch left right) (Leaf value))` declaration form:
      generates constructors with arity checking and `Tree?`/`Branch?`
      predicates
- [ ] Record patterns in `match`/`recv` (field destructuring, checked
      against declared arity)
- [ ] Declarations retained as data (terms), so the store can later index
      them as facts
- [ ] While in `terms.ts`: make PIDs opaque and node-qualifiable
      (currently forgeable ints) — cheap now, painful after distribution
- [ ] Port `simple-crappy-adts.slight` and the `Cursor` to records

### 1.3 Macros

Expand-time, hosted in the existing reader pass. Chosen over fexprs:
post-expansion code stays plain serializable data (lower pass, hash-cons
store, migration all keep working).

- [ ] `defmacro` — user macros registered into a macro environment
      consulted by the expand pass
- [ ] Quasiquote / unquote / unquote-splicing
- [ ] `gensym` hygiene convention (already have `gensym`)
- [ ] Re-express one existing reader expansion (`when`) as a library
      macro to prove the mechanism

## Phase 2: Behavior layers (library, not core)

With Phase 1 done, the object system is mostly Prelude code.

### 2.1 Generic functions (Dylan-shaped, as library)

Values get generics; processes get messages; nothing else gets dispatch.

- [ ] `defgeneric` / `defmethod` macros; method tables live in the root
      MENV so hot reload of individual methods works via existing late
      binding — no new mechanism
- [ ] Single dispatch on first argument's tag; `next-method`; **no**
      method combination, **no** MOP, **no** multiple inheritance (C3
      waits until a real need appears)
- [ ] Slot accessors generated as methods (uniform access — record
      layout never leaks into user code)
- [ ] Dispatch caching only if bench demands it — not before
- [ ] Later, with the store: sealing declarations as facts
      (`(sealed-domain ...)`, Dylan's trick) consumed by the lower pass,
      negotiated by the workspace on redefinition

### 2.2 Opaque, repositioned

Keep the `opaque` first-class-env primitive from the stash, but as
namespace/module/prototype/confinement primitive — not the object system.

- [ ] Fix the lexical-parent leak: method lookup stops at the opaque
      boundary (today `(cursor :map)` walks up and finds the Prelude's
      `map`)
- [ ] Land it; document intended uses (modules, one-off prototypes,
      capability bundles for confined documents)

### 2.3 Actor conveniences

- [ ] Monitors: "send me `(:down pid reason)` when it dies" — the async
      form of what `join` does synchronously (a halt-key waiter that
      delivers a message instead of resuming a kont)
- [ ] Prelude supervisor loop built on monitors
- [ ] `(sync pid)` derived facade — one generic proxy constructor
      replacing hand-written facades (`active-objects` pattern, made
      uniform); constructing the facade stays explicit so the
      value/process boundary stays visible
- [ ] Protect the promotion path: define a protocol once, derive the
      value methods, the actor loop, and the facade from it

## Phase 3: Workspace/notebook (vision layer 4a)

The first big destination, now standing on patterns (its protocol),
records (its facts), and supervision (its cells). Checklist items are
the ones already designed in `vision.md`; the rest is the spec
conversation still to have.

- [ ] The door: eval mode that binds `defun` into the shared root MENV
      (relaxing the pre-run-only invariant — safe at step boundaries on
      a single-threaded scheduler)
- [ ] Workspace server actor owning document + eval; protocol messages
      are plain terms (`(:eval-cell id source)`, `(:cell-result id
      term)`, `(:cell-fault id error trace)`)
- [ ] Cell delimiters in plain `.slight` files (`;; %%`-style); every
      notebook remains a valid script
- [ ] Cell-aware TUI on the existing `text-editor.slight`
- [ ] Cells supervised via 2.3: a cell's fault renders in the cell

Open spec questions (deliberately unanswered here): exact delimiter
syntax; how facts and the envelope serialize inline with code; the full
server protocol; what cell interaction feels like in the TUI.

## Phase 4: Store (vision layer 4b) — sketched, not designed

Hash-consed term store; commit/merge refs on top; blackboard interface
(`assert` / `retract` / `query` / `subscribe`) where `query` reuses the
Phase 1 pattern language and `subscribe` delivers like `connect`.
Records make terms trivially hashable; `data` and sealing declarations
become indexable facts. Design conversation needed on: fact-base
representation, ref layer, merge algorithm at term granularity, and the
file-as-projection bridge from Phase 3. Read Unison's rename/dependency
handling first — they hit every rake.

## Phase 5: Distribution, migration, deploy (vision layers 5–6) — textual

As laid out in `vision.md`, unchanged: serialization is "put terms in
the store" (builtins by name, Erlang's external-fun rule); websocket
handshake before payload; remote spawn (`fork-on`) before migration;
location-transparent PIDs (prepared by 1.2's pid work); missing
capabilities fault. Deploy is idiom on top: converge nodes on a commit
hash, faults render in the deploying cell. None of this is designed
beyond the vision-doc sketch, and none of it should be until Phases 3–4
exist to inform it.

## Phase 6: The authoring surface — horizon

The top half of the Dynabook-substrate framing: an Etoys/HyperCard-grade
authoring layer, itself written as slight documents in the workspace, so
the trapdoor from surface to substrate is a ramp. Explicitly out of
scope until the substrate (workspace, store, browser node) exists. The
party-date wizard is the first proof artifact, and it needs only Phases
3–5.

## Standing no-list

MOP/metaclasses; CLOS method combination; fexprs; restarts
(crash-and-supervise wins); multiple inheritance until proven needed;
dispatch caches, frame pooling, or any perf work before the bench says
so; static typechecker (shapes stay declared-as-data so a gradual
checker can arrive later without redesign).
