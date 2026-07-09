<!----------------------------------------------------------------------------->
# TODO
<!----------------------------------------------------------------------------->

- make (defun) only programs not crash
- restore global quota
- catch ERRs before they go too far
    - check for them in RETURN?
- make (if) stricter on the Bool test
    - should break for non Bools?
- add eq? case for Env 
    - use === for comparing lambdas (this is what Scheme does)
- make EvalArgs copy the done array, not mutate it

- Error sites to fix
    - User-program errors 
        (defun validation in run, parse errors): these should become ERRORs, 
        but note they happen before any process exists, so there's no process 
        to fault. 
        Cleanest: treat the defun scan as a "compile" phase that returns 
        ERROR[], and report those alongside halted. Converting them to a 
        synthetic ERR'd process also works but is a bit dishonest about when
        the failure happened.
    - Scheduler invariant violations 
        (yieldProcess on non-YIELD, unblockProcess on missing pid, pprint 
        default): keep these as throws. 
        They indicate bugs in the interpreter, not the program, so surfacing 
        them loudly is a feature.
    - Safety net
        wrap the this.step(...) call in run in try/catch and convert an 
        escaping JS exception into an ERR'd process. 
        - Pro: one buggy builtin or edge case (like bug 1 above) can no
        longer kill the strand. 
        - Con: it can mask interpreter bugs — mitigate by tagging these 
        as INTERNAL ERROR and re-throwing (or printing the stack) 
        when DEBUG is on.

<!----------------------------------------------------------------------------->
## Claude NOTES   
<!----------------------------------------------------------------------------->

### Deadlock handling 

When running empties with blocked non-empty, three options: 
    (a) throw — simplest, but loses all completed results; 
    (b) return { halted, blocked } and let the caller report shape; 
    (c) inject a fault: 
        - set each blocked process's kont to ThrowError(raise('DEADLOCK'), ...) 
        - re-enqueue them
        - and they drain through the normal ERR path 
        — and once join exists
            - faulting a blocked process wakes its waiters, 
            - so deadlock cycles unwind themselves. 
        
I'd do (c) for the mechanism plus (b) for the return shape. One structural note 
for join itself: blocked is keyed by the blocked process's pid, but joins wake 
by target pid — you'll want a reverse index (Map<targetPid, waiters[]>) or a 
waiting_on field on Process, plus pid-keyed lookup into halted. Also decide 
what joining an ERR'd child returns: the ERROR as a value (joiner decides), or 
propagate the fault to the joiner. The former composes better with join/collect.
    
### Resume-with-value — build it once, use it three times. 

Right now (yield expr) evaluates expr after resuming, because Yield wraps 
the un-evaluated EvalExpr. You could document that as thunk-like semantics, 
but consider the alternative: 

    - a suspended process is always resumed by setting 
        `proc.kont = Return(resume_value, env, saved_kont)`. 

That one mechanism gives you 
    (a) (yield v) that evaluates v first and can hand it to the scheduler
    (b) join delivering the child's results to the woken joiner
    (c) recv delivering a message
    
all identical at the scheduler level. 

Tradeoff: 
slightly more machinery now (Yield needs to carry/receive a value slot), but 
you're about to need it for join regardless, so building yield on it first is 
a low-stakes rehearsal.

### Env sharing. Since you've confirmed the leak is "parent binds after fork, child sees it," the options:

- (a) Snapshot at fork 
    — copy each frame's Map down the chain. True isolation, but O(all bindings) 
    per fork and it copies the global/defun frame pointlessly.
- (b) Copy-on-write via frame sealing 
    — at fork, give the child newEnv(env) (already done) and also replace the 
    parent's current env with newEnv(env). Since DEFINE only ever writes to
    the innermost frame, the shared frames below are never written again; both 
    sides keep reading the shared globals/defuns for free. O(1) per fork. 
    - Tradeoff: 
        a post-fork let of an already-bound name shadows rather than updates 
        — only observable if you later add set!, at which point you'd revisit.
- (c) Fully persistent envs (bind returns a new Env). 
    - Cleanest semantics and forks become trivially safe, but it's a real 
    refactor: every DEFINE must thread the new env through the continuation 
    frames, and defun mutual recursion needs letrec-style backpatching.

I'd do (b) now — it's nearly free — and keep (c) in your pocket for if/when 
mutation or set! enters the language.

### Parser

- Floats truncated (3.14 → 3): 
    - the parseInt branch shadows parseFloat. 
    - Fix: test with /^-?\d+(\.\d+)?$/ then use parseFloat, or just 
      Number(token) with an isNaN check (note Number also accepts 
      hex/scientific — decide if you want that).
- '(...) steals the parent's ): 
    - quote frames are never explicitly closed for lists. 
    - Fix within the current design: mark quote frames, and after any completed 
    expression is pushed into the top frame, loop: while the top frame is a quote 
    frame with 2 elements, pop-and-reduce it into the frame below. That also replaces 
    the token-splicing hack for atoms. Longer-term, a small recursive-descent reader 
    is cleaner and gives you real unbalanced-paren errors — right now the 
    end-of-input drain loop silently "fixes" unclosed parens, which will make parser 
    bugs invisible.

- Strings keep their quotes (""hello""): 
    - str(token.slice(1, -1)).
