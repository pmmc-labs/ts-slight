```
   _____ ___       __    __
  / ___// (_)___ _/ /_  / /_
  \__ \/ / / __ `/ __ \/ __/
 ___/ / / / /_/ / / / / /_
/____/_/_/\__, /_/ /_/\__/
         /____/
```

The different slights, each of which is slightly different than the other. 

<!----------------------------------------------------------------------------->
## pre-slight(s)
<!----------------------------------------------------------------------------->

There were a few LISP projects called slight, some written by me, some by AI, 
some by a combination of the two. They were mostly directionless and are not 
useful. They gave us the name, the is good enough.

<!----------------------------------------------------------------------------->
## proto-slight(s)
<!----------------------------------------------------------------------------->

Before Slight, there was MXCL, and several versions of it as well. 

Inside the MXCLS folder, stuff to look over.

- ___EARLY___
    - p5-MXCL ... probably the first full formed MXCL 
    - ts-slight-old ... early version of slight, should be moved
- p5-MXCL
    - this uses Roles heavily 
    - uses interesting approach to bootstrap builtins
    - lots of code written in here
- ts-MXCL
    - basically took p5-MXCL and agressively simplified
    - though it might have been a simpification of ts-slight-old
        - or perhaps reversed, and ts-slight-old came from this

<!----------------------------------------------------------------------------->
## modern-slight(s)
<!----------------------------------------------------------------------------->

<!----------------------------------------------------------------------------->
## p5-slight
<!----------------------------------------------------------------------------->

This was the first one, written in Perl 5. It was the first one to use the
Kontinue mechanism, and all terms were hashed. It got to the point of working
actors and timers, etc. 

It failed because it tried to do too much at once, the docs/ folder should 
confirm that. 

### p5-slight/t/999-ideas.t

This is where the p5 work all kind of ended up. This design is worth
reviewing to see if we lost anything useful. 

<!----------------------------------------------------------------------------->
## ts-slight
<!----------------------------------------------------------------------------->

Currently the most polished one, and the successor to p5-slight bringing in
some ideas from the t/999-idea.t

This is where a lot of the high level vision and ultimate end applications
have been worked on and through. The examples/ directory is full of good 
stuff, and the bench/ suite is a good tool. It also include a TAP producing
Test module and Prelude. 

A lot of the ergonomics were worked out (or are in the process of being 
worked out) in this repository. The different editor and window-manager 
explorations, along with the OO explorations, etc. 

This kind of "user surface" is what we want to work towards, but this 
ultimately failed because it is a slow tree walker, and too many features 
were added and it got messy. 

However, this was kind of the goal of it and a semi-concious decision to 
not try to over formalise or over engineer everything, but instead get 
something working that I can play with and refine the "user surface" of.

<!----------------------------------------------------------------------------->
## slight TNG ??
<!----------------------------------------------------------------------------->

What followed were these experiments:

- oc-slight

Quick little side project to write it in OCaml. The repo has just a small recursive 
interpreter that I wrote to refamiliarize myself with Ocaml. 

- mini-slight

A small Javascript tokenizer -> parser -> compiler -> optimizer pipeline that lowers 
everything down to linear bytecode. It turned out to be pretty fast.

There is partial exploration of a Thread model in here, which is unfinished, but forms 
the basis for the one used in c-slight

- wasm-slight

This was an attempt to write things in AssemblyScript, it was successful in the 
parser and compiled layout (which got carried onto c-slight), but the interpreter
was not going in the right direction.

- c-slight

This is a C VM put together by AI based on all the learnings of the previous 
slights. 

<!----------------------------------------------------------------------------->
## Historical Runtime Prototype Continuation Breakdowns
<!----------------------------------------------------------------------------->

## MXCL

These had applicatives/operatives instead of just applicatives like slight. 

### ../MXCLs/__EARLY__/p5-mxcl

This one had proper unwinding try/catch and a defer. 

No concurrency, but the HOST provided Effects and tried to lay a foundation 
for Capabilities. 

Had "optimised" List type that gave a view over a fixed array of all the list
elements. Getting the tail of the list returned a new view with the head index
moved forward by one.

- Host
- Throw
- Catch
- IfElse
- Define
- Mutate
- Context::Enter
- Context::Leave
- Return
- Eval::Expr
- Eval::TOS
- Eval::Cons
- Eval::Cons::Rest
- Apply::Expr
- Apply::Operative
- Apply::Applicative

### ../MXCLs/__EARLY__/ts-slight-old

Also no concurrency, and focused on Effects, ... includes the AI REPL effect. 

The try/catch should work, but lots of debug messages around it make me wonder.

- HOST
- THROW
- CATCH
- IF/ELSE
- DEFINE
- RETURN
- EVAL/EXPR
- EVAL/TOS
- EVAL/CONS
- EVAL/CONS
- APPLY/EXPR
- APPLY/OPERATIVE
- APPLY/APPLICATIVE

### ./attic/MXCL.java

Its in the attic here ...

- ERROR
- HALT
- RETURN
- EVAL_EXPR
- EVAL_HEAD
- EVAL_ARGS
- APPLY_EXPR
- APPLY_NATIVE

### ../MXCLs/p5-MXCL

Had a content addressed arena for terms, including git style commits. 

Everything was content addressed at one point, like everything! 

The regular LISP terms are used with one execption, which is that environments 
have been unified with roles. Every new definition resulted in a new flat env
being constructed by composing the current env role with a new anon role made up 
of the new binding(s) (this would have made multi-bind lets, and pattern 
matching easier, which were plans, but not realized). If a conflict happened 
when a creating the new env, it could be examined to see what was conflicted 
against. If it was against a constant, an error could be thrown, otherwise, the
newest would be chosen. The structure used carried the full conflict provenance
as well. 

The roles form the basis of a kind of prototypeish object system with roles as 
the "template" for the prototypes. 

The OO system allows for infix syntax `(10 + 20)` is a method call on `10`. And
had Roles that wrapped the core terms to allow this. 

This had a fairly sophisticated Primitives system to manage builtins, and had
only one keyword `bind` at startup, the rest gets loaded via a Prelude which 
binds symbols to the builtins managed by the Primitives system, and then builds
more on top of that.

Fexpr/Operative here was useful in some ways, but not in others. 

Lots of stuff in here, like dev/experiments/ has a raylib REPL and a badly 
written TUI repl. The Tape abstraction came back from older experiments in 
FORTH machines.

This is the one that I was writing when I went to FOSDEM. 

- Host
- Return
- Discard
- Capture
- IfElse
- DoWhile
- Eval::Expr
- Eval::Head
- Eval::Rest
- Eval::TOS
- Apply::Expr
- Apply::Stack
- Apply::Operative
- Apply::Applicative
- Define
- Scope::Enter
- Scope::Leave

### ../MXCLs/ts-MXCL

It's small and some stuff is missing, but it has an interesting Context object
which runs a single "thread" and emits events to communicate to a host, which 
is an interesting way to draw that boundary. 

- ERROR
- HALT
- YIELD
- RETURN
- DISCARD
- DEFINE
- EVAL_EXPR
- EVAL_HEAD
- EVAL_ARGS
- APPLY_EXPR
- APPLY_PROC
- APPLY_NATIVE

It had different types of applicative/operative types:

- LAMBDA 
- NATIVE/FEXPR
- NATIVE/LISTOP
- NATIVE/BINOP
- NATIVE/UNOP 
- NATIVE/NULOP


## Slight

### ../p5-slight

lib/

- HOST
    - Halt         
    - Error        
    - Yield        
    - Sleep        
    - Timeout      
    - Fork         
    - Getpid       
    - Waitpid      
    - Send         
    - Recv         
- STEP
    - Just         
    - Drop         
    - Eval::Expr   
    - Eval::Head   
    - Eval::Rest   
    - Apply::Expr  
    - Apply::Call  
    - Bind         
    - Cond         
    - Scope::Enter 
    - Scope::Leave 

### ../p5-slight/t/999-ideas.t

- Eval::Expr
- Apply::Expr
- Eval::Args
- Apply::Call
- Scope::Enter
- Scope::Leave
- Bind
- Cond
- Drop
- Return
- Yield
- Error
- Halt
- Spawn
- Chan::Read
- Chan::Write

### ../ts-slight

- Eval
- EvalInTopLevel
- EvalTOS
- EvalExpr
- EvalHead
- EvalArgs
- Apply
- Fold
- FoldLeft
- FoldRight
- FoldRightK
- Drop
- Return
- Block
- Send
- Disconnect
- Syscall
- Yield
- KillPid
- Halt
- Err
- Define
- Cond
- ScopeExit

### mini-slight (this directory)

- OPCODES
    - NIL
    - LOOKUP   string
    - BUILTIN  string
    - CONST    type value
    - BIND     name value
    - LAMBDA   params body
    - CONS     head tail
    - COND     cond if_true if_false
    - UNOP     operand
    - BINOP    lhs rhs
    - QUOTE    ...args
    - APPLY    f ...args
    - CALL     ...args

- BYTECODE
    - push.NIL
    - push.NUM
    - push.STR
    - push.BOOL
    - lkup.SYM
    - lkup.BIF
    - make.CONS
    - make.LAMBDA
    - call.BINOP
    - call.UNOP
    - call.LAMBDA
    - apply.LAMBDA
    - jump.BY
    - jump.IF_FALSE
    - bind.LAMBDA
    - bind.TERM

### ../wasm-slight

This was a response to mini-slight, thinking about writing it in AS to make it 
easier to compile to WASM. It was the start of the flat design. 

### ./attic/slight.pl

This was a response to AS being annoying and written using a heavily modified
fork of Perl. 

### ../c-slight

After being shown the Perl version and lots of discussion, this was written by 
Fable. However, the WASM requirement kind of made a mess of things. But the base
design could still work in some way. 

### ../slight

This is the new design and vision. 

### To cleanup

- oc-slight 
    - just a bad ocaml sketch, can be tossed
    
- slight-tests
    - old attempt at making a compliance test 
    - was done before the language was really solidified, so very out of date
      
      
<!----------------------------------------------------------------------------->
## Actor Prototypes
<!----------------------------------------------------------------------------->      

- ./attic/ts-tiny-actors.ts
    - this has the signal based monitoring system
    - a more developed Perl version exists in Yakt (if needed)

<!-----------------------------------------------------------------------------> 
### Yakt
<!-----------------------------------------------------------------------------> 

- Lifecycle Signals
    - Started
    - Terminated    
    - Stopping
    - Restarting
    - Stopped

- Mailbox State
    - STARTING
    - ALIVE
    - RUNNING
    - SUSPENDED
    - STOPPING
    - RESTARTING
    - STOPPED

<!-----------------------------------------------------------------------------> 
#### Lifecycle Signals Transitions
<!-----------------------------------------------------------------------------> 

Start state to Alive:
```
    0          -> STARTING
    Started    -> ALIVE
