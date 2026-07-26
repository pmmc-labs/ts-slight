# Structured key events for `:keypress`

**Date:** 2026-07-26
**Status:** Approved

## Purpose

Replace the plain-string events of the `:keypress` source with structured,
KeyboardEvent-like terms: one canonical semantic key value that fires for
every key, plus explicit modifier flags. This is the browser's `keypress` →
`KeyboardEvent` fix, transplanted: the old shape couldn't represent
modifiers and special keys uniformly; the new one can. It also resolves the
deferred empty-string bug for unnameable escape sequences.

This supersedes the "Event shape: plain string" decision in
`2026-07-26-connect-disconnect-design.md`.

## Event shape

Every keypress arrives in the actor's mailbox as a flat list:

- **`car` is the key.**
  - Printable characters are **Str**: `("a")`, `("A" :shift)`, `("(")`,
    `(" ")` for space. DOM semantics — the key value of a printable *is*
    the character.
  - Named keys are **Sym**, using DOM `KeyboardEvent.key` names:
    `(:Enter)`, `(:Escape)`, `(:ArrowUp)`, `(:Backspace)`, `(:Tab)`,
    `(:Delete)`, `(:Home)`, `(:End)`, `(:PageUp)`, `(:PageDown)`,
    `(:Insert)`, `(:F1)` … `(:F12)`.
  - The general rule (shared with any future browser source, which can
    emit `KeyboardEvent.key` through it verbatim): length-1 string → Str,
    multi-character name → Sym.
- **`cdr` is the modifiers present**, as syms in fixed order
  `:ctrl`, `:alt`, `:shift` — omitted when absent.

Dispatch idiom:

```lisp
(case (car evt)
    ("q"       (quit))
    (:ArrowUp  (move-up))
    (:Enter    (submit)))

(when (member? :ctrl (cdr evt)) ...)
```

## Modifiers

- readline's `ctrl` → `:ctrl`, `shift` → `:shift`.
- readline's `meta` (ESC-prefix; physically Alt on terminals) → `:alt`.
  `:meta` is reserved for a future browser source's Cmd/Win key.
- Flags pass through as readline reports them: `("c" :ctrl)`,
  `(:ArrowUp :shift)`, uppercase as `("A" :shift)` when readline flags it.
  No synthesis beyond what readline provides.

## Normalization unit

A pure exported function in `src/extensions.ts`:

```ts
export function keyEventToTerm (s : string | undefined, key : readline.Key) : TERM
```

It owns the readline→DOM name table (`up→ArrowUp`, `down→ArrowDown`,
`left→ArrowLeft`, `right→ArrowRight`, `return→Enter`, `escape→Escape`,
`backspace→Backspace`, `tab→Tab`, `delete→Delete`, `home→Home`, `end→End`,
`pageup→PageUp`, `pagedown→PageDown`, `insert→Insert`, `f1→F1` … `f12→F12`,
`space→" "` as Str) and the modifier append. The `:keypress` source closure
shrinks to wiring only: raw mode, Ctrl-C intercept, `emit(keyEventToTerm(s, key))`.

Rationale: the mapping is unit-testable without a tty, and extractable to a
shared module if a second source ever needs it (not extracted now — YAGNI).

## Edge cases

| Situation                              | Behavior                                     |
| -------------------------------------- | -------------------------------------------- |
| Ctrl-C                                 | intercepted: terminal restore + exit 130, never delivered (unchanged) |
| sequence readline can't name           | `(:Unidentified)` — the DOM's own answer; never empty, never dropped |
| space                                  | `(" ")` — Str, per DOM                       |
| ctrl/alt-modified char                 | char as Str + modifier syms, e.g. `("c" :ctrl)` |

## Prelude

One new helper:

```lisp
(defun member? (x lst)
    (if (nil? lst) #false
        (if (eq? x (head lst)) #true
            (member? x (tail lst)))))
```

## Migration

- `:keypress` changes shape **in place** — no legacy source, no dual shapes.
- `examples/scratchpad.slight` updates: `(send keyboard (list "h"))`,
  dispatch via `(case (car key) ...)`.

## Testing

- Table-driven unit test calling `keyEventToTerm` directly: plain chars,
  shift-char, ctrl-char, alt-char, every named key in the table, space,
  multiple modifiers (fixed order), unnameable → `(:Unidentified)`.
- Existing `tests/400-connect-test.ts` is unaffected (synthetic sources
  emit their own terms).
- Piped e2e of the updated `examples/scratchpad.slight`; short interactive
  pty check (chars echo, arrow arrives as `:ArrowUp`, Ctrl-C exits 130).

## Out of scope

- Key-up events, auto-repeat distinction, physical key codes (`KeyA`) —
  terminals don't provide them.
- A browser key source (the shape is designed for it; building it is not
  this project).
- Extracting the normalization table to a shared module.
