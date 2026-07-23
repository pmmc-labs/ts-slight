import { DEBUG, LOG, TRACE, dumpKont } from './debug.ts';
import {
    type TERM, type Env, type MapEnv, type Pid, type ERROR, type LIST, type Cons, type Num,
    isCons, isSym, isList, isNil, isPid, isError, isBool, isTrue, isFalse, isNum,
    isLambda, isBuiltin, isCallable,
    NIL, car, cdr, cadr, cddr, cons, uncons, list, sym, lambda, num, str, bool,
    newPid, newMapEnv, newRibEnv, snapshotEnv, bind, lookup, bindParams, raise, pprint,
} from './terms.ts';
import {
    type Kontinue, type WaitFor,
    ThrowError, RaiseError,
    Eval, EvalExpr, EvalHead, EvalArgs, Apply, Return, Define, Cond,
    Drop, Block, Send, Syscall, Yield, Halt, ScopeExit,
    Fold, FoldLeft, FoldRight, FoldRightK,
} from './konts.ts';
import { SYSCALLS } from './syscalls.ts';

// -----------------------------------------------------------------------------

function haltKey (pid : Pid)        : string { return `halt:${pid.ident}` }
function mailKey (chan_id : number) : string { return `mail:${chan_id}`   }
function sysKey (n : number)        : string { return `sys:${n}`          }

class RunQueue {
    public front : Process[] = [];
    public back  : Process[] = [];

    hasWork () : boolean {
        return (this.front.length + this.back.length) > 0;
    }

    unshift (p : Process) : void {
        this.front.push(p);
    }

    push (p : Process) : void {
        this.back.push(p);
    }

    pop () : Process {
        if (this.back.length == 0) {
            this.back  = this.front.reverse();
            this.front = [];
        }
        return this.back.pop()!;
    }
}

export type Chan = { id : number, queue : TERM[] }

export type Process = {
    pid        : Pid,
    kont       : Kontinue,
    steps      : number,
    mailbox    : Chan,
    expr_stack : TERM[],
}

export type ProcessResult =
    | { type : 'HALT', result : TERM,  pid : Pid, steps : number }
    | { type : 'ERR',   error : ERROR, pid : Pid, steps : number, expr_stack : TERM[] }

export class Strand {
    public runqueue : RunQueue = new RunQueue();
    public halted  : Map<number,ProcessResult> = new Map<number,ProcessResult>();
    public blocked : Map<string,Process[]> = new Map<string,Process[]>();
    public procs   : Map<number,Process>   = new Map<number,Process>();

    private PID_SEQ       = 0;
    private CHAN_SEQ      = 0;
    private SYS_SEQ       = 0;
    private DEFAULT_QUOTA = 10000;
    private inflight      = 0;
    private wake : (() => void) | undefined;

    // benchmark/observability counters, see metrics()
    private SENT_SEQ     = 0;
    private DISPATCH_SEQ = 0;

    metrics () : { procs : number, steps : number, sent : number, dispatches : number } {
        let steps = 0;
        for (const p of this.procs.values())  steps += p.steps;
        for (const h of this.halted.values()) steps += h.steps;
        return {
            procs      : this.PID_SEQ,
            steps      : steps,
            sent       : this.SENT_SEQ,
            dispatches : this.DISPATCH_SEQ,
        };
    }

    private awaitKey (key : string, proc : Process) : void {
        if (DEBUG) LOG(`#### : Blocking ${pprint(proc.pid)} on ${key}`);
        let waiters = this.blocked.get(key) ?? [];
        this.blocked.set(key, [ ...waiters, proc ]);
    }

    private resumeWaiter (proc : Process, resumed : TERM) : void {
        if (proc.kont.type == 'HALT' || proc.kont.type == 'ERR')
            throw new Error(`Cannot resume a finished process`);
        if (DEBUG) LOG(`<<<< : Resuming ${pprint(proc.pid)}`);
        proc.kont = Return( resumed, proc.kont.kont.env, proc.kont.kont );
        this.enqueueProcess(proc);
    }