```

If Terminated is received, and there are no children ...
```
    Terminated -> if STOPPING   -> self send Stopped (priority unshift)
    Terminated -> if RESTARTING -> self send Started (priority unshift)
```

Now it can accept signals itself ..

```
    ...     -> ALIVE
    Stopping 
        if children:
            -> STOPPING and stop() children 
        else:
            -> self send Stopped (priority unshift)
    Restarting:
        if children:
            -> RESTARTING and stop() children 
        else:
            -> self send Stopped (priority unshift) 
    Stopped -> STOPPED
        if parent or watchers:
            - send Terminated(pid) to them
               
```

Once done with this, it can process messages.

<!-----------------------------------------------------------------------------> 
#### Mailbox inbox and message queue.
<!-----------------------------------------------------------------------------> 

- RUNNING vs. ALIVE
    - ALIVE means you are waiting for messages
    - RUNNING means you are processing messages

```
    prepare:
        inbox points at message queue
        ALIVE -> RUNNING 
        inbox points at new buffer
        
    finish:
        inbox is flushed to the message queue
        inbox points at message queue again
        RUNNING -> ALIVE
```

#### Supervisor strategy

- Supervisor kinds
    - Restart
    - Resume
    - Retry
    - Stop
    
- Supervisor actions
    - RESUME
    - RETRY
    - HALT

If an actor crashes, it is given to the Supervisor to perform the strategy

- Restart
    - will call restart() in context and return HALT
- Resume
    - returns RESUME
- Retry
    - returns RETRY
- Stop
    - will call stop() in context and return HALT    
    
The actor then needs to handle the actions:

- RETRY
    - put the msg back into the queue and try again
- RESUME
    - move onto the next message
- HALT
    - put the current set of messages back into msg-queue
    - record the error that happened to send via Terminated to parent/watchers

<!----------------------------------------------------------------------------->
Other stuff
<!----------------------------------------------------------------------------->

- STILL TO COLLECT:
    - IOC Functor thing
    - notes on the versioned documents thing
        - might need to compile from Whatsapp and other random places


<!----------------------------------------------------------------------------->






















