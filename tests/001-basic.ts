
const DEBUG : boolean = process.env["DEBUG"] && process.env["DEBUG"] == '1' ? true : false;

// -----------------------------------------------------------------------------

type LITERAL  = Bool | Str | Num
type LIST     = Cons | Nil
type CALLABLE = Lambda | Builtin
type TERM     = LIST | LITERAL | CALLABLE | Sym | Pid | Env | ERROR

type Nil      = { type : 'NIL' }
type Cons     = { type : 'CONS', first  : TERM, rest: LIST }

type Sym      = { type : 'SYM',   ident : string }
type Pid      = { type : 'PID',   ident : number }
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
function isPid  (t : TERM) : t is Pid  { return t.type === 'PID'  }
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

function newPid (ident : number) : Pid { return { type : 'PID', ident } }

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
    case isPid(lhs)     && isPid(rhs)     : return lhs.ident == rhs.ident;
    case isCons(lhs)    && isCons(rhs)    : return eq(lhs.first, rhs.first)   && eq(lhs.rest, rhs.rest);
    case isLambda(lhs)  && isLambda(rhs)  : return eq(lhs.params, rhs.params) && eq(lhs.body, rhs.body) && lhs.env === rhs.env;
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
    case isPid(t)     : return `PID[${t.ident}]`
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
    const lexer  = /\;[^\n]*|"[^"]*"|\'|\(|\)|[^\s()']+/g;

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
        if (token.startsWith(';')) continue;
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
        default:
            let tos = stack.at(-1);
            if (tos == undefined) {
                stack = tos = [];
            }
            if (token == '#true') {
                tos.push(bool(true));
            } else if (token == '#false') {
                tos.push(bool(false));
            } else if (token.startsWith('"')) {
                tos.push(str(token));
            } else if (!isNaN(Number(token))) {
                tos.push(num(Number(token)));
            } else {
                tos.push(sym(token));
            }
        }
    }

    while (stack.length > 0) {
        let next  = stack.pop();
        let token = Array.isArray(next) ? list(...next) : next;
        if (stack.at(-1) === undefined) {
            done.push(token);
        } else {
            stack.at(-1)!.push(token);
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

    env = bind( sym('pprint'), liftUnOp( 'pprint', (t) => {
        console.log(pprint(t));
        return nil;
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
type Err       = { type : 'ERR',  error : ERROR } & Kontinuation
type Block     = { type : 'BLOCK', pid    : Pid  | undefined } & Kontinuation
type Yield     = { type : 'YIELD', result : TERM | undefined } & Kontinuation
type Halt      = { type : 'HALT',  result : TERM | undefined, env : Env }

type Kontinue =
    | EvalExpr
    | EvalHead
    | EvalArgs
    | Apply
    | Drop
    | Return
    | Block
    | Yield
    | Halt
    | Err
    | Define
    | Cond
    | ScopeExit

function pprintKont (kont : Kontinue) : string {
    let kontStr  = kont.type.padStart(11, " ");
    switch (kont.type) {
    case 'EVAL_EXPR'  : kontStr += ` =: ${pprint(kont.expr)}`;  break;
    case 'EVAL_HEAD'  : kontStr += ` =: ${pprint(kont.args)}`;  break;
    case 'APPLY'      : kontStr += ` =: ${pprint(kont.call)}`;  break;
    case 'RETURN'     : kontStr += ` =: ${pprint(kont.value)}`; break;
    case 'DEFINE'     : kontStr += ` =: ${pprint(kont.name)}`;  break;
    case 'EVAL_ARGS'  : kontStr += ` =: ${pprint(kont.args)} -> ${kont.done.map(pprint).join(' ')}`; break;
    case 'DROP'       : break;
    case 'COND'       : break;
    case 'SCOPE_EXIT' : break;
    case 'BLOCK'      : kontStr += ` =: ${kont.pid    == undefined ? '' : pprint(kont.pid)}`; break;
    case 'HALT'       : kontStr += ` =: ${kont.result == undefined ? '' : pprint(kont.result)}`; break;
    case 'YIELD'      : kontStr += ` =: ${kont.result == undefined ? '' : pprint(kont.result)}`; break;
    case 'ERR'        : kontStr += `${pprint(kont.error)}`; break;
    }
    return kontStr;
}

function ThrowError (error : ERROR, kont : Kontinue)  : Err {
    return { type : 'ERR', error, env : kont.env, kont }
}

function RaiseError   (error : string, kont : Kontinue) : Err {
    return ThrowError( raise(error), kont )
}

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

function Block (env : Env, kont : Kontinue, pid : Pid | undefined = undefined) : Block {
    return { type : 'BLOCK', pid, env, kont }
}

function Yield (env : Env, kont : Kontinue, result : TERM | undefined = undefined) : Yield {
    return { type : 'YIELD', result, env, kont }
}

function Halt (env : Env, result : TERM | undefined = undefined) : Halt {
    return { type : 'HALT', result, env }
}

function ScopeExit (env : Env, kont : Kontinue) : ScopeExit {
    if (kont.type == 'SCOPE_EXIT') return ScopeExit(env, kont.kont);
    return { type : 'SCOPE_EXIT', env, kont }
}

// -----------------------------------------------------------------------------

type Process = { pid : Pid, kont : Kontinue, steps : number }

class Strand {
    public running : Process[]             = [];
    public halted  : Map<number,Process>   = new Map<number,Process>();
    public blocked : Map<number,Process[]> = new Map<number,Process[]>();

    private PID_SEQ       = 0;
    private DEFAULT_QUOTA = 1000;

    private enqueueProcess (proc : Process) : void {
        this.running.unshift(proc);
    }

    private yieldProcess (proc : Process) : void {
        if (proc.kont.type != 'YIELD') throw new Error(`You can only yield on a YIELD!`);
        if (proc.kont.result === undefined) throw new Error(`Expected result in YIELD!`);
        if (DEBUG) console.log(`#### : Yielding ${pprint(proc.pid)}`);
        proc.kont = Return( proc.kont.result, proc.kont.kont.env, proc.kont.kont );
        this.enqueueProcess(proc);
    }

    private blockProcess (blocker_pid : Pid, blockee : Process) : void {
        if (DEBUG) console.log(`#### : Blocking ${pprint(blockee.pid)} on ${pprint(blocker_pid)}`);
        if (this.blocked.has( blocker_pid.ident )) {
            let blockees = this.blocked.get( blocker_pid.ident )!;
            this.blocked.set( blocker_pid.ident, [ ...blockees, blockee ] );
        } else {
            if (this.halted.has( blocker_pid.ident )) {
                if (DEBUG) console.log(`#### : Blocker ${pprint(blocker_pid)} is Halted, ....`);
                let blocker = this.halted.get( blocker_pid.ident )!;
                let kont    = blocker.kont;
                if (kont.type != 'HALT') throw new Error(`The halted process should have HALT`);
                let result  = kont.result;
                if (result == undefined) throw new Error(`Got nothing back from blocked process, WTF!`);
                let next = blockee.kont;
                if (next.type == 'HALT') {
                    next.result = result;
                    blockee.kont = next;
                } else {
                    blockee.kont = Return( result, next.kont.env, next.kont );
                }
                if (DEBUG) console.log(`<<<< : Resuming ${pprint(blockee.pid)}`);
                this.enqueueProcess(blockee);
            } else {
                this.blocked.set( blocker_pid.ident, [ blockee ] );
            }
        }
    }

    private haltProcess (proc : Process) : void {
        if (proc.kont.type == 'HALT') {
            if (proc.kont.result === undefined) throw new Error(`Expected result in HALT!`);
            if (DEBUG) console.log(`#### : Halting ${pprint(proc.pid)}`);
            if (this.blocked.has( proc.pid.ident )) {
                let result = proc.kont.result;
                let procs  = this.blocked.get( proc.pid.ident )!;
                this.blocked.delete( proc.pid.ident );
                if (DEBUG) console.log(`#### : ${pprint(proc.pid)} is blocking [ ${procs.map((p) => pprint(p.pid)).join(', ')} ]`);
                procs.forEach((p) => {
                    if (p.kont.type != 'HALT' && p.kont.type != 'ERR') {
                        p.kont = Return( result, p.kont.kont.env, p.kont.kont );
                        if (DEBUG) console.log(`<<<< : Unblocking ${pprint(p.pid)}`);
                        this.enqueueProcess(p);
                    } else {
                        if (DEBUG) console.log(`#### : ${pprint(p.pid)} is already halted, cannot join ${pprint(proc.pid)}`);
                    }
                });
            }
        }
        this.halted.set( proc.pid.ident, proc );
    }

    private spawnProcess (exprs : TERM[], env : Env, ppid : Pid | undefined) : Pid {
        let pid = newPid(++this.PID_SEQ);

        // NOTE:
        // Because the binding is mutable in the Env, it
        // is possible that a child process will see changes
        // from the parent after being spawned. This is
        // almost certainly not what I want, but it is
        // okay for the moment until I decide how to solve it
        let local = bind( sym('$$'), pid, newEnv( env ) );
        if (ppid !== undefined) {
            // bind the parent PID if we have one
            local = bind( sym('$ppid'), ppid, local );
        }

        let kont : Kontinue = Halt( local, nil );
        if (exprs.length > 0) {
            kont = EvalExpr( exprs.pop()!, local, kont );
            while (exprs.length > 0) {
                kont = EvalExpr( exprs.pop()!, local, Drop( local, kont ) );
            }
        }

        // push this so it runs immedately
        this.running.push({ pid, kont, steps : 0 });
        return pid;
    }

    run (exprs : TERM[], env : Env) : Process[] {
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

        let init_pid = this.spawnProcess( to_run, env, undefined ); // no parent

        while (true) {

            while (this.running.length > 0) {
                let proc = this.running.pop()!;
                if (DEBUG) console.log(`>>>> : Switching to ${ pprint(proc.pid) }`);
                proc = this.step(proc, this.DEFAULT_QUOTA);
                switch (proc.kont.type) {
                case 'ERR'   :
                case 'HALT'  :
                    this.haltProcess(proc);
                    break;
                case 'YIELD' :
                    this.yieldProcess(proc);
                    break;
                case 'BLOCK' :
                    let blocker = proc.kont.pid;
                    if (blocker === undefined) throw new Error(`Expected PID from BLOCK, got undefined`);
                    this.blockProcess(blocker, proc);
                    break;
                default:
                    if (DEBUG) console.log(`!!!! : Quota exhausted for ${ pprint(proc.pid) }, refilling`);
                    this.enqueueProcess(proc);
                }
            }

            if (this.blocked.size > 0) {
                let procs = [ ...this.blocked.values() ].flat();
                this.blocked.clear();
                //console.log(procs);
                procs.forEach((p) => {
                    p.kont = RaiseError('DEADLOCKED!', p.kont);
                    this.enqueueProcess(p);
                });
            } else {
                break;
            }
        }

        return [ ...this.halted.values() ];
    }

    step (proc : Process, quota : number) : Process {
        while (quota > 0) {
            if (proc.kont.type == 'ERR') return proc;
            proc.kont = this.kontinue(proc);
            quota--;
            switch (proc.kont.type) {
            case 'BLOCK'  :
            case 'HALT'   :
            case 'YIELD'  : return proc;
            case 'RETURN' :
                let value = proc.kont.value;
                proc.kont = proc.kont.kont;
                proc.kont = this.kontinue( proc, value );
                quota--;
                break;
            }
        }
        return proc;
    }

    kontinue (proc : Process, returned : TERM | undefined = undefined) : Kontinue {
        proc.steps++;
        let kont = proc.kont;
        if (DEBUG) {
            console.log([
                proc.pid.ident.toString().padStart(4, '0'),
                proc.steps.toString().padStart(6, '0'),
                pprintKont(proc.kont)
            ].join(' | '));
        }
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
                        if (cond     == undefined) return RaiseError(`Expected conf for COND, got undefined`, kont);
                        if (if_true  == undefined) return RaiseError(`Expected if-true for COND, got undefined`, kont);
                        if (if_false == undefined) return RaiseError(`Expected if-false for COND, got undefined`, kont);
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
                        if (!isList(params)) return RaiseError(`Params should be a list, not ${pprint(params)} in lambda`, kont);
                        return Return( lambda( params, body, kont.env ), kont.env, kont.kont )
                    case 'let':
                        let name  = car(tail);
                        let value = cadr(tail);
                        if (!isSym(name)) return RaiseError(`Name should be a sym, not ${pprint(name)} in let`, kont);
                        return EvalExpr( value, kont.env, Define( name, kont.env, kont.kont ));
                    case 'quote':
                        return Return( car(tail), kont.env, kont.kont );
                    case 'yield':
                        return EvalExpr( car(tail), kont.env, Yield( kont.env, kont.kont ) );
                    case 'fork':
                        return Return( this.spawnProcess([ car(tail) ], kont.env, proc.pid ), kont.env, Yield( kont.env, kont.kont ) );
                    case 'join':
                        return EvalExpr( car(tail), kont.env, Block( kont.env, kont.kont ) );
                    }
                }
                return EvalExpr(head, kont.env, EvalHead( tail, kont.env, kont.kont ) )
            case isSym(kont.expr):
                let found = lookup(kont.expr, kont.env);
                if (isError(found)) return ThrowError(found, kont);
                return Return( found, kont.env, kont.kont );
            default :
                return Return( kont.expr, kont.env, kont.kont );
            }
        case 'EVAL_HEAD':
            if (returned == undefined) return RaiseError(`Expected call returned to EVAL_HEAD, got undefined`, kont);
            if (!isCallable(returned)) return RaiseError(`Expected CALLABLE call returned to EVAL_HEAD, got something else!`, kont);
            return EvalArgs(kont.args, [], kont.env, Apply( returned, kont.env, kont.kont ))
        case 'EVAL_ARGS':
            let done = [ ...kont.done ];
            if (returned != undefined) {
                done.push(returned);
            }
            if (isNil(kont.args)) return Return( list( ...done ), kont.env, kont.kont );
            return EvalExpr( car(kont.args), kont.env, EvalArgs( cdr(kont.args), done, kont.env, kont.kont ))
        case 'APPLY':
            if (returned == undefined) return RaiseError(`Expected args returned to APPLY, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to APPLY, got something else`, kont);
            let args = returned;
            switch (true) {
            case isLambda(kont.call):
                let local = bindParams( kont.call.params, args, kont.call.env );
                if (isError(local)) return ThrowError(local, kont);
                return EvalExpr( kont.call.body, local, ScopeExit( kont.env, kont.kont ) )
            case isBuiltin(kont.call):
                return Return( kont.call.body(args), kont.env, kont.kont )
            default:
                return RaiseError(`Expected Lambda or Builtin in APPLY`, kont)
            }
        case 'DROP':
            return kont.kont;
        case 'RETURN':
            return kont;
        case 'ERR':
            return kont;
        case 'BLOCK':
            if (returned !== undefined) {
                if (!isPid(returned)) return RaiseError(`Expected PID returned to BLOCK, got ${returned.type}`, kont);
                kont.pid = returned;
            }
            return kont;
        case 'YIELD':
            if (returned !== undefined) kont.result = returned;
            return kont;
        case 'HALT':
            if (returned !== undefined) kont.result = returned;
            return kont;
        case 'DEFINE':
            if (returned == undefined) return RaiseError(`Expected value returned to DEFINE, got undefined`, kont);
            let local = bind( kont.name, returned, kont.env );
            return Return( returned, kont.env, kont.kont );
        case 'COND':
            if (returned == undefined) return RaiseError(`Expected Bool returned to COND, got undefined`, kont);
            if (!isBool(returned))     return RaiseError(`Expected Bool returned to COND, got ${returned.type}`, kont);
            if (isTrue(returned)) {
                return EvalExpr( kont.if_true, kont.env, kont.kont )
            } else {
                return EvalExpr( kont.if_false, kont.env, kont.kont )
            }
        case 'SCOPE_EXIT':
            if (returned == undefined) return RaiseError(`Expected result returned to SCOPE_EXIT, got undefined`, kont);
            return Return( returned, kont.env, kont.kont )
        default:
            return RaiseError(`Unknown Kontinue`, kont);
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

    ;)
    (let pid (fork (
        (join (fork (yield +)))
        (join (fork (
            (join (fork (yield +)))
            (join (fork (yield 5)))
            (join (fork (yield 5)))
        )))
        (join (fork (
            (join (fork (yield *)))
            (join (fork (
                (join (fork (yield +)))
                (join (fork (yield 2)))
                (join (fork (
                    (join (fork (yield +)))
                    (join (fork (yield 1)))
                    (join (fork (yield 1)))
                )))
            )))
            (join (fork (yield 5)))
        )))
    )))

    (list
        (even? 10)
        (odd? 10)
        (fact 6)
        (fib 6)
        (fact (fib 6))
        (length (list 1 2 3 4 5))
        (length-iter (list 1 2 3 4 5) 0)
        (tail-call-demo 10)
        ;; many ways to calculate 30
        (list
            30
            thirty
            (+ 10 20)
            (+ 10.5 19.5)
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
            (join (fork (+ 10 20)))
            (join (fork (+ (yield 10) (yield 20))))
            (join pid)
        )
        "<- all done!"
    )
`;

let source = ``;

let exprs = parse(source || test_source);

if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

let strand = new Strand();
let halted = strand.run(exprs, env);

console.group('DONE:');
for (const proc of halted) {
    if (proc.kont.type == 'HALT') {
        console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
    } else if (proc.kont.type == 'ERR') {
        console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
    } else {
        console.log(pprint(proc.pid), ' WTF! is this?', proc);
    }
}
console.groupEnd();


/*


    (let pid1 (fork (+ (yield 10) (yield 20))))
    (let pid2 (fork (+ 10 20)))
    (let result (+ (join pid1) (join pid2)))


    (let pid (fork (do
            (pprint (list 'in-fork $$))
            (yield (pprint (list 'in-fork $$)))
        )))
    (pprint (list 'in-root-child-pid pid))
    (pprint (list 'in-root $$))

(defun for-loop (init test next body)
    (if (test (init))
        (do
            (body (init))
            (for-loop (lambda () (next (init))) test next body))
        ()))

(for-loop
    (lambda () 0)
    (lambda (i) (< i 10))
    (lambda (i) (+ i 1))
    (lambda (i) (pprint i)))

*/
