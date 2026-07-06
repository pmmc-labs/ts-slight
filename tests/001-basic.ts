// -----------------------------------------------------------------------------

type TERM     = LIST | Sym | LITERAL | Bind | Env | CALLABLE | ERRO
type LITERAL  = Bool | Str | Num
type LIST     = Cons | Nil
type ENV      = Env  | Nil
type LISTLIKE = Cons | Env | Nil
type CALLABLE = Lambda | Builtin

type Nil      = { type : 'NIL' }
type Cons     = { type : 'CONS', first  : TERM, rest: LIST }

type Sym      = { type : 'SYM',   ident : string }
type Str      = { type : 'STR',   value : string }
type Num      = { type : 'NUM',   value : number }
type Bool     = { type : 'BOOL',  value : boolean }
type ERROR    = { type : 'ERROR', error : any }

type Bind     = { type : 'BIND', name : Sym, value : TERM }
type Env      = { type : 'ENV', first : Bind, rest: ENV }

type Lambda   = { type : 'LAMBDA', params : LIST, body : TERM, env : Env }
type Builtin  = { type : 'BIF',    params : LIST, body : (args : LIST) => TERM, name : string }

// -----------------------------------------------------------------------------

function isNil  (t : TERM) : t is Nil  { return t.type === 'NIL'  }
function isCons (t : TERM) : t is Cons { return t.type === 'CONS' }

function isSym  (t : TERM) : t is Sym  { return t.type === 'SYM'  }
function isStr  (t : TERM) : t is Str  { return t.type === 'STR'  }
function isNum  (t : TERM) : t is Num  { return t.type === 'NUM'  }
function isBool (t : TERM) : t is Bool { return t.type === 'BOOL' }

function isTrue  (t : Bool) : boolean { return t.value === true }
function isFalse (t : Bool) : boolean { return t.value === false }

function isError (t : TERM) : t is ERROR  { return t.type == 'ERROR' }

function isBuiltin (t : TERM) : t is Builtin { return t.type == 'BIF' }
function isLambda  (t : TERM) : t is Lambda  { return t.type == 'LAMBDA' }

function isBind (t : TERM) : t is Bind { return t.type == 'BIND' }
function isEnv  (t : TERM) : t is Env  { return t.type == 'ENV' }

function isLiteral  (t : TERM) : t is LITERAL  { return isStr(t) || isNum(t) || isBool(t) }
function isList     (t : TERM) : t is LIST     { return isNil(t) || isCons(t) }
function isCallable (t : TERM) : t is CALLABLE { return isBuiltin(t) || isLambda(t) }

// -----------------------------------------------------------------------------

const nil : Nil = { type : 'NIL' }

function cons (first : TERM, rest : LIST) : Cons { return { type : 'CONS', first, rest } }

function car (list : Cons) : TERM { return list.first }
function cdr (list : Cons) : LIST { return list.rest  }

function cadr (list : Cons) : TERM {
    if (isNil(list.rest)) return raise(`Cannot call cadr on a list with a nil tail`);
    return list.rest.first;
}

function cddr (list : Cons) : LIST | ERROR {
    if (isNil(list.rest)) return raise(`Cannot call cddr on a list with a nil tail`);
    return list.rest.rest;
}

function num  (value : number)  : Num  { return { type : 'NUM',  value } }
function str  (value : string)  : Str  { return { type : 'STR',  value } }
function bool (value : boolean) : Bool { return { type : 'BOOL', value } }

function sym (ident : string) : Sym { return { type : 'SYM', ident } }

function lambda (params : LIST, body : TERM, env : Env) : Lambda {
    return { type : 'LAMBDA', params, body, env }
}

function raise (error : any) : ERROR { return { type : 'ERROR', error } }

// ...

function list (...args : TERM[]) : LIST {
    let xs : LIST = nil;
    for (const arg of args.reverse()) {
        xs = cons(arg, xs)
    }
    return xs;
}

function assoc (first : Bind, rest : ENV) : Env {
    return { type : 'ENV', first, rest }
}

function bind (name : Sym, value : TERM, env : ENV) : Env {
    return assoc( { type : 'BIND', name, value }, env )
}

function lookup (name : Sym, env : ENV) : TERM {
    while (!isNil(env)) {
        if (eq(env.first.name, name)) return env.first.value;
        env = env.rest;
    }
    return nil
}

// ...

function uncons (list : LISTLIKE) : TERM[] {
    let terms = [];
    while (list.type != 'NIL') {
        terms.push(list.first);
        list = list.rest;
    }
    return terms;
}

