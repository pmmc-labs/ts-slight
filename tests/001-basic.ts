
const DEBUG : boolean = process.env["DEBUG"] && process.env["DEBUG"] == '1' ? true : false;

// -----------------------------------------------------------------------------

type LITERAL  = Bool | Str | Num
type LIST     = Cons | Nil
type CALLABLE = Lambda | Builtin
type TERM     = LIST | LITERAL | CALLABLE | Sym | Env | ERROR

type Nil      = { type : 'NIL' }
type Cons     = { type : 'CONS', first  : TERM, rest: LIST }

type Sym      = { type : 'SYM',   ident : string }
type Str      = { type : 'STR',   value : string }
type Num      = { type : 'NUM',   value : number }
type Bool     = { type : 'BOOL',  value : boolean }
type ERROR    = { type : 'ERROR', error : any }

type Env      = { type : 'ENV', bindings : Map<string,TERM>, parent : Env | undefined }
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
function isEnv     (t : TERM) : t is Env  { return t.type == 'ENV' }

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

function newEnv (parent : Env | undefined = undefined) : Env {
    return { type : 'ENV', bindings : new Map<string,TERM>(), parent }
}

function bind (name : Sym, value : TERM, env : Env) : Env {
    env.bindings.set( name.ident, value );
    return env;
}

function lookup (name : Sym, env : Env) : TERM {
    while (env != undefined) {
        if (env.bindings.has(name.ident)) return env.bindings.get(name.ident)!;
        if (env.parent == undefined) break;
        env = env.parent;
    }
    return raise(`Unable to find ${name.ident} in Env`);
}

function bindParams (params : LIST, args : LIST, env : Env) : Env | ERROR {
    let local = newEnv(env);
    while (!isNil(params)) {
        if (isNil(args))          return raise(`ARITY MISMATCH! missing ${pprint(params)} parameter`);
        if (!isSym(params.first)) return raise(`Expected parameter to be a symbol, wtf!`);
        local = bind( params.first, args.first, local );
        params = params.rest;
        args   = args.rest;
    }
    if (!isNil(args)) return raise(`ARITY MISMATCH! got extra args ${pprint(args)}`);
    //console.log(local);
    return local;
}

// ...

function uncons (list : LIST) : TERM[] {
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
    case isEnv(t)     : return `{ ${t.bindings.toString()} ${t.parent ? pprint(t.parent) : '~'} }`
    case isError(t)   : return `E!${String(t.error)}`
    default : throw new Error(`WTF IS ${String(t)}`);
    }
}

// -----------------------------------------------------------------------------

function parse (source : string) : TERM[] {
    const lexer  = /"[^"]*"|\'|\(|\)|[^\s()']+/g;

    let tokens = source.match(lexer)!;

    if (tokens == undefined) throw new Error(`Expected tokens from (${source})`)

    //console.log(source);
    //console.log(tokens);

    let done  : any[] = [];
    let stack : any[] = [];
    while (tokens.length > 0) {
        //console.log('TOKENS: ', tokens);
        //console.log('STACK:  ', stack);
        let token = tokens.shift()!;
        switch (token) {
        case '(':
            stack.push([]);
            break;
        case ')':
            let lst = list(...stack.pop()!);
            if (stack.at(-1) == undefined) {
                done.push(lst);
            } else {
                stack.at(-1)!.push(lst);
            }
            break;
        case "'":
            stack.push([ sym('quote') ]);
            if (tokens.at(0) != '(') {
                tokens = [ tokens.shift()!, ')', ...tokens ];
            }
            break;
        case '#true':
            stack.at(-1)!.push(bool(true));
            break;
        case '#false':
            stack.at(-1)!.push(bool(false));
            break;
        default:
            if (token.startsWith('"')) {
                stack.at(-1)!.push(str(token));
            } else if (!isNaN(parseInt(token))) {
                stack.at(-1)!.push(num(parseInt(token)));
            } else if (!isNaN(parseFloat(token))) {
                stack.at(-1)!.push(num(parseFloat(token)));
            } else {
                stack.at(-1)!.push(sym(token));
            }
        }
    }

    while (stack.length > 0) {
        let lst = list(...stack.pop()!);
        if (stack.at(-1) == undefined) {
            done.push(lst);
        } else {
            stack.at(-1)!.push(lst);
        }
    }

    return done;
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

