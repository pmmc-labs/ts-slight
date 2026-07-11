import {
    type TERM, type LIST, type CALLABLE, type Env, type Sym, type Pid, type ERROR,
    raise, pprint,
} from './terms.ts';

// -----------------------------------------------------------------------------

export type Kontinuation = { env : Env, kont : Kontinue }

export type EvalExpr  = { type : 'EVAL_EXPR', expr : TERM                     } & Kontinuation
export type EvalHead  = { type : 'EVAL_HEAD', args : LIST                     } & Kontinuation
export type EvalArgs  = { type : 'EVAL_ARGS', args : LIST, done : TERM[]      } & Kontinuation
export type Apply     = { type : 'APPLY',     call : CALLABLE                 } & Kontinuation
export type Return    = { type : 'RETURN',    value : TERM                    } & Kontinuation
export type Define    = { type : 'DEFINE',    name : Sym                      } & Kontinuation
export type Cond      = { type : 'COND',      if_true : TERM, if_false : TERM } & Kontinuation

export type Send      = { type : 'SEND'       } & Kontinuation
export type Syscall   = { type : 'SYSCALL'    } & Kontinuation
export type ScopeExit = { type : 'SCOPE_EXIT' } & Kontinuation
export type Drop      = { type : 'DROP'       } & Kontinuation
export type Err       = { type : 'ERR',  error : ERROR } & Kontinuation
export type Block     = { type : 'BLOCK', on : WaitFor | undefined } & Kontinuation
export type Yield     = { type : 'YIELD', result : TERM | undefined } & Kontinuation
export type Halt      = { type : 'HALT',  result : TERM | undefined, env : Env }

export type Kontinue =
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

export function pprintKont (kont : Kontinue) : string {
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

export function ThrowError (error : ERROR, kont : Kontinue)  : Err {
    return { type : 'ERR', error, env : kont.env, kont }
}

export function RaiseError   (error : string, kont : Kontinue) : Err {
    return ThrowError( raise(error), kont )
}

export function EvalExpr (expr : TERM, env : Env, kont : Kontinue) : EvalExpr {
    return { type : 'EVAL_EXPR', expr, env, kont }
}

export function EvalHead (args : LIST, env : Env, kont : Kontinue) : EvalHead {
    return { type : 'EVAL_HEAD', args, env, kont }
}

export function EvalArgs (args : LIST, done : TERM[], env : Env, kont : Kontinue) : EvalArgs {
    return { type : 'EVAL_ARGS', args, done, env, kont }
}

export function Apply (call : CALLABLE, env : Env, kont : Kontinue) : Apply {
    return { type : 'APPLY', call, env, kont }
}

export function Return (value : TERM, env : Env, kont : Kontinue) : Return {
    return { type  : 'RETURN', value, env, kont }
}

export function Define (name : Sym, env : Env, kont : Kontinue) : Define {
    return { type  : 'DEFINE', name, env, kont }
}

export function Cond (if_true : TERM, if_false : TERM, env : Env, kont : Kontinue) : Cond {
    return { type : 'COND', if_true, if_false, env, kont }
}

export function Drop (env : Env, kont : Kontinue) : Drop {
    return { type : 'DROP', env, kont }
}

export function Block (env : Env, kont : Kontinue, on : WaitFor | undefined = undefined) : Block {
    return { type : 'BLOCK', on, env, kont }
}

export function Send (env : Env, kont : Kontinue) : Send {
    return { type : 'SEND', env, kont }
}

export function Syscall (env : Env, kont : Kontinue) : Syscall {
    return { type : 'SYSCALL', env, kont }
}

export function Yield (env : Env, kont : Kontinue, result : TERM | undefined = undefined) : Yield {
    return { type : 'YIELD', result, env, kont }
}

export function Halt (env : Env, result : TERM | undefined = undefined) : Halt {
    return { type : 'HALT', result, env }
}

export function ScopeExit (env : Env, kont : Kontinue) : ScopeExit {
    if (kont.type == 'SCOPE_EXIT') return ScopeExit(env, kont.kont);
    return { type : 'SCOPE_EXIT', env, kont }
}

// -----------------------------------------------------------------------------

export type Chan = { id : number, queue : TERM[] }

export type WaitFor =
    | { target : 'JOIN',    pid : Pid }
    | { target : 'RECV' }
    | { target : 'SYSCALL', name : string, args : TERM[] }

export type Process = { pid : Pid, kont : Kontinue, steps : number, mailbox : Chan }
