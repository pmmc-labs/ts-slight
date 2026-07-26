# Structured Key Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `:keypress` emits structured KeyboardEvent-like terms — `("a")`, `("A" :shift)`, `(:Enter)`, `("c" :ctrl)` — instead of plain strings.

**Architecture:** A pure exported function `keyEventToTerm` in `src/extensions.ts` owns the readline→DOM normalization (name table, char extraction, modifier append) and is unit-tested without a tty; the `:keypress` source closure shrinks to wiring that calls it. The Prelude gains `member?` for modifier checks. The event shape is a flat list: `car` = key (Str for printable chars, Sym for DOM-named keys), `cdr` = modifier syms in fixed order `:ctrl`, `:alt`, `:shift`.

**Spec:** `docs/superpowers/specs/2026-07-26-structured-key-events-design.md` — read it first.

**Tech Stack:** TypeScript (strict), Node builtins only, plain `node:assert` test scripts.

## Global Constraints

- No new npm dependencies; Node builtins only.
- tsconfig is strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns` are all on. Guard every indexed access.
- Imports use explicit `.ts` extensions.
- Build/run tests from the repo root: `npm run build && node js/tests/<name>.js`.
- Tests are plain scripts using `node:assert` with top-level `{}` blocks per case, ending with a `console.log('ok - ...')` line (house style: `tests/300-trace-test.ts`, `tests/400-connect-test.ts`).
- Match existing code style: aligned `:` in declarations, sparse comments stating constraints only.
- Event shape (spec, binding): `car` is the key — Str for printable characters (space is `" "` as Str), Sym with DOM `KeyboardEvent.key` name for named keys; `cdr` is modifiers present as syms in fixed order `:ctrl`, `:alt`, `:shift`; readline `meta` maps to `:alt`; unnameable sequences become `(:Unidentified)` — never empty, never dropped; Ctrl-C stays intercepted and is never delivered.

---

### Task 1: `keyEventToTerm` normalization function

**Files:**
- Modify: `src/extensions.ts` (add the name table + exported function; do NOT touch the `EVENT_SOURCES.set('keypress', ...)` block in this task)
- Test: `tests/410-keymap-test.ts` (create)

**Interfaces:**
- Consumes: `sym`, `str`, `list`, type `TERM` from `./terms.ts` (already imported in `extensions.ts`); `readline.Key` from `node:readline` (already imported).
- Produces: `export function keyEventToTerm (s : string | undefined, key : readline.Key) : TERM` in `src/extensions.ts` — Task 2 wires the source through it. Always returns a Cons list; never undefined.

- [ ] **Step 1: Write the failing test**

Create `tests/410-keymap-test.ts`:

```ts
import assert from 'node:assert';
import { keyEventToTerm, uncons, isCons, isStr, isSym, pprint, type TERM } from '../src/index.ts';

// flatten a key-event term into comparable JS shapes:
// Str "a" -> 's:a', Sym Enter -> 'y:Enter'
function flat (t : TERM) : string[] {
    assert.ok( isCons(t), `event term is a list, got ${pprint(t)}` );
    return uncons(t).map((x) => {
        if (isStr(x)) return `s:${x.value}`;
        if (isSym(x)) return `y:${x.ident}`;
        throw new Error(`unexpected term in event: ${pprint(x)}`);
    });
}

type Case = { s : string | undefined, key : { name? : string, ctrl? : boolean, meta? : boolean, shift? : boolean }, want : string[], label : string };