function liftListOp (name : string, f : (n : LIST) => TERM) : Builtin {
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

function initalizeEnv () : Env {
    let env : Env = newEnv();
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

    return env;
}

// -----------------------------------------------------------------------------

type Kontinuation = { env : Env, kont : Kontinue }

type EvalExpr  = { type : 'EVAL_EXPR', expr : TERM                     } & Kontinuation
type EvalHead  = { type : 'EVAL_HEAD', args : LIST                     } & Kontinuation
type EvalArgs  = { type : 'EVAL_ARGS', args : LIST, done : TERM[]      } & Kontinuation
type Apply     = { type : 'APPLY',     call : CALLABLE                 } & Kontinuation
type Return    = { type : 'RETURN',    value : TERM                    } & Kontinuation
type Define    = { type : 'DEFINE',    name : Sym                      } & Kontinuation
type Cond      = { type : 'COND',      if_true : TERM, if_false : TERM } & Kontinuation

type ScopeExit = { type : 'SCOPE_EXIT' } & Kontinuation
type Drop      = { type : 'DROP'       } & Kontinuation
type Yield     = { type : 'YIELD'      } & Kontinuation

type Halt      = { type : 'HALT', results : TERM[] }
type Err       = { type : 'ERR',  error : ERROR }

type Kontinue =
    | EvalExpr
    | EvalHead
    | EvalArgs
    | Apply
    | Drop
    | Return
    | Yield
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
    case 'DEFINE'     : kontStr += ` ${pprint(kont.name)}`; break;;
    case 'COND'       : break;
    case 'SCOPE_EXIT' : break;
    case 'YIELD'      : break;
    case 'HALT'       : break;
    case 'ERR'        : kontStr += `${pprint(kont.error)}`; break;
    }
    return `${stepsStr} | ${kontStr.padEnd(50, ' ')} := ${stack.map(pprint).join(', ')}`
}

function RaiseError   (error : string) : Err { return { type : 'ERR', error : raise(error) } }
function ReThrowError (error : ERROR)  : Err { return { type : 'ERR', error } }

function EvalExpr (expr : TERM, env : Env, kont : Kontinue) : EvalExpr {
    return { type : 'EVAL_EXPR', expr, env, kont }
}

function EvalHead (args : LIST, env : Env, kont : Kontinue) : EvalHead {
    return { type : 'EVAL_HEAD', args, env, kont }
}

function EvalArgs (args : LIST, done : TERM[], env : Env, kont : Kontinue) : EvalArgs {
    return { type : 'EVAL_ARGS', args, done, env, kont }
}

function Apply (call : CALLABLE, env : Env, kont : Kontinue) : Apply {
    return { type : 'APPLY', call, env, kont }
}

function Return (value : TERM, env : Env, kont : Kontinue) : Return {
    return { type  : 'RETURN', value, env, kont }
}

function Define (name : Sym, env : Env, kont : Kontinue) : Define {
    return { type  : 'DEFINE', name, env, kont }
}

function Cond (if_true : TERM, if_false : TERM, env : Env, kont : Kontinue) : Cond {
    return { type : 'COND', if_true, if_false, env, kont }
}

function Drop (env : Env, kont : Kontinue) : Drop {
    return { type : 'DROP', env, kont }
}

function Yield (env : Env, kont : Kontinue) : Yield {
    return { type : 'YIELD', env, kont }
}

function Halt () : Halt {
    return { type : 'HALT', results : [] }
}

function ScopeExit (env : Env, kont : Kontinue) : ScopeExit {
    if (kont.type == 'SCOPE_EXIT') return ScopeExit(env, kont.kont);
    return { type : 'SCOPE_EXIT', env, kont }
}

// -----------------------------------------------------------------------------

class Strand {
    public steps : number = 0;
    public quota : number = 100_000;

