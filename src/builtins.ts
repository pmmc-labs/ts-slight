
import {
    type TERM, type LIST, type MapEnv, type Builtin,
    type Num, type Str, type Sym, type Bool, type ERROR,
    type Cons, type LITERAL,
    isNil, isCons, isNum, isStr, isList, isLiteral, isBool, isTrue, isFalse,
    isCallable, isSym, isLambda, isBuiltin,
    TRUE, FALSE, NIL, cons, car, cdr, cadr, cddr, num, str, bool, sym, raise,
    newMapEnv, bind, eq, list, pprint, uncons
} from './terms.ts';

// -----------------------------------------------------------------------------


export function liftNulOp (name : string, f : () => TERM) : Builtin {
    return {
        type   : 'BIF',
        params : NIL,
        name   : name,
        body   : () : TERM => {
            try {
                return f();
            } catch (e) {
                return raise(`RUNTIME ERROR!! in ${name} - ${String(e)}`);
            }
        }
    }
}

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
                return raise(`RUNTIME ERROR!! in ${name} - ${String(e)}`);
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
                if (isNil(args))        return raise(`${name} expected 2 arguments, not 0`);
                if (isNil(cdr(args)))   return raise(`${name} expected 2 arguments, not 1`);
                if (!isNil(cddr(args))) return raise(`${name} expected 2 arguments, not >2`);
                let n = car(args);
                let m = cadr(args);
                return f(n, m);
            } catch (e) {
                return raise(`RUNTIME ERROR!! in ${name} - ${String(e)}`);
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
                return raise(`RUNTIME ERROR!! in ${name} - ${String(e)}`);
            }
        }
    }
}

// ...

export function liftNumUnOp (name : string, f : (n : number) => number) : Builtin {
    return liftUnOp(name, (n : TERM) : Num | ERROR => {
        if (!isNum(n)) return raise(`TYPE-ERROR! - ${name} expected Num got (${n.type})`);
        return num(f( n.value ));
    })
}

export function liftNumBinOp (name : string, f : (n : number, m : number) => number) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Num | ERROR => {
        if (isNum(n) && isNum(m)) {
            return num(f( n.value, m.value ));
        } else {
            return raise(`TYPE-ERROR! - ${name} expected Nums got (${n.type} ${m.type})`);
        }
    })
}

export function liftStrUnOp (name : string, f : (n : string) => string) : Builtin {
    return liftUnOp(name, (n : TERM) : Str | ERROR => {
        if (!isStr(n)) return raise(`TYPE-ERROR! - ${name} expected Str got (${n.type})`);
        return str(f( n.value ));
    })
}

export function liftStrBinOp (name : string, f : (n : string, m : string) => string) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Str | ERROR => {
        if (isStr(n) && isStr(m)) {
            return str(f( n.value, m.value ));
        } else {
            return raise(`TYPE-ERROR! - ${name} expected Strs got (${n.type} ${m.type})`);
        }
    })
}

type JSLiteral = number | string | boolean

export function liftLiteralBoolOp (name : string, f : (n : JSLiteral, m : JSLiteral) => boolean) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Bool | ERROR => {
        if (isLiteral(n) && isLiteral(m)) {
            return f( n.value, m.value ) ? TRUE : FALSE;
        } else {
            return raise(`TYPE-ERROR! - ${name} expected Literals (Str, Num or Bool) got (${n.type} ${m.type})`);
        }
    })
}

// -----------------------------------------------------------------------------

