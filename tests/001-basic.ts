// -----------------------------------------------------------------------------

type TERM     = LIST | Sym | LITERAL | Bind | Env | CALLABLE | ERROR
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

type Lambda   = { type : 'LAMBDA', params : LIST, body : TERM, env : ENV }
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

function lambda (params : LIST, body : TERM, env : ENV) : Lambda {
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
// adapted from - https://gist.github.com/tluyben/0f9877bbe657d5f49122357f4a99d5c8

function parse (source : string) : TERM[] {
    const lexer = /"[^"]*"|\(|\)|[^\s()]+/g;
    const ts = source.match(lexer)!;
    let i = 0
    const rec = () => {
        let prg : any = undefined;
        while (i < ts.length) {
            let t = ts[i]!;
            if (t === '(') {
                if (prg === undefined) {
                    prg = [];
                } else {
                    prg.push(rec())
                }
            } else if (t === ')') {
                break;
            } else {
                switch (t) {
                case '#true':
                    prg.push(bool(true));
                    break;
                case '#false':
                    prg.push(bool(false));
                    break;
                default:
                    if (!isNaN(parseInt(t))) {
                        prg.push(num(parseInt(t)))
                    }
                    else if (!isNaN(parseFloat(t))) {
                        prg.push(num(parseFloat(t)))
                    }
                    else if (t.startsWith('"')) {
                        prg.push(str(t))
                    }
                    else {
                        prg.push(sym(t))
                    }
                }
            }
            i++
        }
        //console.log(prg);
        return list( ...prg )
    }

    let terms : TERM[] = [];
    while (i < ts.length) {
        //console.log('...', ts.slice(i));
        terms.push(rec());
        i++;
    }
    return terms;
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

function liftNumBoolOp (name : string, f : (n : number, m : number) => boolean) : Builtin {
    return liftBinOp(name, (n : TERM, m : TERM) : Bool | ERROR => {
        if (isNum(n) && isNum(m)) {
            return bool(f( n.value, m.value ));
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

    env = bind( sym('=='), liftNumBoolOp('==', (n, m) => n == m), env );
    env = bind( sym('!='), liftNumBoolOp('!=', (n, m) => n == m), env );
    env = bind( sym('<='), liftNumBoolOp('<=', (n, m) => n <= m), env );
    env = bind( sym('<'),  liftNumBoolOp('<',  (n, m) => n <  m), env );
    env = bind( sym('>='), liftNumBoolOp('>=', (n, m) => n >= m), env );
    env = bind( sym('>'),  liftNumBoolOp('>',  (n, m) => n >  m), env );

    env = bind( sym('eq?'), liftBinOp('eq?', (n, m) => bool(eq(n, m))),  env );
    env = bind( sym('ne?'), liftBinOp('ne?', (n, m) => bool(!eq(n, m))), env );

    env = bind( sym('pprint'), liftBinOp('pprint', (t) => str(pprint(t))), env );

    return env;
}

// -----------------------------------------------------------------------------

type Kontinuation = { env : ENV, kont : Kontinue }

type EvalExpr  = { type : 'EVAL_EXPR', expr : TERM                     } & Kontinuation
type EvalHead  = { type : 'EVAL_HEAD', args : LIST                     } & Kontinuation
type EvalArgs  = { type : 'EVAL_ARGS', args : LIST, done : TERM[]      } & Kontinuation
type Apply     = { type : 'APPLY',     call : CALLABLE                 } & Kontinuation
type Return    = { type : 'RETURN',    value : TERM                    } & Kontinuation
type Define    = { type : 'DEFINE',    name : Sym, value : TERM        } & Kontinuation
type Cond      = { type : 'COND',      if_true : TERM, if_false : TERM } & Kontinuation

type ScopeExit = { type : 'SCOPE_EXIT' } & Kontinuation
type Drop      = { type : 'DROP'       } & Kontinuation

type Halt      = { type : 'HALT', results : TERM[] }
type Err       = { type : 'ERR',  error : ERROR }

type Kontinue =
    | EvalExpr
    | EvalHead
    | EvalArgs
    | Apply
    | Drop
    | Return
    | Halt
    | Err
    | Define
    | Cond
    | ScopeExit

function pprintKont (steps : number, kont : Kontinue, stack : TERM[]) : string {
    let stepsStr = steps.toString().padStart(5, '0');
    let kontStr  = kont.type.padEnd(11, " ");
    switch (kont.type) {
    case 'EVAL_EXPR'  : kontStr += ` ${pprint(kont.expr)}`; break;
    case 'EVAL_HEAD'  : kontStr += ` ${pprint(kont.args)}`; break;
    case 'EVAL_ARGS'  : kontStr += ` ${pprint(kont.args)} -> ${kont.done.map(pprint).join(' ')}`; break;
    case 'APPLY'      : kontStr += ` ${pprint(kont.call)}`; break;
    case 'DROP'       : break;
    case 'RETURN'     : kontStr += ` ${pprint(kont.value)}`; break;
    case 'DEFINE'     : break;
    case 'COND'       : break;
    case 'SCOPE_EXIT' : break;
    case 'HALT'       : break;
    case 'ERR'        : kontStr += `${pprint(kont.error)}`; break;
    }
    return `${stepsStr} | ${kontStr.padEnd(50, ' ')} := ${stack.map(pprint).join(', ')}`
}

function RaiseError   (error : string) : Err { return { type : 'ERR', error : raise(error) } }
function ReThrowError (error : ERROR)  : Err { return { type : 'ERR', error } }

function EvalExpr (expr : TERM, env : ENV, kont : Kontinue) : EvalExpr {
    return { type : 'EVAL_EXPR', expr, env, kont }
}

function EvalHead (args : LIST, env : ENV, kont : Kontinue) : EvalHead {
    return { type : 'EVAL_HEAD', args, env, kont }
}

function EvalArgs (args : LIST, done : TERM[], env : ENV, kont : Kontinue) : EvalArgs {
    return { type : 'EVAL_ARGS', args, done, env, kont }
}

function Apply (call : CALLABLE, env : ENV, kont : Kontinue) : Apply {
    return { type : 'APPLY', call, env, kont }
}

function Return (value : TERM, env : ENV, kont : Kontinue) : Return {
    return { type  : 'RETURN', value, env, kont }
}

function Cond (if_true : TERM, if_false : TERM, env : ENV, kont : Kontinue) : Cond {
    return { type : 'COND', if_true, if_false, env, kont }
}

function Drop (env : ENV, kont : Kontinue) : Drop {
    return { type : 'DROP', env, kont }
}

function Halt () : Halt {
    return { type : 'HALT', results : [] }
}

function ScopeExit (env : ENV, kont : Kontinue) : ScopeExit {
    return { type : 'SCOPE_EXIT', env, kont }
}

// -----------------------------------------------------------------------------

let steps = 0;

function run (exprs : TERM[], env : ENV) : TERM {
    let to_run = [];
    let to_fix = [];
    for (const expr of exprs) {
        if (isCons(expr)) {
            let head = car(expr);
            if (isSym(head) && head.ident === 'defun') {
                let [ name, params, body ] = uncons(cdr(expr));
                if (name   === undefined) throw new Error(`defun <name> ... duh!`);
                if (params === undefined) throw new Error(`defun <name> <params> ... duh!`);
                if (body   === undefined) throw new Error(`defun <name> <params> <body>... duh!`);
                if (!isSym(name))    throw new Error(`defun <name> ... duh!`);
                if (!isList(params)) throw new Error(`defun <name> <params>... duh!`);
                env = bind( name, lambda( params, body, env ), env );
                to_fix.push(env.first);
            } else {
                to_run.push(expr);
            }
        } else {
            to_run.push(expr);
        }
    }

    to_fix.forEach((b) => { (b.value as Lambda).env = env })

    return step(to_run, env);
}

function step (exprs : TERM[], env : ENV) : TERM {
    if (exprs.length == 0) return nil;

    let kont : Kontinue = EvalExpr( exprs.pop()!, env, Halt() );
    while (exprs.length > 0) {
        kont = EvalExpr( exprs.pop()!, env, Drop( env, kont ) );
    }

    STEP_LOOP:
    while (steps < 100_000) {
        kont = kontinue(kont);
        switch (kont.type) {
        case 'HALT'   : break STEP_LOOP;
        case 'ERR'    : throw new Error(pprint(kont.error));
        case 'RETURN' :
            kont = kontinue( kont.kont, kont.value );
        }
    }

    if (kont.type != 'HALT') {
        throw new Error(`Expected HALT, but somehow did not get it, hmmmm`);
    }

    return kont.results.pop()!;
}

function kontinue (kont : Kontinue, ...stack : TERM[]) : Kontinue {
    steps++;
    console.log(pprintKont(steps, kont, stack))
    switch (kont.type) {
    case 'EVAL_EXPR':
        switch (true) {
        case isCons(kont.expr):
            let head = car(kont.expr);
            let tail = cdr(kont.expr);
            if (isSym(head) && isCons(tail)) {
                switch (head.ident) {
                case 'if' :
                    let [ cond, if_true, if_false ] = uncons(tail);
                    if (cond     == undefined) return RaiseError(`Expected conf for COND, got undefined`);
                    if (if_true  == undefined) return RaiseError(`Expected if-true for COND, got undefined`);
                    if (if_false == undefined) return RaiseError(`Expected if-false for COND, got undefined`);
                    return EvalExpr( cond, kont.env, Cond( if_true, if_false, kont.env, kont.kont ) )
                case 'do' :
                    let exprs = uncons(tail);
                    let next = EvalExpr( exprs.pop()!, kont.env, kont.kont );
                    while (exprs.length > 0) {
                        next = EvalExpr( exprs.pop()!, kont.env, Drop( kont.env, next ) )
                    }
                    return next;
                case 'lambda' :
                    let params = car(tail);
                    let body   = cadr(tail);
                    if (!isList(params)) {
                        return RaiseError(`Params should be a list, not ${pprint(params)} in lambda`)
                    }
                    return Return( lambda( params, body, kont.env ), kont.env, kont.kont )
                }
            }
            return EvalExpr(head, kont.env, EvalHead( tail, kont.env, kont.kont ) )
        case isSym(kont.expr):
            let found = lookup(kont.expr, kont.env);
            if (isNil(found)) {
                return RaiseError(`Could not find ${pprint(kont.expr)} in Env`)
            } else {
                return Return( found, kont.env, kont.kont );
            }
        default :
            return Return( kont.expr, kont.env, kont.kont );
        }
    case 'EVAL_HEAD':
        let call = stack.pop();
        if (call == undefined) {
            return RaiseError(`Expected call returned to EVAL_HEAD, got undefined`)
        }

        if (!isCallable(call)) {
            return RaiseError(`Expected CALLABLE call returned to EVAL_HEAD, got something else!`)
        }

        return EvalArgs(kont.args, [], kont.env, Apply( call, kont.env, kont.kont ))
    case 'EVAL_ARGS':
        let done = kont.done;
        if (stack.length > 0) {
            let next_arg = stack.pop();
            if (next_arg == undefined) {
                return RaiseError(`Expected next_arg returned to EVAL_ARGS, got undefined`)
            }
            done.push(next_arg);
        }

        if (isNil(kont.args)) {
            return Return( list( ...done ), kont.env, kont.kont )
        }
        return EvalExpr( car(kont.args), kont.env,
                    EvalArgs( cdr(kont.args), done, kont.env, kont.kont ))
    case 'APPLY':
        let args = stack.pop();
        if (args == undefined) {
            return RaiseError(`Expected args returned to APPLY, got undefined`)
        }

        if (!isList(args)) {
            return RaiseError(`Expected args LIST returned to APPLY, got something else`)
        }

        switch (true) {
        case isLambda(kont.call):
            let local = bindParams( kont.call.params, args, kont.call.env );
            if (isError(local)) return ReThrowError(local);

            return EvalExpr( kont.call.body, local, ScopeExit( kont.env, kont.kont ) )
        case isBuiltin(kont.call):
            return Return( kont.call.body(args), kont.env, kont.kont )
        default:
            return RaiseError(`Expected Lambda or Builtin in APPLY`)
        }
    case 'DROP':
        return kont.kont;
    case 'RETURN':
        return kont;
    case 'HALT':
        let final_result = stack.pop();
        if (final_result !== undefined) {
            kont.results.push(final_result)
        }
        return kont;
    case 'DEFINE':
        throw new Error("TODO");
    case 'COND':
        let test = stack.pop();
        if (test == undefined) {
            return RaiseError(`Expected Bool returned to COND, got undefined`)
        }
        if (isBool(test) && isTrue(test)) {
            return EvalExpr( kont.if_true, kont.env, kont.kont )
        } else {
            return EvalExpr( kont.if_false, kont.env, kont.kont )
        }
    case 'SCOPE_EXIT':
        let returned = stack.pop();
        if (returned == undefined) {
            return RaiseError(`Expected result returned to SCOPE_EXIT, got undefined`)
        }
        return Return( returned, kont.env, kont.kont )
    default:
        return RaiseError(`Unknown Kontinue`);
    }
}

// -----------------------------------------------------------------------------

let env = initalizeEnv();

let exprs = parse(`
    (defun fact (n)
        (if (== n 0) 1
            (* n (fact (- n 1)))))

    (defun fib (n)
        (if (< n 2) n
            (+ (fib (- n 1)) (fib (- n 2)))))

    (fact (fib 6))
`);

console.log(exprs.map(pprint));

let result = run(exprs, env);

console.log(pprint(result));















