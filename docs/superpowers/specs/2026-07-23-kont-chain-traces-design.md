# Kont-Chain Error Traces (delete `expr_stack`)

**Date:** 2026-07-23
**Status:** Approved

## Problem

The `expr_stack` machinery added for error reporting (commit `634d751`) has three costs,
exposed sharply once TCO landed (commit `b57112f`):

1. **Quadratic tail loops.** The `:depth` marker in `APPLY` computes
   `proc.expr_stack.reduce(...)` — O(stack) per apply. In a tail loop nothing pops the
   stack until the final return, so n tail calls cost O(n²). Measured: 10k = 2.0s,
   20k = 8.5s, 40k = 33.1s. Patching the reduce out of the compiled JS: 40k = 97ms,
   1M = 2.3s.
2. **Marker leak.** The collapsed `ScopeExit` keeps only the outer frame's `entry_step`,
   so elided tail frames' markers linger until the final return (O(n) memory in a
   `Drop`-free tail loop).
3. **Steady-state overhead.** Every compound-expr eval allocates an `:EVAL` marker and
   every apply an `:APPLY` marker, happy path included. `Drop` wipes the whole stack
   (`splice(0)`), including outer frames' markers, so traces are already best-effort.

## Decision

Delete `expr_stack` entirely. The kont chain **is** the call stack: after TCO exactly one
`SCOPE_EXIT` frame survives per active, non-elided call. Reconstruct error traces at halt
time by walking the `ERR` kont chain. Frames carry **call + args** (decided over
name-only: arg values are usually retained via the callee env anyway; the extra retention
is the args spine).

## Design

### 1. Remove the parallel stack

- Remove `expr_stack` from `Process` and from `ProcessResult` (`ERR` variant).
- Remove all four `-- EXPR-SCOPE --` blocks in `strand.ts`:
  - `EVAL_EXPR`: the `:EVAL` marker push.
  - `APPLY`: the `:APPLY` marker push (including the quadratic `:depth` reduce).
  - `DROP`: becomes just `return kont.kont`.
  - `SCOPE_EXIT`: becomes just `Return( returned, kont.env, kont.kont )`.

### 2. `ScopeExit` carries the call

```ts
export type ScopeExit = { type : 'SCOPE_EXIT', call : CALLABLE, args : LIST } & Kontinuation
```

- Constructor signature: `ScopeExit(call, args, env, kont)`.
- **Tail-collapse rule:** when `kont` is already a `SCOPE_EXIT`, the collapsed frame keeps
  the **new** call's `call`/`args` and the old frame's continuation (`kont.kont`). A trace
  through a tail loop shows the current call, not the elided iterations (Erlang/Scheme
  semantics).
- `entry_step` is deleted. Its only remaining consumer was the marker-matching scan;
  `debug.ts` TRACE's `SCOPE_EXIT` line switches to printing the call name.

### 3. Trace rendered at halt time

In `haltProcess`, when a process dies as `ERR`, walk the kont chain inside the `Err` and
render `trace : string[]` into the `ProcessResult` (replacing `expr_stack : TERM[]`):

- **Innermost context:** the first ~5 pending konts rendered via the existing `dumpKont`
  — the expression-level "where it died" context that replaces the `:EVAL` breadcrumbs.
- **Call frames:** every `SCOPE_EXIT` rendered as `(name arg1 arg2 ...)` from
  `call.name` + `args`. Depth is derived by counting while walking — no runtime counter
  needed anywhere.
- **Cap:** deep chains render Python-style — first/last N call frames (N = 10) with a
  `... k frames elided ...` line between.

`index.ts` prints `trace` instead of `expr_stack`. Faults delivered to `join`-ers carry
only the ERROR term, unchanged.

### 4. Accepted trade-offs

- Traces show **pending work only**: calls that already returned never appear (true today
  post-`Drop` as well), and tail-elided frames are invisible — the standard TCO trade.
- `ScopeExit` retains the args spine (and any arg values not otherwise reachable) for the
  frame's lifetime.

## Verification

- Existing tests pass (`npm run test`, `npm run self-test`).
- New test: error 4–5 calls deep asserts the trace contains the expected call frames in
  order.
- New test: error inside a tail loop asserts the trace holds one frame for the loop, not
  one per iteration.
- Timing check: 1M tail calls completes (~2s; previously unrunnable).
- `npm run bench` before/after — expect steps/s to improve (per-eval allocation removed).
