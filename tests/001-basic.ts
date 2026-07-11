
import { DEBUG } from '../src/debug.ts';
import {
    type TERM, type LIST, type LITERAL, type CALLABLE,
    type Nil, type Cons, type Sym, type Pid, type Str, type Num, type Bool,
    type ERROR, type Env, type Lambda, type Builtin,
    isNil, isCons, isSym, isPid, isStr, isNum, isBool, isTrue, isFalse,
    isError, isBuiltin, isLambda, isEnv, isLiteral, isList, isCallable,
    nil, cons, car, cdr, cadr, cddr, num, str, bool, sym, lambda, raise,
    list, newPid, newEnv, bind, lookup, bindParams, uncons, eq, pprint,
} from '../src/terms.ts';
import { parse } from '../src/parser.ts';
import { initalizeEnv } from '../src/builtins.ts';

// -----------------------------------------------------------------------------

const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>> = new Map();

SYSCALLS.set('sleep', (args : TERM[]) : Promise<TERM> => {
    let ms = args[0];
    if (ms == undefined || !isNum(ms)) return Promise.reject(`sleep expects (ms : NUM)`);
    return new Promise((resolve) => setTimeout(() => resolve(ms), ms.value));
});

// -----------------------------------------------------------------------------

type Kontinuation = { env : Env, kont : Kontinue }

type EvalExpr  = { type : 'EVAL_EXPR', expr : TERM                     } & Kontinuation
type EvalHead  = { type : 'EVAL_HEAD', args : LIST                     } & Kontinuation
type EvalArgs  = { type : 'EVAL_ARGS', args : LIST, done : TERM[]      } & Kontinuation
type Apply     = { type : 'APPLY',     call : CALLABLE                 } & Kontinuation
type Return    = { type : 'RETURN',    value : TERM                    } & Kontinuation
type Define    = { type : 'DEFINE',    name : Sym                      } & Kontinuation
type Cond      = { type : 'COND',      if_true : TERM, if_false : TERM } & Kontinuation

type Send      = { type : 'SEND'       } & Kontinuation
type Syscall   = { type : 'SYSCALL'    } & Kontinuation
type ScopeExit = { type : 'SCOPE_EXIT' } & Kontinuation
type Drop      = { type : 'DROP'       } & Kontinuation
type Err       = { type : 'ERR',  error : ERROR } & Kontinuation
type Block     = { type : 'BLOCK', on : WaitFor | undefined } & Kontinuation
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
    | Send
    | Syscall
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
    case 'SEND'       : break;
    case 'SYSCALL'    : break;
    case 'BLOCK'      : kontStr += ` =: ${kont.on == undefined ? '' : (kont.on.target == 'JOIN' ? pprint(kont.on.pid) : kont.on.target)}`; break;
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

function Block (env : Env, kont : Kontinue, on : WaitFor | undefined = undefined) : Block {
    return { type : 'BLOCK', on, env, kont }
}

function Send (env : Env, kont : Kontinue) : Send {
    return { type : 'SEND', env, kont }
}

