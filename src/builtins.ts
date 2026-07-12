
import {
    type TERM, type LIST, type Env, type Builtin, type Num, type Str, type Bool, type ERROR,
    isNil, isCons, isNum, isStr, isList, isLiteral, isBool, isTrue, isFalse,
    nil, cons, car, cdr, cadr, cddr, num, str, bool, sym, raise,
    newEnv, bind, eq, list, pprint, uncons
} from './terms.ts';

// -----------------------------------------------------------------------------

export function liftUnOp (name : string, f : (n : TERM) => TERM) : Builtin {
    return {
        type   : 'BIF',
        params : list(sym('n')),
        name   : name,
        body   : (args : LIST) : TERM => {
            try {
                if (isNil(args))       return raise(`Expected 1 arguments, not 0`);
                if (!isNil(cdr(args))) return raise(`Expected 1 arguments, not >1`);
                let n = car(args);
                return f(n);
            } catch (e) {
                return raise(`RUNTIME ERROR!! - ${String(e)}`);
            }
        }
    }
}

export function liftBinOp (name : string, f : (n : TERM, m : TERM) => TERM) : Builtin {
    return {
        type   : 'BIF',
        params : list(sym('n'), sym('m')),
        name   : name,
        body   : (args : LIST) : TERM => {
            try {
                if (isNil(args))        return raise(`Expected 2 arguments, not 0`);
                if (isNil(cdr(args)))   return raise(`Expected 2 arguments, not 1`);
                if (!isNil(cddr(args))) return raise(`Expected 2 arguments, not >2`);
                let n = car(args);
                let m = cadr(args);
                return f(n, m);
            } catch (e) {
                return raise(`RUNTIME ERROR!! - ${String(e)}`);
            }
        }
    }
}

export function liftListOp (name : string, f : (n : LIST) => TERM) : Builtin {
    return {
        type   : 'BIF',
        params : list(sym('...args')),
        name   : name,
        body   : (args : LIST) : TERM => {
            try {
                return f(args);
            } catch (e) {
                return raise(`RUNTIME ERROR!! - ${String(e)}`);
            }
        }
    }
}

export function liftNumBinOp (name : string, f : (n : number, m : number) => number) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Num | ERROR => {
        if (isNum(n) && isNum(m)) {
            return num(f( n.value, m.value ));
        } else {
            return raise(`TYPE-ERROR! - expected Nums got (${n.type} ${m.type})`);
        }
    })
}

export function liftStrBinOp (name : string, f : (n : string, m : string) => string) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Str | ERROR => {
        if (isStr(n) && isStr(m)) {
            return str(f( n.value, m.value ));
        } else {
            return raise(`TYPE-ERROR! - expected Strs got (${n.type} ${m.type})`);
        }
    })
}

type JSLiteral = number | string | boolean

export function liftLiteralBoolOp (name : string, f : (n : JSLiteral, m : JSLiteral) => boolean) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Bool | ERROR => {
        if (isLiteral(n) && isLiteral(m)) {
            return bool(f( n.value, m.value ));
        } else {
            return raise(`TYPE-ERROR! - expected Literals (Str, Num or Bool) got (${n.type} ${m.type})`);
        }
    })
}

// -----------------------------------------------------------------------------