    run (exprs : TERM[], env : Env) : Kontinue {
        let to_run = [];
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
                } else {
                    to_run.push(expr);
                }
            } else {
                to_run.push(expr);
            }
        }

        return this.step(this.prepare(to_run, newEnv(env)));
    }

    prepare (exprs : TERM[], env : Env) : Kontinue {
        if (exprs.length == 0) return Halt();

        let kont : Kontinue = EvalExpr( exprs.pop()!, env, Halt() );
        while (exprs.length > 0) {
            kont = EvalExpr( exprs.pop()!, env, Drop( env, kont ) );
        }

        return kont;
    }

    resume (kont : Kontinue) : Kontinue {
        if (kont.type != 'YIELD') throw new Error(`You can only resume from a Yield, not ${kont.type}`);
        return this.step(kont.kont);
    }

    step (kont : Kontinue) : Kontinue {
        while (this.steps < this.quota) {
            this.steps++;
            kont = this.kontinue(kont);
            switch (kont.type) {
            case 'HALT'   :
            case 'YIELD'  : return kont;
            case 'ERR'    : throw new Error(pprint(kont.error));
            case 'RETURN' :
                this.steps++;
                kont = this.kontinue( kont.kont, kont.value );
                break;
            }
        }
        return kont;
    }

    kontinue (kont : Kontinue, ...stack : TERM[]) : Kontinue {
        if (DEBUG) console.log(pprintKont(this.steps, kont, stack));
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
                        if (!isList(params)) return RaiseError(`Params should be a list, not ${pprint(params)} in lambda`);
                        return Return( lambda( params, body, kont.env ), kont.env, kont.kont )
                    case 'let':
                        let name  = car(tail);
                        let value = cadr(tail);
                        if (!isSym(name)) return RaiseError(`Name should be a sym, not ${pprint(name)} in let`);
                        return EvalExpr( value, kont.env, Define( name, kont.env, kont.kont ));
                    case 'quote':
                        return Return( car(tail), kont.env, kont.kont );
                    case 'yield':
                        return Yield( kont.env, EvalExpr( car(tail), kont.env, kont.kont ));
                    }
                }
                return EvalExpr(head, kont.env, EvalHead( tail, kont.env, kont.kont ) )
            case isSym(kont.expr):
                let found = lookup(kont.expr, kont.env);
                if (isError(found)) return ReThrowError(found);
                return Return( found, kont.env, kont.kont );
            default :
                return Return( kont.expr, kont.env, kont.kont );
            }
        case 'EVAL_HEAD':
            let call = stack.pop();
            if (call == undefined) return RaiseError(`Expected call returned to EVAL_HEAD, got undefined`);
            if (!isCallable(call)) return RaiseError(`Expected CALLABLE call returned to EVAL_HEAD, got something else!`);
            return EvalArgs(kont.args, [], kont.env, Apply( call, kont.env, kont.kont ))
        case 'EVAL_ARGS':
            let done = kont.done;
            if (stack.length > 0) {
                let next_arg = stack.pop();
                if (next_arg == undefined) return RaiseError(`Expected next_arg returned to EVAL_ARGS, got undefined`);
                done.push(next_arg);
            }
            if (isNil(kont.args)) return Return( list( ...done ), kont.env, kont.kont );
            return EvalExpr( car(kont.args), kont.env, EvalArgs( cdr(kont.args), done, kont.env, kont.kont ))
        case 'APPLY':
            let args = stack.pop();
            if (args == undefined) return RaiseError(`Expected args returned to APPLY, got undefined`);
            if (!isList(args))     return RaiseError(`Expected args LIST returned to APPLY, got something else`);

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
        case 'YIELD':
            return kont;
        case 'RETURN':
            return kont;
        case 'HALT':
            let final_result = stack.pop();
            if (final_result !== undefined) kont.results.push(final_result);
            return kont;
        case 'DEFINE':
            let value = stack.pop();
            if (value == undefined) return RaiseError(`Expected value returned to DEFINE, got undefined`);
            let local = bind( kont.name, value, kont.env );
            //// NOTE:
            //// This is a bit gross, but works for now
            //// push the new binding forward ...
            //let k = kont.kont;
            //// but stop when
            ////  - we reach something without a kont (HALT, ERR)
            ////  - we reach a scope exit barrier
            //while (k.type != 'HALT' && k.type != 'ERR' && k.type != 'SCOPE_EXIT') {
            //    k.env = local;
            //    k     = k.kont;
            //}
            return kont.kont;
        case 'COND':
            let test = stack.pop();
            if (test == undefined) return RaiseError(`Expected Bool returned to COND, got undefined`);

            if (isBool(test) && isTrue(test)) {
                return EvalExpr( kont.if_true, kont.env, kont.kont )
            } else {
                return EvalExpr( kont.if_false, kont.env, kont.kont )
            }
        case 'SCOPE_EXIT':
            let returned = stack.pop();
            if (returned == undefined) return RaiseError(`Expected result returned to SCOPE_EXIT, got undefined`);
            return Return( returned, kont.env, kont.kont )
        default:
            return RaiseError(`Unknown Kontinue`);
        }
    }
}

