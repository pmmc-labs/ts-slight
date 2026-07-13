<!----------------------------------------------------------------------------->
# TODO
<!----------------------------------------------------------------------------->

- restore global quota

<!----------------------------------------------------------------------------->
## Performance / Porting decisions (2026-07-09)
<!----------------------------------------------------------------------------->

Measured: ~30M kontinue-steps/sec (fib 27 = 24.15M steps in ~0.83s).
GC is ~5% of runtime (1000 scavenges @ 0.045ms avg, one major GC) —
allocation churn is a non-issue in V8, do NOT pool/reuse kont frames
(same verdict as the Perl version, different mechanism: bump-pointer
nursery makes short-lived frames nearly free; pooling would promote
them to old space and defeat the scavenger).

Real costs, in order: (1) `new Map` per lambda call + string hashing
per lookup, (2) re-traversing syntax cons cells every evaluation
(uncons per `if` per iteration), (3) megamorphic kont property access.

DECIDED: no call/cc ambitions — continuations commit to stack-shaped.
The kont chain is only ever used as a stack (ScopeExit collapse = pop),
so it can become a per-process frame stack (array/Vec) when porting.

Plan of record: land actors first, let the special-form set settle,
THEN do a lower/compile pass (special forms dispatched at compile time,
variables resolved to (depth, slot) so envs become plain arrays) as the
first step of the compiled-language port. The lowered IR is the thing
that gets ported; the TS version is the executable spec.

Porting landmine: defun creates env<->lambda reference cycles by design
(the lambda closes over the env that contains it). A refcounting port
(Rc, Perl-style) leaks these — needs weak parent links, an arena per
Strand, or a real GC for the term heap.
- catch ERRs before they go too far
    - check for them in RETURN?

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

### Smaller findings

- Kont mutation (kont.result = returned, kont.pid = returned in the YIELD/HALT/BLOCK cases): fine while continuations are single-shot and freshly allocated, same caveat as the old
EvalArgs.done — worth a NOTE comment so future-you doesn't reuse a kont.
- Still open from the TODO (unchanged, just confirming): no global quota, env sharing.

### Env sharing. Since you've confirmed the leak is "parent binds after fork, child sees it," the options:

RESOLVED 2026-07-13: rib envs + snapshotEnv at fork (structural sharing,
O(1)) — see docs/superpowers/specs/2026-07-13-env-refactor-design.md.
Remaining known hole: a lambda created pre-fork and invoked in the child
reads the parent's live frame (fixing that needs persistent envs).

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

### Cosmetic

- SCOPE_EXIT produces a Return that then costs an extra identity kontinue at 
the top of step's loop (every lambda return burns one no-op step), and each 
HALT still gets kontinue'd twice. Harmless, just noise in the step counts 
and DEBUG traces.

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

