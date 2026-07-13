# Env Refactor: Rib Frames over Map Roots

**Date:** 2026-07-13
**Status:** Approved

## Motivation

Profiling the erlang-challenge benchmark (after scheduler fixes: no
yield-on-fork, batched event-loop hops) showed the remaining costs are the
ones already ranked in NOTES.md: a `new Map` allocated per lambda call,
string hashing per lookup, and GC pressure from the per-process footprint.
At 10M actors the live set is large enough that GC visibly bends the
per-actor cost curve (4.25µs at 2M, 6.5µs at 5M, 9-12µs at 10M).

Local frames are tiny (1-3 bindings), so a linearly-scanned association
list ("rib") beats a Map on both allocation (~32-48B node vs ~100+B Map)
and lookup (short scan of string compares vs hash). The Map stays for the
root layers (builtins, top-level defuns), which are built once and hold
many bindings.

The refactor also fixes a known semantic leak (NOTES.md "Env sharing"):
a parent that binds after `fork` currently leaks the binding to the child.
Rib structure makes an O(1) fork-time snapshot possible via structural
sharing.

## Design

### Types (terms.ts)

```ts
type RibNode = { name : string, value : TERM, next : RibNode | undefined }
type MapEnv  = { type : 'MENV', bindings : Map<string,TERM>, parent : MapEnv | undefined }
type RibEnv  = { type : 'RENV', head : RibNode | undefined,  parent : Env }
type Env     = MapEnv | RibEnv
```

Invariants encoded by the types:

- Rib frames always sit *above* Map layers; a MapEnv's parent is another
  MapEnv (the chain is: root/@ARGV <- builtins <- defun layer), never a rib.
- Both variants remain in the `TERM` union; `isEnv` matches both.
- Rib lookup compares `name` strings with `==`. Symbol interning
  (identity compares) is deferred; see Non-Goals.

### Core operations (terms.ts)

- `newMapEnv(parent? : MapEnv)` and `newRibEnv(parent : Env)` replace
  `newEnv`.
- `bind(name, value, env)`: MENV -> `bindings.set` (unchanged);
  RENV -> prepend a node, mutating `env.head`. Same signature, still
  returns the env.
- `lookup(name, env)`: walk the chain; RENV scans nodes, MENV does
  `bindings.get`; unresolved names still return an ERROR term.
- `bindParams(params, args, env)`: builds a single rib frame directly
  from params/args -- nodes only, no Map. This is the hot path (one per
  lambda application).
- `snapshotEnv(env)` (new): walks the rib chain, pinning the head of
  EVERY RENV frame down to the MENV boundary -- `{ type:'RENV', head:
  env.head, parent: snapshotEnv(env.parent) }` recursively, sharing all
  nodes; MENV -> returned as-is (Map layers are only written during
  builtins init and the defun scan, before any process runs). O(rib
  depth), typically 1-2 frames -- a one-level snapshot is insufficient
  because a deeper frame becomes innermost again when control returns
  to it (e.g. fork inside a lambda) and is written by later `let`s.

### Call sites

- `index.ts` root env, `initalizeEnv` (builtins.ts), and `run`'s defun
  layer (strand.ts) -> `newMapEnv`.
- `spawnProcess` (strand.ts) ->
  `local = newRibEnv( snapshotEnv(env) )`, then bind `$ppid`.
  This is the fork-isolation fix: the parent keeps prepending to its own
  live head; the child's chain is pinned to the fork-time node.
- `APPLY` / `DEFINE` / `do` blocks: untouched. `bind` mutating the
  innermost rib head reproduces today's semantics because of an existing
  invariant this spec makes explicit: **only the innermost frame of a
  process is ever written** (DEFINE targets `kont.env`; bindParams always
  makes a fresh frame).
- `pprint`'s ENV case updated for both variants.

## Semantics

Unchanged within a process, with one internal difference: re-`let` of an
already-bound name now *shadows* (prepends a node) instead of overwriting
the Map entry. Observationally identical -- lookup finds the newest node
first, and there is no `set!` and no env iteration. The old node lingers
while the frame is alive (negligible).

Changed at fork: the child snapshots the parent's frame at fork time, so
parent `let`s after `fork` are no longer visible to the child. This is
the intended fix for the NOTES.md env-sharing leak.

**Known limitation (documented, not fixed):** the fork-time snapshot
now pins every rib frame down to the MENV boundary, so a leaked write
to any ancestor frame reached by the process's own chain is closed.
The one remaining hole is closure capture: a lambda created *before*
fork and invoked in the *child* still holds the Env object it closed
over directly (not via the process's pinned chain), which is the
parent's *live* frame -- it can still observe post-fork bindings.
Fixing this requires fully persistent envs, which is out of scope.

`defun` mutual recursion is unaffected (defuns live in the mutable MENV
layer, populated before execution).

## Testing & success criteria

- Existing self-test suite (`tests/100-self-test.ts`) passes unchanged.
- New tests:
  1. Fork isolation: a parent `let` after `fork` is not visible in the
     child (fails today, passes after).
  2. Shadowing: repeated `let` of the same name in one scope resolves to
     the newest binding.
  3. Deep lookup: nested lambda frames resolve locals, enclosing-scope
     names, and builtins correctly.
- Benchmarks:
  - fib (pure compute) for step-rate: guard against the rib-scan string
    compares regressing the ~30M steps/sec baseline; within a few
    percent is acceptable.
  - erlang-challenge ladder (1M / 2M / 5M): expect per-actor footprint
    down (two Maps replaced by one rib frame + nodes per blocked actor)
    and a flatter GC bend. Open question worth recording in the results:
    does 5M fit under the default ~4GB heap again?

## Non-goals

- Symbol interning (parser change; revisit with or before the lowering
  pass).
- Halted-process trimming in `haltProcess` (separate, independently
  measurable change).
- `set!` or any mutation of existing bindings.
- Fully persistent envs (NOTES.md option (c)).
- The (depth, slot) lowering/compile pass. This refactor is a stepping
  stone toward it: a scanned rib is the runtime shape that lowering
  later compiles into slot indices.