- Bare top-level atom crashes (stack.at(-1)! on empty stack): 
    - route to done when the stack is empty.
- No comments: 
    — add ;[^\n]* to the lexer and filter the matches, cheapest possible fix.

### Cosmetic

- SCOPE_EXIT produces a Return that then costs an extra identity kontinue at 
the top of step's loop (every lambda return burns one no-op step), and each 
HALT still gets kontinue'd twice. Harmless, just noise in the step counts 
and DEBUG traces.

Bottom line: 
the scheduler core is now in good shape for join — the pieces I'd do before 
writing it are 

- the resume-with-value mechanism (it's join's delivery channel)
- the waiters/halted indexing
- the deadlock policy

... in that order. The error-channel unification (3) is the biggest remaining 
semantic decision; everything else is incremental.

<!----------------------------------------------------------------------------->
# Concurrency Mechanism Notes
<!----------------------------------------------------------------------------->

This file contains some sketchs for various concurrency mechanisms for this
system. 

## Fork/Join

Not exactly the fork/join model from Java (with work stealing pools, etc) but 
a combination of the fork and join keywords.

NOTE: These are not OS processes, but coroutine processes instead. 

A `fork` call will return a PID (as a `Num` (for now)) and will yield the 
calling process and immediately start the new process. 

Calling `join` on a PID causes the calling process to block until the process 
associated with the PID completes, where it will return any results it has 
to the caller.

Functions like `join/collect` can be used to wait on a list of processes and
returns them as a list. (Similar to the `collect` pattern with JS promises).

```
; do it all at once, like perl `...`
(let result (join (fork (...))))

; fork, then join ...
(let pid (fork (...))))
; ... some code 
(let result (join pid))

; collect multiple forks
(defun downloader (urls) 
    (map (lambda (url) (fork (net/http-fetch url))) urls))
    
(let downloads (join/collect (downloader *MY-URLS*)))

```

This is very limiting, so it probably makes sense to add some sort of 
communication machinery to communicate between the forked processes, but 
not going to a full on Actor model. 

Here are some thoughts ...

### Channels

Channels can act like pipes between processes, nothing too fancy here. But 
do I actually need this abstraction along with actors??

### IVars & MVars

Recently read a book on Concurrent ML and got introduced to these two 
synronization primatives, which are interesting, but maybe not appropriate??


## Pub/Sub

A Producer/Consumer mutually recursive loop, but here modeled as message 
passing actors.

```
; Q is a queue of items to publish
; S is a queue of subsribers to publish to 

(defun producer-actor (Q S) 
    ; the loop function will loop forever
    ; and `exit` function is passed as an arg  
    (loop (exit)
        ; blocks until it gets a message, then 
        ; pattern matches on it
        (recv (msg)
            ; messages are quoted symbols, 
            ; followed by a payload
            ('SUBMIT    i) (do 
                (q/enqueue i Q)
                (if (q/empty? S) () 
                    (send $$ 'PUBLISH))) ;; $$ is the local PID
            ('SUBSCRIBE $) (do 
                ; $ is the subscriber PID passed to us
                (q/enqueue $ S)        
                (if (q/empty? Q) () 
                    (send $$ 'PUBLISH))) 
            ; PUBLISH is used internally to trigger 
            ; the draining of the published item Q
            ('PUBLISH) 
                ; the q/drain function empties the queue 
                ; so this will publish each item to each 
                ; subscriber (multicast) 
                (map (lambda (i) (map (lambda (s) (send s 'ITEM i)) S)) (q/drain Q))
            ('SHUTDOWN) (do 
                ; use q/drain here to empty the subscriber queue
                ; and send DONE to everyone
                (map (lambda (s) (send s 'DONE)) (q/drain S)))
                (exit))))
        
(defun consumer-actor (producer) 
    (do
        ; code before the (loop) call is 
        ; basically actor intialization
        (send producer 'SUBSCRIBE $$)
        (loop (exit)
            (recv (msg)
                ('ITEM i) (say (~ "got " i))
                ('DONE) (do
                    (say "DONE!")
                    (exit))))))
```

## Actor Model 

Here is a slightly different take on the actor model shown above, with some 
ergonomic improvements. Basically removing the `(loop (exit) ...)` mechanics 
and letting `recv` do that work, and having a builtin `exit` that does the 
right thing. 

This also demonstrates the `schedule/send` idea, which delays the send call. 

Additionally the [] are used in the pattern matching for readability (like in 
Scheme).

```

(actor Ping ()
    (do
        ; same as above, this is basically the 
        ; actor init code here, only run when 
        ; it is spawned ...
        (let $pong (spawn Pong))
        (send $pong 'PING $$))
        ; and them recv does the work loop did ...
        (recv (msg)
            [ 'PING $ ] (schedule/send ($ 'PONG $$) :after 0.5s)
            [ 'STOP   ] (do
                (send $pong 'STOP)
                (exit)))))

(actor Pong ()
    (recv (msg)
        [ 'PONG $ ] (schedule/send ($ 'PING $$) :after 0.5s)
        [ 'STOP   ] (exit)))

(let $ping (spawn Ping))
(send $ping 'START)

(schedule/send $ping 'STOP :after 10s)

```

<!----------------------------------------------------------------------------->