const CASES : Case[] = [
    // printable chars arrive as Str
    { s : 'a',    key : { name : 'a' },                          want : ['s:a'],                    label : 'plain char' },
    { s : 'A',    key : { name : 'a', shift : true },            want : ['s:A', 'y:shift'],         label : 'uppercase keeps char, adds :shift' },
    { s : '(',    key : {},                                      want : ['s:('],                    label : 'punctuation with no name' },
    { s : ' ',    key : { name : 'space' },                      want : ['s: '],                    label : 'space is Str " " per DOM' },
    // named keys arrive as Sym with DOM names
    { s : '\r',     key : { name : 'return' },                   want : ['y:Enter'],                label : 'return -> :Enter' },
    { s : '\x1b',   key : { name : 'escape' },                   want : ['y:Escape'],               label : 'escape -> :Escape' },
    { s : '\x1b[A', key : { name : 'up' },                       want : ['y:ArrowUp'],              label : 'up -> :ArrowUp' },
    { s : '\x1b[B', key : { name : 'down' },                     want : ['y:ArrowDown'],            label : 'down -> :ArrowDown' },
    { s : '\x1b[C', key : { name : 'right' },                    want : ['y:ArrowRight'],           label : 'right -> :ArrowRight' },
    { s : '\x1b[D', key : { name : 'left' },                     want : ['y:ArrowLeft'],            label : 'left -> :ArrowLeft' },
    { s : '\x7f',   key : { name : 'backspace' },                want : ['y:Backspace'],            label : 'backspace -> :Backspace' },
    { s : '\t',     key : { name : 'tab' },                      want : ['y:Tab'],                  label : 'tab -> :Tab' },
    { s : undefined, key : { name : 'delete' },                  want : ['y:Delete'],               label : 'delete -> :Delete' },
    { s : undefined, key : { name : 'home' },                    want : ['y:Home'],                 label : 'home -> :Home' },
    { s : undefined, key : { name : 'end' },                     want : ['y:End'],                  label : 'end -> :End' },
    { s : undefined, key : { name : 'pageup' },                  want : ['y:PageUp'],               label : 'pageup -> :PageUp' },
    { s : undefined, key : { name : 'pagedown' },                want : ['y:PageDown'],             label : 'pagedown -> :PageDown' },
    { s : undefined, key : { name : 'insert' },                  want : ['y:Insert'],               label : 'insert -> :Insert' },
    { s : undefined, key : { name : 'f1' },                      want : ['y:F1'],                   label : 'f1 -> :F1' },
    { s : undefined, key : { name : 'f12' },                     want : ['y:F12'],                  label : 'f12 -> :F12' },
    // modifiers: ctrl'd chars use key.name (sequence is a control byte)
    { s : '\x03', key : { name : 'c', ctrl : true },             want : ['s:c', 'y:ctrl'],          label : 'ctrl+c shape (source intercepts before emit)' },
    { s : '\x01', key : { name : 'a', ctrl : true },             want : ['s:a', 'y:ctrl'],          label : 'ctrl+a' },
    { s : '\x1ba', key : { name : 'a', meta : true },            want : ['s:a', 'y:alt'],           label : 'meta maps to :alt' },
    { s : '\x1b[1;2A', key : { name : 'up', shift : true },      want : ['y:ArrowUp', 'y:shift'],   label : 'shift+arrow' },
    // fixed modifier order :ctrl :alt :shift
    { s : undefined, key : { name : 'a', ctrl : true, meta : true, shift : true }, want : ['s:a', 'y:ctrl', 'y:alt', 'y:shift'], label : 'modifier order is ctrl alt shift' },
    // unnameable -> :Unidentified, never empty
    { s : '\x1b[200~', key : {},                                 want : ['y:Unidentified'],         label : 'unnameable escape -> :Unidentified' },
    { s : undefined,   key : {},                                 want : ['y:Unidentified'],         label : 'nothing at all -> :Unidentified' },
];

for (const c of CASES) {
    assert.deepEqual( flat(keyEventToTerm(c.s, c.key)), c.want, c.label );
}

