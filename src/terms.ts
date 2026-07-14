export type LITERAL  = Bool | Str | Num
export type LIST     = Cons | Nil
export type CALLABLE = Lambda | Builtin
export type TERM     = LIST | LITERAL | CALLABLE | Sym | Pid | Env | ERROR

export type Nil      = { type : 'NIL' }
export type Cons     = { type : 'CONS', first  : TERM, rest: LIST }

export type Sym      = { type : 'SYM',   ident : string }
export type Pid      = { type : 'PID',   ident : number }
export type Str      = { type : 'STR',   value : string }
export type Num      = { type : 'NUM',   value : number }
export type Bool     = { type : 'BOOL',  value : boolean }
export type ERROR    = { type : 'ERROR', error : any }

export type RibNode  = { name : string, value : TERM, next : RibNode | undefined }
export type MapEnv   = { type : 'MENV', bindings : Map<string,TERM>, parent : MapEnv | undefined }
export type RibEnv   = { type : 'RENV', head : RibNode | undefined,  parent : Env }
export type Env      = MapEnv | RibEnv
export type Lambda   = { type : 'LAMBDA', params : LIST, body : TERM, env : Env }
export type Builtin  = { type : 'BIF',    params : LIST, body : (args : LIST) => TERM, name : string }
// -----------------------------------------------------------------------------

export const NIL   : Nil  = { type : 'NIL' }
export const TRUE  : Bool = { type : 'BOOL', value : true }
export const FALSE : Bool = { type : 'BOOL', value : false }

// -----------------------------------------------------------------------------

export function isTrue  (t : Bool) : boolean { return t === TRUE }
export function isFalse (t : Bool) : boolean { return t === FALSE }

export function isNil   (t : TERM) : t is Nil  { return t === NIL  }

export function isCons (t : TERM) : t is Cons { return t.type === 'CONS' }
export function isSym  (t : TERM) : t is Sym  { return t.type === 'SYM'  }
export function isPid  (t : TERM) : t is Pid  { return t.type === 'PID'  }
export function isStr  (t : TERM) : t is Str  { return t.type === 'STR'  }
export function isNum  (t : TERM) : t is Num  { return t.type === 'NUM'  }
export function isBool (t : TERM) : t is Bool { return t.type === 'BOOL' }

export function isError (t : TERM) : t is ERROR  { return t.type == 'ERROR' }

export function isBuiltin (t : TERM) : t is Builtin { return t.type == 'BIF' }
export function isLambda  (t : TERM) : t is Lambda  { return t.type == 'LAMBDA' }
export function isEnv     (t : TERM) : t is Env  { return t.type == 'MENV' || t.type == 'RENV' }

export function isLiteral  (t : TERM) : t is LITERAL  { return isStr(t) || isNum(t) || isBool(t) }
export function isList     (t : TERM) : t is LIST     { return isNil(t) || isCons(t) }
export function isCallable (t : TERM) : t is CALLABLE { return isBuiltin(t) || isLambda(t) }

// -----------------------------------------------------------------------------

export function newPid (ident : number) : Pid {
    return { type : 'PID', ident }
}

export function bool (value : boolean) : Bool {
    return value ? TRUE : FALSE
}

export function cons (first : TERM, rest : LIST) : Cons {
    return { type : 'CONS', first, rest }
}

export function num (value : number) : Num  {
    return { type : 'NUM',  value }
}

export function str (value : string) : Str  {
    return { type : 'STR',  value }
}

export function sym (ident : string) : Sym {
    return { type : 'SYM', ident };
}

export function lambda (params : LIST, body : TERM, env : Env) : Lambda {
    return { type : 'LAMBDA', params, body, env }
}

export function raise (error : any) : ERROR {
    return { type : 'ERROR', error }
}

// list stuff ...

export function list (...args : TERM[]) : LIST {
    let xs : LIST = NIL;
    for (const arg of args.reverse()) {
        xs = cons(arg, xs)
    }
    return xs;
}

export function car (list : Cons) : TERM { return list.first }
export function cdr (list : Cons) : LIST { return list.rest  }

export function cadr (list : Cons) : TERM {
    if (isNil(list.rest)) return raise(`Cannot call cadr on a list with a NIL tail`);
    return list.rest.first;
}

export function cddr (list : Cons) : LIST | ERROR {
    if (isNil(list.rest)) return raise(`Cannot call cddr on a list with a NIL tail`);
    return list.rest.rest;
}

// env stuff ...

export function newMapEnv (parent : MapEnv | undefined = undefined) : MapEnv {
    return { type : 'MENV', bindings : new Map<string,TERM>(), parent }
}

export function newRibEnv (parent : Env) : RibEnv {
    return { type : 'RENV', head : undefined, parent }
}

