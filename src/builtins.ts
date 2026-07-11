
import {
    type TERM, type LIST, type Env, type Builtin, type Num, type Bool, type ERROR,
    isNil, isCons, isNum, isStr, isList,
    nil, cons, car, cdr, cadr, cddr, num, str, bool, sym, raise,
    newEnv, bind, eq, list, pprint,
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
            return raise(`Must be numbers, duh!`);
        }
    })
}

export function liftNumBoolOp (name : string, f : (n : number, m : number) => boolean) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Bool | ERROR => {
        if (isNum(n) && isNum(m)) {
            return bool(f( n.value, m.value ));
        } else {
            return raise(`Must be numbers, duh!`);
        }
    })
}

// -----------------------------------------------------------------------------

export function initalizeEnv (core : Env | undefined = undefined) : Env {
    let env : Env = core == undefined ? newEnv() : newEnv( core );
    env = bind( sym('+'), liftNumBinOp('+', (n, m) => n + m), env );
    env = bind( sym('-'), liftNumBinOp('-', (n, m) => n - m), env );
    env = bind( sym('*'), liftNumBinOp('*', (n, m) => n * m), env );
    env = bind( sym('/'), liftNumBinOp('/', (n, m) => n / m), env );
    env = bind( sym('%'), liftNumBinOp('%', (n, m) => n % m), env );

    env = bind( sym('=='), liftNumBoolOp('==', (n, m) => n == m), env );
    env = bind( sym('!='), liftNumBoolOp('!=', (n, m) => n != m), env );
    env = bind( sym('<='), liftNumBoolOp('<=', (n, m) => n <= m), env );
    env = bind( sym('<'),  liftNumBoolOp('<',  (n, m) => n <  m), env );
    env = bind( sym('>='), liftNumBoolOp('>=', (n, m) => n >= m), env );
    env = bind( sym('>'),  liftNumBoolOp('>',  (n, m) => n >  m), env );

    env = bind( sym('eq?'),  liftBinOp('eq?', (n, m) => bool(eq(n, m))),  env );
    env = bind( sym('ne?'),  liftBinOp('ne?', (n, m) => bool(!eq(n, m))), env );

    env = bind( sym('nil?'), liftUnOp('nil?', (t)    => bool(isNil(t))),  env );

    env = bind( sym('list'), liftListOp('list', (args) => args), env );
    env = bind( sym('head'), liftUnOp('head', (list) => {
        if (isCons(list)) return car(list);
        return raise(`Expected a list for head, not ${list.type}`);
    }),  env );
    env = bind( sym('tail'), liftUnOp('tail', (list) => {
        if (isCons(list)) return cdr(list);
        return raise(`Expected a list for tail, not ${list.type}`);
    }),  env );
    env = bind( sym('cons'), liftBinOp( 'cons', (h, t) => {
        if (isList(t)) return cons(h, t);
        return raise(`Expected a list for second arg to cons, not ${t.type}`);
    }), env );

    env = bind( sym('pprint'), liftUnOp( 'pprint', (t) => {
        console.log(pprint(t));
        return nil;
    }), env );

    env = bind( sym('time'),     liftUnOp('time',     (t) => { if (!isStr(t)) return raise(`time expects a STR label, not ${t.type}`);     console.time(t.value);    return nil; }), env );
    env = bind( sym('time/end'), liftUnOp('time/end', (t) => { if (!isStr(t)) return raise(`time/end expects a STR label, not ${t.type}`); console.timeEnd(t.value); return nil; }), env );

    return env;
}