export function initalizeEnv (core : MapEnv | undefined = undefined) : MapEnv {
    let env : MapEnv = newMapEnv( core );

    // -------------------------------------------------------------------------
    // Maths
    // -------------------------------------------------------------------------

    // numeric ops
    env = bind( sym('+'), liftNumBinOp('+', (n, m) => n + m), env );
    env = bind( sym('-'), liftNumBinOp('-', (n, m) => n - m), env );
    env = bind( sym('*'), liftNumBinOp('*', (n, m) => n * m), env );
    env = bind( sym('/'), liftNumBinOp('/', (n, m) => n / m), env );
    env = bind( sym('%'), liftNumBinOp('%', (n, m) => n % m), env );

    // XXX:
    // consider moving these (or subset of these) into a Math extension
    env = bind( sym('PI'), num(Math.PI), env );
    env = bind( sym('max'), liftNumBinOp('max', (n, m) => Math.max(n, m)), env );
    env = bind( sym('min'), liftNumBinOp('min', (n, m) => Math.min(n, m)), env );
    env = bind( sym('pow'), liftNumBinOp('pow', (n, m) => Math.pow(n, m)), env );

    env = bind( sym('abs'), liftNumUnOp('abs', (n) => Math.abs(n)), env );
    env = bind( sym('cos'), liftNumUnOp('cos', (n) => Math.cos(n)), env );
    env = bind( sym('sin'), liftNumUnOp('sin', (n) => Math.sin(n)), env );
    env = bind( sym('exp'), liftNumUnOp('exp', (n) => Math.exp(n)), env );
    env = bind( sym('tan'), liftNumUnOp('tan', (n) => Math.tan(n)), env );

    env = bind( sym('ceil'),  liftNumUnOp('ceil',  (n) => Math.ceil(n)),  env );
    env = bind( sym('sqrt'),  liftNumUnOp('sqrt',  (n) => Math.sqrt(n)),  env );

    env = bind( sym('floor'), liftNumUnOp('floor', (n) => Math.floor(n)), env );
    env = bind( sym('round'), liftNumUnOp('round', (n) => Math.round(n)), env );
    env = bind( sym('trunc'), liftNumUnOp('trunc', (n) => Math.trunc(n)), env );

    env = bind( sym('rand'), liftNumUnOp('rand', (n) => Math.floor(Math.random() * n)), env );

    env = bind( sym('format-num'), liftListOp('format-num', (args) => {
        let [ n, w, c ] = uncons(args).map((e) => (e as LITERAL).value);
        if (n == undefined || w == undefined) return raise(`ARITY-ERROR: You must supply at least a number and a width`);
        if (c == undefined) c = ' ';
        return str(n.toString().padStart(w as number, c as string));
    }), env );

    // -------------------------------------------------------------------------
    // Strings
    // -------------------------------------------------------------------------

    // string ops
    env = bind( sym('~'),      liftStrBinOp('~', (n, m) => n + m), env );
    env = bind( sym('uc'),     liftStrUnOp('uc', (s) => s.toUpperCase()), env );
    env = bind( sym('lc'),     liftStrUnOp('lc', (s) => s.toLowerCase()), env );
    env = bind( sym('concat'), liftListOp('concat', (args) => str(uncons(args).map((arg) => isStr(arg) ? arg.value : pprint(arg)).join(''))), env );

    // XXX:
    // consider moving these (or subset of these) into a String extension

    env = bind( sym('str-splice-at'), liftListOp('str-splice-at', (args) : Str | ERROR => {
        let [ s, i, c ] = uncons(args);
        if (s == undefined || !isStr(s)) return raise(`TYPE-ERROR! - (str-splice-at) expected Str for the first arg, got  (${s == undefined ? 'UNDEF' : s.type})`);
        if (i == undefined || !isNum(i)) return raise(`TYPE-ERROR! - (str-splice-at) expected Num for the second arg, got (${i == undefined ? 'UNDEF' : i.type})`);
        if (c == undefined) return raise(`TYPE-ERROR! - (str-splice-at) expected Str | Nil for the third arg, got (UNDEF)`);
        let to_splice = s.value;
        let idx       = i.value;
        if (isStr(c)) {
            if (idx < to_splice.length) {
                return str( to_splice.slice(0, idx) + c.value + to_splice.slice(idx) )
            } else if (idx == to_splice.length) {
                return str( to_splice + c.value );
            } else {
                return str( to_splice + (" ".repeat(idx - to_splice.length)) + c.value );
            }
        }
        else if (isNil(c)) {
            if (idx < to_splice.length) {
                return str( to_splice.slice(0, (idx - 1)) + to_splice.slice(idx) )
            } else if (idx == to_splice.length) {
                return str( to_splice.slice(0, (idx - 1)) )
            } else {
                return s;
            }
        }
        else {
            return raise(`TYPE-ERROR! - (str-splice-at) expected Str | Nil for the third arg, got  (${c == undefined ? 'UNDEF' : c.type})`);
        }
    }), env );

    env = bind( sym('str-split-at'), liftBinOp('str-split-at', (s : TERM, m : TERM) : LIST | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (str-split-at) expected Str for the first arg, got (${s.type})`);
        if (!isNum(m)) return raise(`TYPE-ERROR! - (str-split-at) expected Num for the second arg, got (${m.type})`);
        if (s.value.length == 0) return NIL;
        return list( str(s.value.slice(0, m.value)), str(s.value.slice(m.value)) );
    }), env );

    // searching ...
    env = bind( sym('index-of'), liftBinOp('index-of', (s : TERM, m : TERM) : Num | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (index-of) expected Str for the first arg, got (${s.type})`);
        if (!isStr(m)) return raise(`TYPE-ERROR! - (index-of) expected Str for the second arg, got (${s.type})`);
        return num(s.value.indexOf(m.value));
    }), env );

    env = bind( sym('last-index-of'), liftBinOp('last-index-of', (s : TERM, m : TERM) : Num | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (last-index-of) expected Str for the first arg, got (${s.type})`);
        if (!isStr(m)) return raise(`TYPE-ERROR! - (last-index-of) expected Str for the second arg, got (${s.type})`);
        return num(s.value.lastIndexOf(m.value));
    }), env );

    // predicates ...
    env = bind( sym('starts-with'), liftBinOp('starts-with', (s : TERM, m : TERM) : Bool | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (starts-with) expected Str for the first arg, got (${s.type})`);
        if (!isStr(m)) return raise(`TYPE-ERROR! - (starts-with) expected Str for the second arg, got (${s.type})`);
        return bool(s.value.startsWith(m.value));
    }), env );
    env = bind( sym('ends-with'), liftBinOp('ends-with', (s : TERM, m : TERM) : Bool | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (ends-with) expected Str for the first arg, got (${s.type})`);
        if (!isStr(m)) return raise(`TYPE-ERROR! - (ends-with) expected Str for the second arg, got (${s.type})`);
        return bool(s.value.endsWith(m.value));
    }), env );

    // padding & constructing
    env = bind( sym('pad-end'), liftListOp('pad-end', (args) : Str | ERROR => {
        let [ s, n, l ] = uncons(args);
        if (s == undefined || !isStr(s)) return raise(`TYPE-ERROR! - (pad-end) expected Str for the first arg, got  (${s == undefined ? 'UNDEF' : s.type})`);
        if (n == undefined || !isNum(n)) return raise(`TYPE-ERROR! - (pad-end) expected Num for the second arg, got (${n == undefined ? 'UNDEF' : n.type})`);
        if (l == undefined || !isStr(l)) return raise(`TYPE-ERROR! - (pad-end) expected Str for the third arg, got  (${l == undefined ? 'UNDEF' : l.type})`);
        return str(s.value.padEnd(n.value, l.value));
    }), env );
    env = bind( sym('pad-start'), liftListOp('pad-start', (args) : Str | ERROR => {
        let [ s, n, l ] = uncons(args);
        if (s == undefined || !isStr(s)) return raise(`TYPE-ERROR! - (pad-start) expected Str for the first arg, got  (${s == undefined ? 'UNDEF' : s.type})`);
        if (n == undefined || !isNum(n)) return raise(`TYPE-ERROR! - (pad-start) expected Num for the second arg, got (${n == undefined ? 'UNDEF' : n.type})`);
        if (l == undefined || !isStr(l)) return raise(`TYPE-ERROR! - (pad-start) expected Str for the third arg, got  (${l == undefined ? 'UNDEF' : l.type})`);
        return str(s.value.padStart(n.value, l.value));
    }), env );

    env = bind( sym('str-repeat'), liftBinOp('str-repeat', (s : TERM, n : TERM) : Str | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (str-repeat) expected Str for the first arg, got (${s.type})`);
        if (!isNum(n)) return raise(`TYPE-ERROR! - (str-repeat) expected Num for the second arg, got (${n.type})`);
        return str(s.value.repeat(n.value));
    }), env );

    env = bind( sym('str-split'), liftBinOp('str-split', (s : TERM, m : TERM) : LIST | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (str-split) expected Str for the first arg, got (${s.type})`);
        if (!isStr(m)) return raise(`TYPE-ERROR! - (str-split) expected Str for the second arg, got (${m.type})`);
        if (s.value.length == 0) return NIL;
        return list( ...s.value.split(m.value).map(str) );
    }), env );

    // properties ...
    env = bind( sym('str-len'), liftUnOp('str-len', (s : TERM) : Num | ERROR => {
        if (!isStr(s)) return raise(`TYPE-ERROR! - (str-length) expected Str got (${s.type})`);
        return num(s.value.length);
    }), env );

    // -------------------------------------------------------------------------
    // Equality & Ordering
    // -------------------------------------------------------------------------

    // literal comparison bin-ops (num, str, bool)
    env = bind( sym('=='), liftLiteralBoolOp('==', (n, m) => n == m), env );
    env = bind( sym('!='), liftLiteralBoolOp('!=', (n, m) => n != m), env );
    env = bind( sym('<='), liftLiteralBoolOp('<=', (n, m) => n <= m), env );
    env = bind( sym('<'),  liftLiteralBoolOp('<',  (n, m) => n <  m), env );
    env = bind( sym('>='), liftLiteralBoolOp('>=', (n, m) => n >= m), env );
    env = bind( sym('>'),  liftLiteralBoolOp('>',  (n, m) => n >  m), env );

    // -------------------------------------------------------------------------
    // Predicates
    // -------------------------------------------------------------------------

    // structural equality
    env = bind( sym('eq?'),  liftBinOp('eq?', (n, m) => eq(n, m) ? TRUE : FALSE), env );
    env = bind( sym('ne?'),  liftBinOp('ne?', (n, m) => eq(n, m) ? FALSE : TRUE), env );

    // type predicates
    env = bind( sym('nil?'),      liftUnOp('nil?',      (t) => isNil(t)      ? TRUE : FALSE), env );
    env = bind( sym('atom?'),     liftUnOp('atom?',     (t) => !isList(t)    ? TRUE : FALSE), env );
    env = bind( sym('list?'),     liftUnOp('list?',     (t) => isList(t)     ? TRUE : FALSE), env );
    env = bind( sym('cons?'),     liftUnOp('cons?',     (t) => isCons(t)     ? TRUE : FALSE), env );

    env = bind( sym('sym?'),      liftUnOp('sym?',      (t) => isSym(t)      ? TRUE : FALSE), env );
    env = bind( sym('str?'),      liftUnOp('str?',      (t) => isStr(t)      ? TRUE : FALSE), env );
    env = bind( sym('num?'),      liftUnOp('num?',      (t) => isNum(t)      ? TRUE : FALSE), env );
    env = bind( sym('bool?'),     liftUnOp('bool?',     (t) => isBool(t)     ? TRUE : FALSE), env );
    env = bind( sym('literal?'),  liftUnOp('literal?',  (t) => isLiteral(t)  ? TRUE : FALSE), env );

    env = bind( sym('lambda?'),   liftUnOp('lambda?',   (t) => isLambda(t)   ? TRUE : FALSE), env );
    env = bind( sym('builtin?'),  liftUnOp('builtin?',  (t) => isBuiltin(t)  ? TRUE : FALSE), env );
    env = bind( sym('callable?'), liftUnOp('callable?', (t) => isCallable(t) ? TRUE : FALSE), env );

    env = bind( sym('true?'),     liftUnOp('true?',     (t) => isBool(t) && t === TRUE  ? TRUE : FALSE), env );
    env = bind( sym('false?'),    liftUnOp('false?',    (t) => isBool(t) && t === FALSE ? TRUE : FALSE), env );

    env = bind( sym('type-of'),   liftUnOp('type-of',   (t) => str(t.type)), env );

    // -------------------------------------------------------------------------
    // Booleans
    // -------------------------------------------------------------------------

    env = bind( sym('not'),  liftUnOp('not',  (t) => bool(isBool(t) ? t !== TRUE : t === NIL)), env );

    // -------------------------------------------------------------------------
    // Lists and Pairs
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Utils ...
    // -------------------------------------------------------------------------

    env = bind( sym('raise'), liftUnOp('raise', (t) => raise(t)), env );

    env = bind( sym('pprint'), liftUnOp('pprint', (t) => { console.log(pprint(t)); return NIL; }), env );

    let GENSYM_SEQ = 0;
    env = bind( sym('gensym'), liftNulOp('gensym', () => sym(`#:${++GENSYM_SEQ}`)), env );

    return env;
}