// -----------------------------------------------------------------------------

let env = initalizeEnv();

let test_source = `

    (defun adder (n m) (+ n m))

    (defun double (n) (adder n n))

    (defun fact (n)
        (if (== n 0) 1
            (* n (fact (- n 1)))))

    (defun fib (n)
        (if (< n 2) n
            (+ (fib (- n 1)) (fib (- n 2)))))

    (defun tail-call-demo (n)
        (if (== n 0) 0
           (tail-call-demo (- n 1))))

    (defun length (lst)
        (if (nil? lst) 0
            (+ 1 (length (tail lst)))))

    (defun length-iter (lst count)
        (if (nil? lst) count
            (length-iter (tail lst) (+ count 1))))

    (defun range (b e)
        (if (== b e)
            (cons e ())
            (cons b (range (+ b 1) e))))

    (defun map (f lst)
        (if (nil? lst) ()
            (cons (f (head lst)) (map f (tail lst)))))

    (defun grep (f lst)
        (if (nil? lst) ()
            (if (f (head lst))
                (cons (head lst) (grep f (tail lst)))
                (grep f (tail lst)))))

    (defun reduce (acc f lst)
        (if (nil? lst) acc
            (reduce (f (head lst) acc) f (tail lst))))

    (defun sum (lst)
        (reduce 0 (lambda (n acc) (+ acc n)) lst))

    (defun product (lst)
        (reduce 1 (lambda (n acc) (* acc n)) lst))

    (defun even? (n) (if (== n 0) #true  (odd?  (- n 1))))
    (defun odd?  (n) (if (== n 0) #false (even? (- n 1))))

    (defun make-adder (n) (lambda (x) (+ x n)))

    (let thirty 30)

    (let get-thirty (lambda () thirty))

    (let thur-tee (+ 10 20))

    (list
        (even? 10)
        (odd? 10)
        (fact 6)
        (fib 6)
        (fact (fib 6))
        (length (list 1 2 3 4 5))
        (length-iter (list 1 2 3 4 5) 0)
        (tail-call-demo 10)
        (length
            (list
            30
            thirty
            (+ 10 20)
            thur-tee
            (+ (* 2 5) 20)
            (get-thirty)
            (+ 10 (* 4 5))
            (+ (* 2 5) (* 4 5))
            (+ (* 2 (- 9 4)) (* 4 5))
            (+ (* 2 (- 9 4)) (* 4 (+ 4 1)))
            (adder 10 20)
            (adder (double 5) 20)
            (adder 10 (* (double 2) 5))
            (adder (fib 6) 22)
            (adder (fib 8) (+ 1 (double 4)))
            (- (fact 6) (+ (* (fact 3) 100) 90))
            ((lambda (n m) (+ n m)) 10 20)
            ((lambda (f n m) (f n m)) adder 10 20)
            (+ (length (list 0 1 2 3 4 5 6 7 8 9)) 20)
            (length (range 1 30))
            (+ (length (range 1 10)) (length (range 1 (* 4 5))))
            (+ (product (list 2 1 5)) (sum (list 2 4 6 8)))
            (sum (list 4 (fib 8) (- (fact 3) 1)))
            (+ (sum (range 0 (fib 6))) (- 2 8))
            (sum (grep
                    (lambda (x) (>= x 10))
                    (list 0 2 10 4 7 20 3 1)))
            (sum (map
                    (lambda (x) (if (<= x 20) x 0))
                    (list 100 25 10 411 75 20 35 1000)))
            (if (even? (* 2 5)) (+ (* 2 5) 20) -1)
            (if (even? (* 3 5)) -1 (if (odd? (* 3 5)) 30 -1))
            ((make-adder 10) 20)
            ((make-adder 20) 10)
            )
        )
        "<- all done!"
    )

`;

let source = `

    (defun fact (n)
        (if (== n 0) 1
            (* n (yield (fact (- n 1))))))

    (let x (yield (fact 6)))

`;

let exprs = parse(source || test_source);

if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

let strand = new Strand();

let kont : Kontinue = strand.run(exprs, env);
while (kont.type == 'YIELD') {
    console.log('... resuming from yield')
    kont = strand.resume(kont);
}

if (kont.type == 'HALT') {
    console.log(kont.results.map(pprint));
} else {
    console.log(`Expected HALT, but got ${kont.type}`);
}


/*


*/