console.log('ok - keymap tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | head -20`
Expected: FAIL — tsc error: `keyEventToTerm` is not exported from `../src/index.ts`. (The failure is at compile time; that's the RED.)

- [ ] **Step 3: Implement `keyEventToTerm` in `src/extensions.ts`**

Add above the `EVENT_SOURCES.set('keypress', ...)` block:

```ts
// readline key names -> DOM KeyboardEvent.key names; space is handled
// separately because its DOM key value is the Str " ", not a Sym
const KEY_NAMES : Map<string, string> = new Map([
    ['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight'],
    ['return', 'Enter'], ['escape', 'Escape'], ['backspace', 'Backspace'], ['tab', 'Tab'],
    ['delete', 'Delete'], ['home', 'Home'], ['end', 'End'],
    ['pageup', 'PageUp'], ['pagedown', 'PageDown'], ['insert', 'Insert'],
    ['f1', 'F1'], ['f2', 'F2'], ['f3', 'F3'], ['f4', 'F4'], ['f5', 'F5'], ['f6', 'F6'],
    ['f7', 'F7'], ['f8', 'F8'], ['f9', 'F9'], ['f10', 'F10'], ['f11', 'F11'], ['f12', 'F12'],
]);

// (key mods...) -- car is the key: Str for printable chars, Sym with the
// DOM KeyboardEvent.key name for named keys, :Unidentified when readline
// can't tell us anything usable; cdr is the modifiers present, in fixed
// order :ctrl :alt :shift (readline's meta flag is physically Alt)
export function keyEventToTerm (s : string | undefined, key : readline.Key) : TERM {
    let name = key.name;
    let head : TERM;
    if (name != undefined && KEY_NAMES.has(name)) {
        head = sym(KEY_NAMES.get(name)!);
    } else if (name === 'space') {
        head = str(' ');
    } else if ((key.ctrl || key.meta) && name != undefined && name.length == 1) {
        // the sequence is a control byte; the semantic char is the name
        head = str(name);
    } else if (s != undefined && s.length == 1 && s >= ' ' && s != '\x7f') {
        head = str(s);
    } else if (name != undefined && name.length == 1) {
        head = str(name);
    } else {
        head = sym('Unidentified');
    }
    let mods : TERM[] = [];
    if (key.ctrl)  mods.push(sym('ctrl'));
    if (key.meta)  mods.push(sym('alt'));
    if (key.shift) mods.push(sym('shift'));
    return list( head, ...mods );
}
```

Check `src/extensions.ts`'s import from `./terms.ts` includes `sym`, `str`, `list`, and `type TERM` — add any that are missing to the existing import statement. (`readline` is already imported from Task 3 of the previous feature.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node js/tests/410-keymap-test.js`
Expected: `ok - keymap tests passed`

- [ ] **Step 5: Run the existing suite for regressions**

Run: `node js/tests/050-env-test.js && node js/tests/100-self-test.js && node js/tests/200-env-test.js && node js/tests/300-trace-test.js && node js/tests/400-connect-test.js`
Expected: all pass (`js/` is fresh from Step 4).

- [ ] **Step 6: Commit**

```bash
git add src/extensions.ts tests/410-keymap-test.ts
git commit -m "feat: keyEventToTerm -- readline-to-DOM key event normalization"
```

---

### Task 2: wire the source, `member?`, migrate the example

**Files:**
- Modify: `src/extensions.ts` (the `EVENT_SOURCES.set('keypress', ...)` block only)
- Modify: `lib/Prelude.slight` (add `member?` in the List functions section)
- Modify: `examples/scratchpad.slight` (new event shape)
- Test: `tests/410-keymap-test.ts` (append `member?` cases)

**Interfaces:**
- Consumes: `keyEventToTerm (s : string | undefined, key : readline.Key) : TERM` from Task 1 (same file).
- Produces: `:keypress` emits flat-list events; Prelude `(member? x lst)` returns `#true`/`#false`.

- [ ] **Step 1: Append the failing `member?` tests**

Append to `tests/410-keymap-test.ts` before the final `console.log` (the file needs two more imports — extend the existing import from `../src/index.ts` with `parse`, `expand`, `initalizeEnv`, `Strand`, and add `import { readFileSync } from 'node:fs';` at the top):

```ts
// -- member? (Prelude) --------------------------------------------------------
{
    let prelude = readFileSync('./lib/Prelude.slight', 'utf8');
    let source  = `
        (list
            (member? :ctrl (list :ctrl :shift))
            (member? :alt  (list :ctrl :shift))
            (member? "a"   (list "a"))
            (member? :x    ()))
    `;
    let exprs   = expand(parse([ prelude, source ].join("\n")));
    let strand  = new Strand();
    let results = await strand.run( exprs, initalizeEnv() );
    let main    = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected member? runner to HALT');
    assert.equal( pprint(main.result), '(#true #false #true #false)', 'member? truth table' );
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && node js/tests/410-keymap-test.js`
Expected: FAIL — the runner's result is an ERR (`Unable to find member? in Env`) so the HALT expectation throws.

- [ ] **Step 3: Add `member?` to `lib/Prelude.slight`**

In the "List functions" section, after `find`:

```lisp
(defun member? (x lst)
    (if (nil? lst) #false
        (if (eq? x (head lst)) #true
            (member? x (tail lst)))))
```

- [ ] **Step 4: Rewire the `:keypress` source**

In `src/extensions.ts`, change only the `onKey` handler inside the `EVENT_SOURCES.set('keypress', ...)` block — the emit line goes through the normalizer, Ctrl-C interception stays first:

```ts
    const onKey = (s : string | undefined, key : readline.Key) => {
        if (key.ctrl && key.name === 'c') { stop(); process.exit(130); }
        emit( keyEventToTerm(s, key) );
    };
```

(Everything else in the block — `emitKeypressEvents`, `isTTY` guards, `resume`/`pause`, listener add/remove — stays exactly as is.)

- [ ] **Step 5: Migrate `examples/scratchpad.slight`**

Replace the file's contents:

```lisp

(defun KeyCatcher ()
    (let key (recv))
    (case (car key)
        ("q"   (pprint "goodbye"))
        (#true
            (pprint key)
            (KeyCatcher))))


(let keyboard (connect :keypress (KeyCatcher)))

(send keyboard (list "h"))
(send keyboard (list "e"))
(send keyboard (list "l"))
(send keyboard (list "l"))
(send keyboard (list "o"))

(send keyboard (list "q"))

(join keyboard)
```

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npm run build && node js/tests/410-keymap-test.js`
Expected: `ok - keymap tests passed`

- [ ] **Step 7: Piped end-to-end check**

Run: `echo -n '' | node js/bin/slight.js examples/scratchpad.slight; echo "EXIT=$?"`
Expected: five lines showing the h/e/l/l/o events in their list form (pprint's exact rendering of `("h")` etc.), then `"goodbye"`, then `EXIT=0`, exiting on its own. A hang or a plain-string-shaped line is a failure.

- [ ] **Step 8: Full suite for regressions**

Run: `node js/tests/050-env-test.js && node js/tests/100-self-test.js && node js/tests/200-env-test.js && node js/tests/300-trace-test.js && node js/tests/400-connect-test.js && node js/tests/410-keymap-test.js`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/extensions.ts lib/Prelude.slight examples/scratchpad.slight tests/410-keymap-test.ts
git commit -m "feat: keypress emits structured key events; member? in Prelude"
```

---

### Post-plan verification (controller, not a task)

Interactive pty check, as done for the previous feature: run a KeyCatcher scratch file, confirm typed chars arrive as `("a")`, an arrow key as `(:ArrowUp)`, `q` exits cleanly, Ctrl-C exits 130 with a restored terminal.