// Fork-time snapshot: pins the head of EVERY rib frame down to the
// MENV boundary (deeper frames become innermost again when control
// returns to them, so one level is not enough -- see the
// fork-inside-a-lambda test). O(rib depth), typically 1-2 frames.
// The parent keeps prepending to its own live heads; the snapshot
// never sees those. MENV layers are only written before processes
// run, so they are safe to share as-is.
export function snapshotEnv (env : Env) : Env {
    if (env.type == 'MENV') return env;
    return { type : 'RENV', head : env.head, parent : snapshotEnv(env.parent) };
}

// NOTE: mutates env in place -- MENV overwrites the Map entry, RENV
// prepends a node (a re-bind shadows; lookup finds the newest first)
export function bind<E extends Env> (name : Sym, value : TERM, env : E) : E {
    if (env.type == 'MENV') {
        env.bindings.set( name.ident, value );
    } else {
        env.head = { name : name.ident, value, next : env.head };
    }
    return env;
}

export function lookup (name : Sym, env : Env) : TERM {
    let ident = name.ident;
    let e : Env | undefined = env;
    while (e != undefined) {
        if (e.type == 'RENV') {
            let node = e.head;
            while (node != undefined) {
                if (node.name == ident) return node.value;
                node = node.next;
            }
        } else {
            let found = e.bindings.get(ident);
            // no TERM is ever undefined, so get doubles as has
            if (found !== undefined) return found;
        }
        e = e.parent;
    }
    return raise(`Unable to find ${name.ident} in Env`);
}

export function bindParams (params : LIST, args : LIST, env : Env) : RibEnv | ERROR {
    let head : RibNode | undefined = undefined;
    while (!isNil(params)) {
        if (isNil(args))          return raise(`ARITY MISMATCH! missing ${pprint(params)} parameter`);
        if (!isSym(params.first)) return raise(`Expected parameter to be a symbol, wtf!`);
        head   = { name : params.first.ident, value : args.first, next : head };
        params = params.rest;
        args   = args.rest;
    }
    if (args !== NIL) return raise(`ARITY MISMATCH! got extra args ${pprint(args)}`);
    return { type : 'RENV', head, parent : env };
}

// ...

export function uncons (list : LIST) : TERM[] {
    let terms = [];
    while (!isNil(list)) {
        terms.push(list.first);
        list = list.rest;
    }
    return terms;
}

export function eq (lhs : TERM, rhs : TERM) : boolean {
    switch (true) {
    case isNil(lhs)     && isNil(rhs)     : return true;
    case isLiteral(lhs) && isLiteral(rhs) : return lhs.value == rhs.value;
    case isSym(lhs)     && isSym(rhs)     : return lhs.ident == rhs.ident;
    case isPid(lhs)     && isPid(rhs)     : return lhs.ident == rhs.ident;
    case isCons(lhs)    && isCons(rhs)    : {
        // iterate the spines (recursing per cell would blow the JS stack on long lists)
        while (isCons(lhs) && isCons(rhs)) {
            if (!eq(lhs.first, rhs.first)) return false;
            lhs = lhs.rest;
            rhs = rhs.rest;
        }
        return isNil(lhs) && isNil(rhs);
    }
    case isLambda(lhs)  && isLambda(rhs)  : return eq(lhs.params, rhs.params) && eq(lhs.body, rhs.body) && lhs.env === rhs.env;
    case isBuiltin(lhs) && isBuiltin(rhs) : return eq(lhs.params, rhs.params) && lhs.body === rhs.body && lhs.name == rhs.name;
    case isError(lhs)   && isError(rhs)   : return lhs.error === rhs.error;
    default :
        return false;
    }
}

export function pprint (t : TERM) : string {
    switch (true) {
    case isStr(t)     : return `"${t.value}"`
    case isNum(t)     : return t.value.toString()
    case isBool(t)    : return t.value ? '#true' : '#false'
    case isNil(t)     : return '()'
    case isSym(t)     : return t.ident
    case isPid(t)     : return `PID[${t.ident}]`
    case isCons(t)    : return `(${uncons(t).map(pprint).join(' ')})`
    case isLambda(t)  : return `(<lambda> ${pprint(t.params)} ${pprint(t.body)})`
    case isBuiltin(t) : return `#<${t.name}>`
    case isEnv(t)     : {
        if (t.type == 'MENV') return `{MENV[${t.bindings.size}] ${t.parent ? pprint(t.parent) : '~'}}`;
        let names = [];
        for (let n = t.head; n != undefined; n = n.next) names.push(n.name);
        return `{RENV(${names.join(' ')}) ${pprint(t.parent)}}`;
    }
    case isError(t)   : return `E!${String(t.error)}`
    default : throw new Error(`WTF IS ${String(t)}`);
    }
}