export function initalizeEnv (core : Env | undefined = undefined) : Env {
    let env : Env = core == undefined ? newEnv() : newEnv( core );

    // numeric bin-ops
    env = bind( sym('+'), liftNumBinOp('+', (n, m) => n + m), env );
    env = bind( sym('-'), liftNumBinOp('-', (n, m) => n - m), env );
    env = bind( sym('*'), liftNumBinOp('*', (n, m) => n * m), env );
    env = bind( sym('/'), liftNumBinOp('/', (n, m) => n / m), env );
    env = bind( sym('%'), liftNumBinOp('%', (n, m) => n % m), env );

    // numeric un-ops
    // TODO: ... these
    // (bind .abs   (n) "Num::abs")
    // (bind .cos   (n) "Num::cos")
    // (bind .sin   (n) "Num::sin")
    // (bind .int   (n) "Num::int")
    // (bind .sqrt  (n) "Num::sqrt")
    // (bind .rand  (n) "Num::rand")
    // (bind .chr   (n) "Num::chr")
    // (bind .hex   (n) "Num::hex")
    // (bind .max   (n m) "Num::max")
    // (bind .min   (n m) "Num::min")
    // (bind .ceil  (n m) "Num::ceil")
    // (bind .floor (n m) "Num::floor"))

    // string bin-ops
    env = bind( sym('~'), liftStrBinOp('~', (n, m) => n + m), env );

    // string other-ops
    // TODO: ... these
    // (bind .uc      (n)     "Str::uc")
    // (bind .lc      (n)     "Str::lc")
    // (bind .fc      (n)     "Str::fc")
    // (bind .ucfirst (n)     "Str::ucfirst")
    // (bind .lcfirst (n)     "Str::lcfirst")
    // (bind .hex     (n)     "Str::hex")
    // (bind .oct     (n)     "Str::oct")
    // (bind .chomp   (n)     "Str::chomp")
    // (bind .length  (n)     "Str::length")
    // (bind .index   (n m)   "Str::index")
    // (bind .rindex  (n m)   "Str::rindex")
    // (define .split (n p)   (split p n))
    // (bind .join    (n p)   "join")
    // (bind .repeat  (n r)   "Str::repeat")
    // (bind .substr  (n o l) "Str::substr")
    // ;; TODO
    // ;; - .upper?
    // ;; - .lower?

    // literal comparison bin-ops
    env = bind( sym('=='), liftLiteralBoolOp('==', (n, m) => n == m), env );
    env = bind( sym('!='), liftLiteralBoolOp('!=', (n, m) => n != m), env );
    env = bind( sym('<='), liftLiteralBoolOp('<=', (n, m) => n <= m), env );
    env = bind( sym('<'),  liftLiteralBoolOp('<',  (n, m) => n <  m), env );
    env = bind( sym('>='), liftLiteralBoolOp('>=', (n, m) => n >= m), env );
    env = bind( sym('>'),  liftLiteralBoolOp('>',  (n, m) => n >  m), env );

    // structural equality
    env = bind( sym('eq?'),  liftBinOp('eq?', (n, m) => bool(eq(n, m))),  env );
    env = bind( sym('ne?'),  liftBinOp('ne?', (n, m) => bool(!eq(n, m))), env );

    // type predicates
    env = bind( sym('nil?'),   liftUnOp('nil?',   (t) => bool(isNil(t))),   env );
    env = bind( sym('atom?'),  liftUnOp('atom?',  (t) => bool(!isList(t))), env );
    env = bind( sym('bool?'),  liftUnOp('bool?',  (t) => bool(isBool(t))), env );
    env = bind( sym('true?'),  liftUnOp('true?',  (t) => bool(isBool(t) && isTrue(t))), env );
    env = bind( sym('false?'), liftUnOp('false?', (t) => bool(isBool(t) && isFalse(t))), env );
    // TODO: add other type predicates

    env = bind( sym('not'),  liftUnOp('not',  (t) => bool(isBool(t) ? !isTrue(t) : isNil(t))), env );

    // cons functions
    env = bind( sym('cons'), liftBinOp('cons',  (h, t) => { if (isList(t))    return cons(h, t); return raise(`Expected a list for second arg to cons, not ${t.type}`); }), env );
    env = bind( sym('car'),  liftUnOp('car',    (list) => { if (isCons(list)) return car(list);  return raise(`Expected a list for car, not ${list.type}`); }),  env );
    env = bind( sym('cdr'),  liftUnOp('cdr',    (list) => { if (isCons(list)) return cdr(list);  return raise(`Expected a list for cdr, not ${list.type}`); }),  env );
    env = bind( sym('cadr'), liftUnOp('cadr',   (list) => { if (isCons(list)) return cadr(list); return raise(`Expected a list for cadr, not ${list.type}`); }),  env );
    env = bind( sym('cddr'), liftUnOp('cddr',   (list) => { if (isCons(list)) return cddr(list); return raise(`Expected a list for cddr, not ${list.type}`); }),  env );

    // list functions
    env = bind( sym('list'), liftListOp('list', (args) => args), env );
    env = bind( sym('head'), liftUnOp('head',   (list) => { if (isCons(list)) return car(list); return raise(`Expected a list for head, not ${list.type}`); }),  env );
    env = bind( sym('tail'), liftUnOp('tail',   (list) => { if (isCons(list)) return cdr(list); return raise(`Expected a list for tail, not ${list.type}`); }),  env );

    // utilities ...

    // NOTE: this is just a place to park this work now
    // until the I/O system evolves
    env = bind( sym('sys/io/print-ln'), liftListOp('sys/io/print-ln', (args) => {
        console.log(uncons(args).map((arg) =>
            isStr(arg) ? arg.value : pprint(arg)
        ).join(''));
        return nil;
    }), env );

    env = bind( sym('pprint'),   liftUnOp('pprint', (t) => { console.log(pprint(t)); return nil; }), env );
    env = bind( sym('time'),     liftUnOp('time',     (t) => { if (!isStr(t)) return raise(`time expects a STR label, not ${t.type}`);     console.time(t.value);    return nil; }), env );
    env = bind( sym('time/end'), liftUnOp('time/end', (t) => { if (!isStr(t)) return raise(`time/end expects a STR label, not ${t.type}`); console.timeEnd(t.value); return nil; }), env );

    return env;
}