    private faultWaiter (proc : Process, error : ERROR) : void {
        if (DEBUG) LOG(`<<<< : Faulting ${pprint(proc.pid)}`);
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
            if (DEBUG) LOG(`#### : Dropping ${pprint(msg)} sent to dead ${pprint(target_pid)}`);
            return;
        }
        target.mailbox.queue.push(msg);
        this.SENT_SEQ++;
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
        this.runqueue.unshift(proc);
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
        if (DEBUG) LOG(`#### : Yielding ${pprint(proc.pid)}`);
        proc.kont = proc.kont.kont;
        this.enqueueProcess(proc);
    }

    private blockProcess (blocker_pid : Pid, blockee : Process) : void {
        let finished = this.halted.get( blocker_pid.ident );
        if (finished == undefined) {
            this.awaitKey( haltKey(blocker_pid), blockee );
        } else if (finished.type == 'HALT') {
            if (finished.result == undefined) throw new Error(`Expected result in HALT!`);
            this.resumeWaiter( blockee, finished.result );
        } else if (finished.type == 'ERR') {
            this.faultWaiter( blockee, finished.error );
        } else {
            throw new Error(`A halted process should be HALT or ERR`);
        }
    }

    private haltProcess (proc : Process) : void {
        if (DEBUG) LOG(`#### : Halting ${pprint(proc.pid)}`);
        let proc_result : ProcessResult;
        if (proc.kont.type == 'HALT') {
            if (proc.kont.result === undefined) throw new Error(`Expected result in HALT!`);
            this.deliver( haltKey(proc.pid), proc.kont.result );
            proc_result = { type : 'HALT', result : proc.kont.result, pid : proc.pid, steps : proc.steps }
        } else if (proc.kont.type == 'ERR') {
            this.deliverFault( haltKey(proc.pid), proc.kont.error );
            proc_result = { type : 'ERR', error : proc.kont.error, pid : proc.pid, steps : proc.steps, expr_stack : proc.expr_stack }
        } else {
            throw new Error(`A halted process should be HALT or ERR`);
        }
        this.halted.set( proc.pid.ident, proc_result );
        this.procs.delete( proc.pid.ident );
    }

    private spawnProcess (exprs : TERM[], env : Env, ppid : Pid | undefined) : Pid {
        let pid   = newPid(++this.PID_SEQ);
        let local = newRibEnv( snapshotEnv(env) );
        if (ppid != undefined) bind( sym('$ppid'), ppid, local );

        let kont : Kontinue = Halt( local, NIL );
        if (exprs.length > 0) {
            kont = Eval( exprs.pop()!, local, kont );
            while (exprs.length > 0) {
                kont = Eval( exprs.pop()!, local, Drop( local, kont ) );
            }
        }

        let proc : Process = { pid, kont, steps : 0, mailbox : { id : ++this.CHAN_SEQ, queue : [] }, expr_stack : [] };
        this.procs.set( pid.ident, proc );
        // push this so it runs immedately
        this.runqueue.push(proc);
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
            if (DEBUG) LOG(`!!!! : Quota exhausted for ${ pprint(proc.pid) }, refilling`);
            this.enqueueProcess(proc);
        }
    }

    private sweepDeadlocked () : void {
        let procs = [ ...this.blocked.values() ].flat();
        this.blocked.clear();
        procs.forEach((p) => {
            let on_what = '??';
            if (p.kont.type != 'HALT') {
                on_what = dumpKont(p.kont.kont);
            }
            p.kont = RaiseError(`DEADLOCKED! ${on_what}`, p.kont);
            this.enqueueProcess(p);
        });
    }

    private spawnInitProcess (exprs: TERM[], env : MapEnv) : Pid {
        let root_env = newMapEnv( env ); // for the (defun)s
        let to_run   = [];
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
                    root_env = bind( name, lambda( params, body, root_env, name ), root_env );
                } else {
                    to_run.push(expr);
                }
            } else {
                to_run.push(expr);
            }
        }
        return this.spawnProcess( to_run, root_env, undefined ); // no parent
    }

    async run (exprs : TERM[], env : MapEnv) : Promise<ProcessResult[]> {
        let init_pid = this.spawnInitProcess( exprs, env );

        let hop_every = 25;
        while (true) {
            if (this.runqueue.hasWork()) {
                let proc = this.runqueue.pop()!;
                this.DISPATCH_SEQ++;
                if (DEBUG) LOG(`>>>> : Switching to ${ pprint(proc.pid) }`);
                this.step(proc, this.DEFAULT_QUOTA);
                this.park(proc);
                if (this.inflight > 0 && --hop_every <= 0) {
                    await this.hop();
                    hop_every = 25;
                }
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
        if (DEBUG) TRACE(proc);
        switch (kont.type) {
        case 'EVAL':
            return EvalExpr( kont.expr, kont.env, kont.kont );
        case 'EVAL_EXPR':
            switch (true) {
            case isCons(kont.expr):
                let head = car(kont.expr);
                let tail = cdr(kont.expr);

                // -- EXPR-SCOPE --
                proc.expr_stack.push( list( sym(':EVAL'), kont.expr ));
                // -- EXPR-SCOPE --

                if (isSym(head) && head.ident === 'recv') {
                    if (proc.mailbox.queue.length > 0) {
                        return Return( proc.mailbox.queue.shift()!, kont.env, kont.kont );
                    }
                    return Block( kont.env, kont.kont, { target : 'RECV' } );
                }

                if (isSym(head) && isCons(tail)) {
                    switch (head.ident) {
                    case 'case' :
                    case 'cond' :
                    case 'when' :
                        throw new Error('The (when), (case) and (cond) keywords should be resolved in the Reader, not here!');
                    case 'if' :
                        let [ cond, if_true, if_false ] = uncons(tail);
                        if (cond  == undefined) return RaiseError(`Expected cond for IF, got undefined`, kont);
                        if (if_true  == undefined) return RaiseError(`Expected if-true for IF, got undefined`, kont);
                        if (if_false == undefined) return RaiseError(`Expected if-false for IF, got undefined`, kont);
                        return EvalExpr( cond, kont.env, Cond( if_true, if_false, kont.env, kont.kont ) )
                    case 'and' :
                        let [ and_cond, and_if_true ] = uncons(tail);
                        if (and_cond == undefined) return RaiseError(`Expected cond for AND, got undefined`, kont);
                        if (and_if_true  == undefined) return RaiseError(`Expected if-true for AND, got undefined`, kont);
                        return EvalExpr( and_cond, kont.env, Cond( and_if_true, undefined, kont.env, kont.kont ) )
                    case 'or' :
                        let [ or_cond, or_if_false ] = uncons(tail);
                        if (or_cond     == undefined) return RaiseError(`Expected cond for OR, got undefined`, kont);
                        if (or_if_false == undefined) return RaiseError(`Expected if-false for OR, got undefined`, kont);
                        return EvalExpr( or_cond, kont.env, Cond( undefined, or_if_false, kont.env, kont.kont ) )
                    case 'do' :
                        let exprs = uncons(tail);
                        let next = Eval( exprs.pop()!, kont.env, kont.kont );
                        while (exprs.length > 0) {
                            next = Eval( exprs.pop()!, kont.env, Drop( kont.env, next ) )
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
                    case 'fold/l' : {
                        let [ acc, call, seq ] = uncons(tail);
                        if (acc  == undefined) return RaiseError(`Expected acc for FOLD, got undefined`, kont);
                        if (call == undefined) return RaiseError(`Expected call for FOLD, got undefined`, kont);
                        if (seq  == undefined) return RaiseError(`Expected seq for FOLD, got undefined`, kont);
                        return EvalArgs( tail, [], kont.env, Fold( 'FOLD/LEFT', kont.env, kont.kont ) )
                    }
                    case 'fold/r' : {
                        let [ acc, call, seq ] = uncons(tail);
                        if (acc  == undefined) return RaiseError(`Expected acc for FOLD, got undefined`, kont);
                        if (call == undefined) return RaiseError(`Expected call for FOLD, got undefined`, kont);
                        if (seq  == undefined) return RaiseError(`Expected seq for FOLD, got undefined`, kont);
                        return EvalArgs( tail, [], kont.env, Fold( 'FOLD/RIGHT', kont.env, kont.kont ) )
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
                        return Yield( kont.env, EvalExpr( car(tail), kont.env, kont.kont ));
                    case 'fork':
                        return Return( this.spawnProcess( uncons(tail), kont.env, proc.pid ), kont.env, kont.kont );
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
                    case 'case'    :
                    case 'cond'    :
                    case 'when'    :
                        throw new Error('The (when), (case) and (cond) keywords should be resolved in the Reader, not here!');
                    case 'if'      :
                    case 'and'     :
                    case 'or'      :
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
            if (!isCallable(returned)) return RaiseError(`Expected CALLABLE call returned to EVAL_HEAD, got ${pprint(returned)}`, kont);
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
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to APPLY, got ${pprint(returned)}`, kont);
            let args = returned;
            switch (true) {
            case isLambda(kont.call):
                // -- EXPR-SCOPE --
                // record the call marker for SCOPE-EXIT to clean up
                proc.expr_stack.push(list( sym(':APPLY'),
                    list( sym(':step'),  num(proc.steps)),
                    list( sym(':depth'), num(proc.expr_stack.reduce((acc, e) => (car(e as Cons) === sym(':APPLY') ? acc+1 : acc ), 0))),
                    list( sym(':call'),  (kont.call.name != undefined ? kont.call.name : kont.call) ),
                    list( sym(':args'),  args ),
                ));
                // -- EXPR-SCOPE --
                let local = bindParams( kont.call.params, args, kont.call.env );
                if (isError(local)) return ThrowError(local, kont);
                return Eval( kont.call.body, local, ScopeExit( kont.env, kont.kont, proc.steps ) )
            case isBuiltin(kont.call):
                return Return( kont.call.body(args), kont.env, kont.kont )
            default:
                return RaiseError(`Expected Lambda or Builtin in APPLY`, kont)
            }
        case 'FOLD':
            if (returned == undefined) return RaiseError(`Expected args returned to FOLD, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to FOLD, got ${pprint(returned)}`, kont);
            let fold_args = uncons(returned);
            if (fold_args.length != 3) return RaiseError(`Expected (fold <acc> <call> <seq>), got ${fold_args.length} args -> ${fold_args.map(pprint).join(', ')}`, kont);
            let [ fold_acc, fold_call, fold_seq ] = fold_args;
            if (fold_acc  == undefined) return RaiseError(`Expected <acc> arg for FOLD, got undefined`, kont);
            if (fold_call == undefined) return RaiseError(`Expected <call> arg for FOLD, got undefined`, kont);
            if (!isCallable(fold_call)) return RaiseError(`Expected <call> to be callable, got ${fold_call.type}`, kont);
            if (fold_seq  == undefined) return RaiseError(`Expected <seq> arg for FOLD, got undefined`, kont);
            if (!isCons(fold_seq))      return RaiseError(`Expected <seq> to be Cons, got ${fold_seq.type}`, kont);
            if (kont.kind == 'FOLD/LEFT') {
                return FoldLeft( fold_acc, fold_call, fold_seq, kont.env, kont.kont );
            }
            if (kont.kind == 'FOLD/RIGHT') {
                return FoldRight( fold_acc, fold_call, fold_seq, kont.env, kont.kont );
            }
            return RaiseError(`Unknown Fold Kind ${kont.kind}`, kont);
        case 'FOLD/LEFT':
            if (returned !== undefined) kont.acc = returned;
            if (isNil(kont.seq)) return Return( kont.acc, kont.env, kont.kont );
            return Return( list( kont.acc, kont.seq.first ), kont.env,
                        Apply( kont.call, kont.env,
                            FoldLeft( kont.acc, kont.call, kont.seq.rest, kont.env, kont.kont ) ) )
        case 'FOLD/RIGHT':
            if (isNil(kont.seq)) return Return( kont.acc, kont.env, kont.kont );
            return FoldRight( kont.acc, kont.call, kont.seq.rest, kont.env,
                      FoldRightK( kont.seq.first, kont.call, kont.env, kont.kont ) );
        case 'FOLD/RIGHT/K':
            if (returned == undefined) return RaiseError(`Expected value returned to FOLD/RIGHT/K`, kont);
            return Return( list( kont.item, returned ), kont.env, Apply( kont.call, kont.env, kont.kont ) );
        case 'DROP':
            // -- EXPR-SCOPE --
            proc.expr_stack.splice(0);
            // -- EXPR-SCOPE --
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
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to SEND, got ${pprint(returned)}`, kont);
            let send_args = uncons(returned);
            if (send_args.length != 2) return RaiseError(`send expects (send <pid> <msg>), got ${send_args.length} args -> ${send_args.map(pprint).join(', ')}`, kont);
            let [ send_to, send_msg ] = send_args;
            if (send_to == undefined) return RaiseError(`Expected PID arg for SEND, got undefined`, kont);
            if (send_msg == undefined) return RaiseError(`Expected Msg arg for SEND, got undefined`, kont);
            if (!isPid(send_to)) return RaiseError(`send expects a PID, got ${send_to.type} -> ${pprint(send_to)} `, kont);
            this.sendMessage( send_to, send_msg );
            return Return( send_msg, kont.env, kont.kont );
        case 'SYSCALL':
            if (returned == undefined) return RaiseError(`Expected args returned to SYSCALL, got undefined`, kont);
            if (!isList(returned))     return RaiseError(`Expected args LIST returned to SYSCALL, got ${pprint(returned)}`, kont);
            let sys_args = uncons(returned);
            let sys_name = sys_args.shift();
            if (sys_name == undefined) return RaiseError(`syscall expects (syscall '<name> args ...)`, kont);
            if (!isSym(sys_name))      return RaiseError(`syscall expects a symbol name, got ${sys_name.type}`, kont);
            return Block( kont.env, kont.kont, { target : 'SYSCALL', name : sys_name.ident, args : sys_args } );
        case 'YIELD':
            return kont;
        case 'HALT':
            if (returned !== undefined) kont.result = returned;
            return kont;
        case 'DEFINE':
            if (returned == undefined) return RaiseError(`Expected value returned to DEFINE, got undefined`, kont);
            let local = bind( kont.name, returned, kont.env );
            return Return( returned, kont.env, kont.kont );
        case 'COND':
            if (returned == undefined) return RaiseError(`Expected value returned to COND, got undefined`, kont);
            // (or cond if-false)
            if (kont.if_true === undefined) {
                if (kont.if_false === undefined) return RaiseError(`Expected if-false in COND, got undefined`, kont);
                if (isBool(returned) ? isFalse(returned) : isNum(returned) ? returned.value == 0 : isNil(returned)) {
                    return EvalExpr( kont.if_false, kont.env, kont.kont )
                } else {
                    return Return( returned, kont.env, kont.kont );
                }
            }
            // (and cond if-true)
            else if (kont.if_false === undefined) {
                if (kont.if_true === undefined) return RaiseError(`Expected if-true in COND, got undefined`, kont);
                if (isBool(returned) ? isTrue(returned) : isNum(returned) ? returned.value != 0 : !isNil(returned)) {
                    return EvalExpr( kont.if_true, kont.env, kont.kont )
                } else {
                    return Return( returned, kont.env, kont.kont );
                }
            }
            // (if cond if-true if-false)
            else {
                if (!isBool(returned)) return RaiseError(`Expected Bool returned to COND, got ${returned.type}`, kont);
                if (isTrue(returned)) {
                    return EvalExpr( kont.if_true, kont.env, kont.kont )
                } else {
                    return EvalExpr( kont.if_false, kont.env, kont.kont )
                }
            }
        case 'SCOPE_EXIT':
            if (returned == undefined) return RaiseError(`Expected result returned to SCOPE_EXIT, got undefined`, kont);
            // -- EXPR-SCOPE --
            //console.log('BEFORE', proc.expr_stack.map(pprint));
            while (proc.expr_stack.length > 0) {
                let expr = proc.expr_stack.pop()!;
                if (car(expr as Cons) == sym(':APPLY')
                && (cadr(cadr(expr as Cons) as Cons) as Num).value == kont.entry_step ) {
                    proc.expr_stack.pop()!;
                    break;
                }
            }
            //console.log('AFTER', proc.expr_stack.map(pprint));
            // -- EXPR-SCOPE --
            return Return( returned, kont.env, kont.kont )
        default:
            return RaiseError(`Unknown Kontinue`, kont);
        }
    }
}