function Syscall (env : Env, kont : Kontinue) : Syscall {
    return { type : 'SYSCALL', env, kont }
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

function haltKey (pid : Pid)        : string { return `halt:${pid.ident}` }
function mailKey (chan_id : number) : string { return `mail:${chan_id}`   }
function sysKey (n : number)        : string { return `sys:${n}`          }

type Chan = { id : number, queue : TERM[] }

type WaitFor =
    | { target : 'JOIN',    pid : Pid }
    | { target : 'RECV' }
    | { target : 'SYSCALL', name : string, args : TERM[] }

type Process = { pid : Pid, kont : Kontinue, steps : number, mailbox : Chan }

class Strand {
    public running : Process[]             = [];
    public halted  : Map<number,Process>   = new Map<number,Process>();
    public blocked : Map<string,Process[]> = new Map<string,Process[]>();
    public procs   : Map<number,Process>   = new Map<number,Process>();

    private PID_SEQ       = 0;
    private CHAN_SEQ      = 0;
    private SYS_SEQ       = 0;
    private DEFAULT_QUOTA = 10000;
    private inflight      = 0;
    private wake : (() => void) | undefined;

    private awaitKey (key : string, proc : Process) : void {
        if (DEBUG) console.log(`#### : Blocking ${pprint(proc.pid)} on ${key}`);
        let waiters = this.blocked.get(key) ?? [];
        this.blocked.set(key, [ ...waiters, proc ]);
    }

    private resumeWaiter (proc : Process, resumed : TERM) : void {
        if (proc.kont.type == 'HALT' || proc.kont.type == 'ERR')
            throw new Error(`Cannot resume a finished process`);
        if (DEBUG) console.log(`<<<< : Resuming ${pprint(proc.pid)}`);
        proc.kont = Return( resumed, proc.kont.kont.env, proc.kont.kont );
        this.enqueueProcess(proc);
    }

    private faultWaiter (proc : Process, error : ERROR) : void {
        if (DEBUG) console.log(`<<<< : Faulting ${pprint(proc.pid)}`);
        proc.kont = ThrowError( error, proc.kont );
        this.enqueueProcess(proc);
    }

    // NOTE: resumes ALL waiters with the same value. Right for halt
    // keys (join is a broadcast); mail keys only ever have one waiter
    // (the mailbox owner). A shared first-class channel would need a
    // deliver-to-one variant.
    private deliver (key : string, value : TERM) : void {
        let waiters = this.blocked.get(key);
        if (waiters == undefined) return;
        this.blocked.delete(key);
        waiters.forEach((p) => this.resumeWaiter(p, value));
    }

    private deliverFault (key : string, error : ERROR) : void {
        let waiters = this.blocked.get(key);
        if (waiters == undefined) return;
        this.blocked.delete(key);
        waiters.forEach((p) => this.faultWaiter(p, error));
    }

    private sendMessage (target_pid : Pid, msg : TERM) : void {
        let target = this.procs.get( target_pid.ident );
        if (target == undefined || this.halted.has( target_pid.ident )) {
            // fire-and-forget: sending to a dead or unknown pid succeeds silently
            if (DEBUG) console.log(`#### : Dropping ${pprint(msg)} sent to dead ${pprint(target_pid)}`);
            return;
        }
        target.mailbox.queue.push(msg);
        let key = mailKey(target.mailbox.id);
        if (this.blocked.has(key)) {
            // the queue stays the source of truth: push above, shift here
            this.deliver( key, target.mailbox.queue.shift()! );
        }
    }

    private async dispatchSyscall (name : string, args : TERM[]) : Promise<TERM> {
        let sys = SYSCALLS.get(name);
        if (sys == undefined) return Promise.reject(`Unknown syscall '${name}'`);
        return sys(args);
    }

    private enqueueProcess (proc : Process) : void {
        this.running.unshift(proc);
        if (this.wake != undefined) {
            this.wake();
            this.wake = undefined;
        }
    }

    private hop () : Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    private sleepUntilWoken () : Promise<void> {
        return new Promise((resolve) => this.wake = resolve);
    }

    private yieldProcess (proc : Process) : void {
        if (proc.kont.type != 'YIELD') throw new Error(`You can only yield on a YIELD!`);
        if (proc.kont.result === undefined) throw new Error(`Expected result in YIELD!`);
        if (DEBUG) console.log(`#### : Yielding ${pprint(proc.pid)}`);
        proc.kont = Return( proc.kont.result, proc.kont.kont.env, proc.kont.kont );
        this.enqueueProcess(proc);
    }

    private blockProcess (blocker_pid : Pid, blockee : Process) : void {
        let finished = this.halted.get( blocker_pid.ident );
        if (finished == undefined) {
            this.awaitKey( haltKey(blocker_pid), blockee );
        } else if (finished.kont.type == 'HALT') {
            if (finished.kont.result == undefined) throw new Error(`Expected result in HALT!`);
            this.resumeWaiter( blockee, finished.kont.result );
        } else if (finished.kont.type == 'ERR') {
            this.faultWaiter( blockee, finished.kont.error );
        } else {
            throw new Error(`A halted process should be HALT or ERR`);
        }
    }

    private haltProcess (proc : Process) : void {
        if (DEBUG) console.log(`#### : Halting ${pprint(proc.pid)}`);
        if (proc.kont.type == 'HALT') {
            if (proc.kont.result === undefined) throw new Error(`Expected result in HALT!`);
            this.deliver( haltKey(proc.pid), proc.kont.result );
        } else if (proc.kont.type == 'ERR') {
            this.deliverFault( haltKey(proc.pid), proc.kont.error );
        }
        this.halted.set( proc.pid.ident, proc );
    }

    private spawnProcess (exprs : TERM[], env : Env, ppid : Pid | undefined) : Pid {
        let pid   = newPid(++this.PID_SEQ);
        let local = newEnv( env );
        if (ppid != undefined) bind( sym('$ppid'), ppid, local );

        let kont : Kontinue = Halt( local, nil );
        if (exprs.length > 0) {
            kont = EvalExpr( exprs.pop()!, local, kont );
            while (exprs.length > 0) {
                kont = EvalExpr( exprs.pop()!, local, Drop( local, kont ) );
            }
        }

        let proc : Process = { pid, kont, steps : 0, mailbox : { id : ++this.CHAN_SEQ, queue : [] } };
        this.procs.set( pid.ident, proc );
        // push this so it runs immedately
        this.running.push(proc);
        return pid;
    }

    private park (proc : Process) : void {
        switch (proc.kont.type) {
        case 'ERR'   :
        case 'HALT'  :
            this.haltProcess(proc);
            break;
        case 'YIELD' :
            this.yieldProcess(proc);
            break;
        case 'BLOCK' : {
            let wait = proc.kont.on;
            if (wait === undefined) throw new Error(`Expected wait target from BLOCK, got undefined`);
            switch (wait.target) {
            case 'JOIN':
                this.blockProcess( wait.pid, proc );
                break;
            case 'RECV':
                this.awaitKey( mailKey(proc.mailbox.id), proc );
                break;
            case 'SYSCALL': {
                let key = sysKey(++this.SYS_SEQ);
                this.awaitKey( key, proc );
                this.inflight++;
                this.dispatchSyscall(wait.name, wait.args)
                    .then((result) => { this.inflight--; this.deliver(key, result); },
                          (e)      => { this.inflight--; this.deliverFault(key, raise(String(e))); });
                break;
            }
            }
            break;
        }
        default:
            if (DEBUG) console.log(`!!!! : Quota exhausted for ${ pprint(proc.pid) }, refilling`);
            this.enqueueProcess(proc);
        }
    }

    private sweepDeadlocked () : void {
        let procs = [ ...this.blocked.values() ].flat();
        this.blocked.clear();
        procs.forEach((p) => {
            p.kont = RaiseError('DEADLOCKED!', p.kont);
            this.enqueueProcess(p);
        });
    }

    async run (exprs : TERM[], env : Env) : Promise<Process[]> {
        env = newEnv( env ); // for the (defun)s

        let to_run = [];
        for (const expr of exprs) {
            if (isCons(expr)) {
                let head = car(expr);
                if (isSym(head) && head.ident === 'defun') {
                    let [ name, params, ...body_exprs ] = uncons(cdr(expr));
                    if (name   === undefined) throw new Error(`defun <name> ... duh!`);
                    if (params === undefined) throw new Error(`defun <name> <params> ... duh!`);
                    if (body_exprs.length == 0) throw new Error(`defun <name> <params> <body>... duh!`);
                    if (!isSym(name))    throw new Error(`defun <name> ... duh!`);
                    if (!isList(params)) throw new Error(`defun <name> <params>... duh!`);
                    let body = body_exprs.length == 1 ? body_exprs[0] : list(sym('do'), ...body_exprs);
                    if (body === undefined) throw new Error(`defun <name> <params> ... really shouldnt happen, just typescript being annoying`);
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
            if (this.running.length > 0) {
                let proc = this.running.pop()!;
                if (DEBUG) console.log(`>>>> : Switching to ${ pprint(proc.pid) }`);
                this.step(proc, this.DEFAULT_QUOTA);
                this.park(proc);
                await this.hop();
            } else if (this.inflight > 0) {
                await this.sleepUntilWoken();
            } else if (this.blocked.size > 0) {
                this.sweepDeadlocked();
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
                // an ERROR term is never a value: fault the process at the
                // site that produced it instead of letting it flow onward
                if (isError(value)) {
                    proc.kont = ThrowError( value, proc.kont );
                    return proc;
                }
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
                pprintKont(proc.kont),
            ].join(' | '));
        }
        switch (kont.type) {
        case 'EVAL_EXPR':
            switch (true) {
            case isCons(kont.expr):
                let head = car(kont.expr);
                let tail = cdr(kont.expr);

                if (isSym(head) && head.ident === 'recv') {
                    if (proc.mailbox.queue.length > 0) {
                        return Return( proc.mailbox.queue.shift()!, kont.env, kont.kont );
                    }
                    return Block( kont.env, kont.kont, { target : 'RECV' } );
                }

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
                    case 'lambda' : {
                        let params = car(tail);
                        let rest   = cdr(tail);
                        if (!isList(params)) return RaiseError(`Params should be a list, not ${pprint(params)} in lambda`, kont);
                        if (!isCons(rest))   return RaiseError(`lambda expects a body`, kont);
                        let body = isNil(rest.rest) ? rest.first : cons(sym('do'), rest);
                        return Return( lambda( params, body, kont.env ), kont.env, kont.kont )
                    }
                    case 'let': {
                        let name  = car(tail);
                        let rest  = cdr(tail);
                        if (!isSym(name))  return RaiseError(`Name should be a sym, not ${pprint(name)} in let`, kont);
                        if (!isCons(rest)) return RaiseError(`let expects (let <name> <value>)`, kont);
                        return EvalExpr( rest.first, kont.env, Define( name, kont.env, kont.kont ));
                    }
                    case 'quote':
                        return Return( car(tail), kont.env, kont.kont );
                    case 'yield':
                        return EvalExpr( car(tail), kont.env, Yield( kont.env, kont.kont ) );
                    case 'fork':
                        return Return( this.spawnProcess( uncons(tail), kont.env, proc.pid ), kont.env, Yield( kont.env, kont.kont ) );
                    case 'join':
                        return EvalExpr( car(tail), kont.env, Block( kont.env, kont.kont ) );
                    case 'send':
                        return EvalArgs( tail, [], kont.env, Send( kont.env, kont.kont ) );
                    case 'syscall':
                        return EvalArgs( tail, [], kont.env, Syscall( kont.env, kont.kont ) );
                    }
                }
                // special form with an empty tail: report the arity instead of
                // falling through to a misleading "Unable to find X in Env"
                if (isSym(head) && isNil(tail)) {
                    switch (head.ident) {
                    case 'if'      :
                    case 'do'      :
                    case 'lambda'  :
                    case 'let'     :
                    case 'quote'   :
                    case 'yield'   :
                    case 'fork'    :
                    case 'join'    :
                    case 'send'    :
                    case 'syscall' :
                        return RaiseError(`${head.ident} expects arguments, got none`, kont);
                    }
                }
                return EvalExpr(head, kont.env, EvalHead( tail, kont.env, kont.kont ) )
            case isSym(kont.expr):
                if (kont.expr.ident == '$$') {
                    return Return( proc.pid, kont.env, kont.kont );
                } else {
                    let found = lookup(kont.expr, kont.env);
                    if (isError(found)) return ThrowError(found, kont);
                    return Return( found, kont.env, kont.kont );
                }
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
                kont.on = { target : 'JOIN', pid : returned };
            }
            return kont;
        case 'SEND':
            if (returned == undefined) return RaiseError(`Expected args returned to SEND, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to SEND, got something else`, kont);
            let send_args = uncons(returned);
            if (send_args.length != 2) return RaiseError(`send expects (send <pid> <msg>), got ${send_args.length} args`, kont);
            let [ send_to, send_msg ] = send_args;
            if (send_to == undefined) return RaiseError(`Expected PID arg for SEND, got undefined`, kont);
            if (!isPid(send_to)) return RaiseError(`send expects a PID, got ${send_to.type}`, kont);
            if (send_msg == undefined) return RaiseError(`Expected Msg arg for SEND, got undefined`, kont);
            this.sendMessage( send_to, send_msg );
            return Return( send_msg, kont.env, kont.kont );
        case 'SYSCALL':
            if (returned == undefined) return RaiseError(`Expected args returned to SYSCALL, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to SYSCALL, got something else`, kont);
            let sys_args = uncons(returned);
            let sys_name = sys_args.shift();
            if (sys_name == undefined) return RaiseError(`syscall expects (syscall '<name> args ...)`, kont);
            if (!isSym(sys_name))      return RaiseError(`syscall expects a symbol name, got ${sys_name.type}`, kont);
            return Block( kont.env, kont.kont, { target : 'SYSCALL', name : sys_name.ident, args : sys_args } );
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

let test_source = `

    (defun adder (n m) (+ n m))

    (defun double (n) (adder n n))

    (defun fact (n)
        (if (== n 0) 1
            (* n (fact (- n 1)))))

    (defun fact-fork (n)
        (if (== n 0)
            (fork 1)
            (fork (* n (join (fact-fork (- n 1)))))))

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
            (- (join (fact-fork 6)) (+ (* (join (fact-fork 3)) 100) 90))
        )
        "<- all done!"
    )
`;

let source = ``;

let exprs = parse(source || test_source);

if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

let env = newEnv();
env = initalizeEnv( env );

async function main () {
    let strand = new Strand();

    console.time('...run');
    let halted = await strand.run(exprs, env);
    console.timeEnd('...run');

    console.group('DONE:');
    if (DEBUG) {
        for (const proc of halted) {
            if (proc.kont.type == 'HALT') {
                console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
            } else if (proc.kont.type == 'ERR') {
                console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
            } else {
                console.log(pprint(proc.pid), ' WTF! is this?', proc);
            }
        }
    } else {
        console.log("TOTAL : ", halted.length);
        console.log("HALT  : ", halted.filter((p) => p.kont.type == 'HALT').length);
        console.log("ERROR : ", halted.filter((p) => p.kont.type == 'ERR').length);
    }
    console.groupEnd();
}

main().catch((e) => {
    console.error(String(e));
    process.exit(1);
});

/*


*/
