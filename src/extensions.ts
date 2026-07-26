
import * as readline from 'node:readline';
import {
    type TERM, type LIST, type MapEnv, type Builtin, type Num, type Str, type Sym, type Bool, type ERROR, type Cons,
    isNil, isCons, isNum, isStr, isList, isLiteral, isBool, isTrue, isFalse, isCallable,
    TRUE, FALSE, NIL, cons, car, cdr, cadr, cddr, num, str, bool, sym, raise,
    newMapEnv, bind, eq, list, pprint, uncons
} from './terms.ts';

import {
    liftNulOp, liftUnOp, liftBinOp, liftListOp,
    liftNumUnOp, liftNumBinOp,
    liftStrUnOp, liftStrBinOp,
    liftLiteralBoolOp,
} from './builtins.ts';

import { EVENT_SOURCES } from './sources.ts';

export function applyDefaultExtensions (env : MapEnv) : MapEnv {
    env = Constants( env );
    env = IO( env );
    env = Terminal( env );
    env = Benchmarking( env );
    return env;
}

export function Constants (env : MapEnv) : MapEnv {

    env = bind( sym("\\n"), str("\n"),   env );
    env = bind( sym("\\r"), str("\r"),   env );
    env = bind( sym("\\e"), str("\x1b"), env );

    return env;
}

export function IO (env : MapEnv) : MapEnv {
    // NOTE: this is just a place to park this work now
    // until the I/O system evolves
    env = bind( sym('sys/io/print-ln'), liftListOp('sys/io/print-ln', (args) => {
        if (isNil(args)) return NIL;
        if (isCons(args.first)) args = args.first;
        console.log(uncons(args).map((arg) =>
            isStr(arg) ? arg.value : pprint(arg)
        ).join(''));
        return NIL;
    }), env );

    return env;
}

export function Terminal (env : MapEnv) : MapEnv {

    // immediate mode GUI :P
    env = bind( sym('poke'), liftBinOp('poke', (char, at) => {
        let c = (char as Str).value;
        let [ x, y ] = uncons(at as Cons).map((n) => (n as Num).value);
        process.stdout.write(`\x1b[s\x1b[${x};${y}H${c}\x1b[u`)
        return NIL;
    }), env );

    env = bind( sym('ansi/hide-cursor'), liftNulOp('ansi/hide-cursor', () => {
        process.stdout.write("\x1b[?25l");
        process.on('SIGINT', () => { // XXX - kinda gross, but works for now
            process.stdout.write("\x1b[?25h");
            process.exit();
        });
        return NIL;
    }), env );

    env = bind( sym('ansi/show-cursor'), liftNulOp('ansi/show-cursor', () => {
        process.stdout.write("\x1b[?25h");
        return NIL;
    }), env );


    // GOOD STUFF BELOW, above is legacy stuff to be removed

    env = bind( sym('tty/screen/rows'), liftNulOp('tty/screen/rows', () => num( process.stdout.rows )), env );
    env = bind( sym('tty/screen/cols'), liftNulOp('tty/screen/cols', () => num( process.stdout.columns )), env );

    env = bind( sym('tty/write'), liftListOp('tty/write', (args) => {
        if (isNil(args)) return NIL;
        if (isCons(args.first)) args = args.first;
        process.stdout.write(uncons(args).map((arg) =>
            isStr(arg) ? arg.value : pprint(arg)
        ).join(''));
        return NIL;
    }), env );

    return env;
}

export function Benchmarking (env : MapEnv) : MapEnv {
    // cheap benchmarking that is probably totally inaccurate
    // but it is something for the moment, more better later

    env = bind( sym('time-it'), liftUnOp('time-it', (t) => {
        if (!isStr(t)) return raise(`time-it expects a STR label, not ${t.type}`);
        console.time(t.value);
        return NIL;
    }), env );

    env = bind( sym('time-it/end'), liftUnOp('time-it/end', (t) => {
        if (!isStr(t)) return raise(`time-it/end expects a STR label, not ${t.type}`);
        console.timeEnd(t.value);
        return NIL;
    }), env );

    return env;
}

// readline key names -> DOM KeyboardEvent.key names; space is handled
// separately because its DOM key value is the Str " ", not a Sym
export const KEY_NAMES : Map<string, string> = new Map([
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
// This function is readline-specific; a browser source maps
// KeyboardEvent.key directly by the same length-1-code-point rule rather
// than calling this.
export function keyEventToTerm (s : string | undefined, key : readline.Key) : TERM {
    let name = key.name;
    let head : TERM;
    if (name != undefined && KEY_NAMES.has(name)) {
        head = sym(KEY_NAMES.get(name)!);
    } else if (name === 'space') {
        head = str(' ');
    } else if ((key.ctrl || key.meta) && name != undefined && [...name].length == 1) {
        // the sequence is a control byte; the semantic char is the name
        head = str(name);
    } else if (s != undefined && [...s].length == 1 && s >= ' ' && s != '\x7f') {
        head = str(s);
    } else if (name != undefined && [...name].length == 1) {
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

// :keypress -- one key-event list per key (see keyEventToTerm). Ctrl-C is intercepted:
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
        emit( keyEventToTerm(s, key) );
    };
    process.stdin.on('keypress', onKey);
    const stop = () => {
        process.stdin.off('keypress', onKey);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
    };
    return stop;
});

