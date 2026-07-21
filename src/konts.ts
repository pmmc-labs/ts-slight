import {
    type TERM, type LIST, type CALLABLE, type Env, type Sym, type Pid, type ERROR, type Cons,
    raise, pprint,
} from './terms.ts';

// -----------------------------------------------------------------------------

export type Kontinuation = { env : Env, kont : Kontinue }

export type MaybeTERM = TERM | undefined

export type WaitFor =
    | { target : 'JOIN',    pid : Pid }
    | { target : 'RECV' }
    | { target : 'SYSCALL', name : string, args : TERM[] }

export type Eval      = { type : 'EVAL',      expr : TERM                } & Kontinuation
export type EvalExpr  = { type : 'EVAL_EXPR', expr : TERM                } & Kontinuation
export type EvalHead  = { type : 'EVAL_HEAD', args : LIST                } & Kontinuation
export type EvalArgs  = { type : 'EVAL_ARGS', args : LIST, done : TERM[] } & Kontinuation
export type Apply     = { type : 'APPLY',     call : CALLABLE            } & Kontinuation
export type Return    = { type : 'RETURN',    value : TERM               } & Kontinuation
export type Define    = { type : 'DEFINE',    name : Sym                 } & Kontinuation

export type FoldKind  = 'FOLD/LEFT' | 'FOLD/RIGHT';
export type Fold      = { type : 'FOLD', kind : FoldKind } & Kontinuation
export type FoldLeft  = { type : 'FOLD/LEFT', acc : TERM, call : CALLABLE, seq : LIST } & Kontinuation
export type FoldRight = { type : 'FOLD/RIGHT', acc : TERM, call : CALLABLE, seq : LIST } & Kontinuation

export type Cond      = { type : 'COND', if_true : MaybeTERM, if_false : MaybeTERM } & Kontinuation
export type Send      = { type : 'SEND'       } & Kontinuation
export type Syscall   = { type : 'SYSCALL'    } & Kontinuation
export type ScopeExit = { type : 'SCOPE_EXIT' } & Kontinuation
export type Drop      = { type : 'DROP'       } & Kontinuation
export type Err       = { type : 'ERR',   error : ERROR } & Kontinuation
export type Block     = { type : 'BLOCK', on : WaitFor | undefined } & Kontinuation
export type Yield     = { type : 'YIELD' } & Kontinuation
export type Halt      = { type : 'HALT', result : MaybeTERM, env : Env }

export type Kontinue =
    | Eval
    | EvalExpr
    | EvalHead
    | EvalArgs
    | Apply
    | Fold
    | FoldLeft
    | FoldRight
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

export function ThrowError (error : ERROR, kont : Kontinue)  : Err {
    return { type : 'ERR', error, env : kont.env, kont }
}

export function RaiseError   (error : string, kont : Kontinue) : Err {
    return ThrowError( raise(error), kont )
}

export function Eval (expr : TERM, env : Env, kont : Kontinue) : Eval {
    return { type : 'EVAL', expr, env, kont }
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

export function Fold (kind : FoldKind, env : Env, kont : Kontinue) : Fold {
    return { type  : 'FOLD', kind, env, kont }
}

export function FoldLeft (acc : TERM, call : CALLABLE, seq : LIST, env : Env, kont : Kontinue) : FoldLeft {
    return { type  : 'FOLD/LEFT', acc, call, seq, env, kont }
}

export function FoldRight (acc : TERM, call : CALLABLE, seq : LIST, env : Env, kont : Kontinue) : FoldRight {
    return { type  : 'FOLD/RIGHT', acc, call, seq, env, kont }
}

export function Return (value : TERM, env : Env, kont : Kontinue) : Return {
    return { type  : 'RETURN', value, env, kont }
}

export function Define (name : Sym, env : Env, kont : Kontinue) : Define {
    return { type  : 'DEFINE', name, env, kont }
}

export function Cond (if_true : MaybeTERM, if_false : MaybeTERM, env : Env, kont : Kontinue) : Cond {
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

export function Yield (env : Env, kont : Kontinue) : Yield {
    return { type : 'YIELD', env, kont }
}

export function Halt (env : Env, result : TERM | undefined = undefined) : Halt {
    return { type : 'HALT', result, env }
}

export function ScopeExit (env : Env, kont : Kontinue) : ScopeExit {
    if (kont.type == 'SCOPE_EXIT') return ScopeExit(env, kont.kont);
    return { type : 'SCOPE_EXIT', env, kont }
}