function eq (lhs : TERM, rhs : TERM) : boolean {
    switch (true) {
    case isError(lhs)   && isError(rhs)   : return lhs.error === rhs.error;
    case isLiteral(lhs) && isLiteral(rhs) : return lhs.value == rhs.value;
    case isSym(lhs)     && isSym(rhs)     : return lhs.ident == rhs.ident;
    case isCons(lhs)    && isCons(rhs)    : return eq(lhs.first, rhs.first)   && eq(lhs.rest, rhs.rest);
    case isLambda(lhs)  && isLambda(rhs)  : return eq(lhs.params, rhs.params) && eq(lhs.body, rhs.body) && eq(lhs.env, rhs.env);
    case isBuiltin(lhs) && isBuiltin(rhs) : return eq(lhs.params, rhs.params) && lhs.body === rhs.body && lhs.name == rhs.name;
    case isBind(lhs)    && isBind(rhs)    : return eq(lhs.name, rhs.name)     && eq(lhs.value, rhs.value);
    case isEnv(lhs)     && isEnv(rhs)     : return eq(lhs.first, rhs.first)   && eq(lhs.rest, rhs.rest);
    default : return false;
    }
}

function pprint (t : TERM) : string {
    switch (true) {
    case isStr(t)     : return `"${t.value}"`
    case isNum(t)     : return t.value.toString()
    case isBool(t)    : return t.value ? '#true' : '#false'
    case isNil(t)     : return '()'
    case isSym(t)     : return t.ident
    case isCons(t)    : return `(${uncons(t).map(pprint).join(' ')})`
    case isLambda(t)  : return `(<lambda> ${pprint(t.params)} ${pprint(t.body)})`
    case isBuiltin(t) : return `#<${t.name}>`
    case isBind(t)    : return `(${pprint(t.name)} . ${pprint(t.value)})`
    case isEnv(t)     : return `{ ${uncons(t).map(pprint).join(' ')} }`
    case isError(t)   : return `E!${String(t.error)}`
    default : throw new Error(`WTF IS ${String(t)}`);
    }
}

// -----------------------------------------------------------------------------

function liftUnOp (name : string, f : (n : TERM) => TERM) : Builtin {
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

function liftBinOp (name : string, f : (n : TERM, m : TERM) => TERM) : Builtin {
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


function liftNumBinOp (name : string, f : (n : number, m : number) => number) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Num | ERROR => {
        if (isNum(n) && isNum(m)) {
            return num(f( n.value, m.value ));
        } else {
            return raise(`Must be numbers, duh!`);
        }
    })
}


// -----------------------------------------------------------------------------

function initalizeEnv () : ENV {
    let env : ENV = nil;
    env = bind( sym('+'), liftNumBinOp('+', (n, m) => n + m), env );
    env = bind( sym('-'), liftNumBinOp('-', (n, m) => n - m), env );
    env = bind( sym('*'), liftNumBinOp('*', (n, m) => n * m), env );
    env = bind( sym('/'), liftNumBinOp('/', (n, m) => n / m), env );
    env = bind( sym('%'), liftNumBinOp('%', (n, m) => n % m), env );

    env = bind( sym('eq?'), liftBinOp('eq?', (n, m) => bool(eq(n, m))),  env );
    env = bind( sym('ne?'), liftBinOp('ne?', (n, m) => bool(!eq(n, m))), env );

    env = bind( sym('pprint'), liftBinOp('pprint', (t) => str(pprint(t))), env );

    return env;
}


import { parse } from "sexpr-plus"




function evaluate (expr : TERM, env : ENV) : TERM {
    switch (true) {
    case isError(expr) : throw new Error(pprint(expr));
    case isSym(expr)   :
        let found = lookup(expr, env);
        if (isNil(found)) {
            return evaluate(raise(`Could not find ${pprint(expr)} in Env`), env)
        } else {
            return found;
        }
    case isCons(expr)  :
        return application( evaluate( car(expr), env ), evaluateArgs( cdr(expr), env ), env );
    default :
        return expr;
    }
}

function evaluateArgs (args : LIST, env : ENV) : LIST {
    if (isNil(args)) return args;
    return cons( evaluate( car(args), env ), evaluateArgs( cdr(args), env ) );
}

function bindParams (params : LIST, args : LIST, env : ENV) : ENV | ERROR {
    while (!isNil(params)) {
        if (isNil(args))          return raise(`ARITY MISMATCH! missing ${pprint(params)} parameter`);
        if (!isSym(params.first)) return raise(`Expected parameter to be a symbol, wtf!`);
        env = bind( params.first, args.first, env );
        params = params.rest;
        args   = args.rest;
    }
    if (!isNil(args)) return raise(`ARITY MISMATCH! got extra args ${pprint(args)}`);
    return env;
}

function application (call : TERM, args : LIST, env : ENV) : TERM {
    switch (true) {
    case isBuiltin(call) : return call.body(args);
    case isLambda(call)  :
        let local = bindParams(call.params, args, call.env);
        if (isError(local)) return evaluate( local, env );
        return evaluate(call.body, local);
    default :
        return raise(`Cannot call a ${pprint(call)} only CALLABLE things`);
    }
}


console.log(
    pprint(
        evaluate(
            list(
                sym('+'),
                num(10),
                list(
                    sym('*'),
                    num(5),
                    num(4),
                ),
            ),
            initalizeEnv()
        )
    )
);















