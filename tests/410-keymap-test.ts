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
