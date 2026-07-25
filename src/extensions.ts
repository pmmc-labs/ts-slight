
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

export function applyDefaultExtensions (env : MapEnv) : MapEnv {
    env = Constants( env );
    env = IO( env );
    env = Terminal( env );
    env = Benchmarking( env );
    return env;
}

export function Constants (env : MapEnv) : MapEnv {
    // ... ???
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



