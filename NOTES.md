<!----------------------------------------------------------------------------->
# TODO
<!----------------------------------------------------------------------------->

- restore global quota
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

### Bug 1 (crash): joining an already-errored child

(let p (fork (nope)))
(join p)

→ Error: The halted process should have HALT   [raw stack, everything dies]

blockProcess (tests/001-basic.ts:496) asserts the halted blocker has a HALT kont — but since the error-isolation fix, halted also contains ERR processes, so the invariant is simply
false now.

### Bug 2 (wrong answer): child errors after the parent blocked

(let p (fork (do (yield 0) (nope))))
(join p)
→ PID[1] ERRORED: E!DEADLOCKED!

haltProcess (tests/001-basic.ts:515) only wakes waiters when the kont is HALT. An ERR'd child parks in halted without waking anyone, so its joiners strand and get misreported as
deadlocked — the real error (Unable to find nope) is attributed to the wrong process and the wrong cause.

### Options;

These are one decision with two code sites. The options:

- (a) Deliver the ERROR as a value — the joiner receives the child's ERROR term as the join result. Pro: composes with join/collect (one failed child doesn't nuke the batch); ERRORs
are already first-class data in your builtin channel. Con: errors silently launder — the joiner passes the ERROR to +, which re-raises as Must be numbers, duh!, and the original cause
is gone. You'd also want an error? predicate builtin so programs can actually check.
- (b) Propagate the fault — wake each waiter with p.kont = ThrowError(childKont.error, p.kont.kont) so joining a failed process fails the joiner with the child's error. Pro: no
laundering; cascades up join chains naturally; and it's consistent with your deadlock policy, which already faults blocked processes rather than handing them a value. Con:
join/collect can't gather partial results, and there's no way to inspect a failure until you have (try ...).
- (c) Tagged results — join returns ('ok v) / ('err e). Most explicit, but taxes the common case and touches every join site.

I'd do (b) now for consistency with DEADLOCKED!, and layer (a)'s behavior in later as join/catch or via try. Whichever you pick, implement it in both places — the halted branch of
blockProcess and the wake loop of haltProcess. They currently duplicate the resume logic (Return(result, p.kont.kont.env, p.kont.kont)); extracting one resumeWaiter(waiter, blocker)
helper makes it impossible for the two paths to disagree, which is exactly how these two bugs got out of sync in the first place.

### Smaller findings

- Dead/misleading branch in blockProcess (tests/001-basic.ts:500): the next.type == 'HALT' check on the blockee can never be true — a process only reaches blockProcess from run's
BLOCK case, so its kont is always BLOCK. And if it somehow were HALT, overwriting its result with the blocker's result would be wrong anyway. Same for the != 'HALT' && != 'ERR' waiter
guard in haltProcess — blocked processes always hold BLOCK konts. I'd replace both with if (kont.type != 'BLOCK') throw invariant checks; a guard that silently skips is where the
next Bug-2-style misreport hides.
- fork silently drops extra body exprs: (fork (a) (b)) runs only (a). spawnProcess already takes TERM[], so this.spawnProcess(uncons(tail), ...) gives you implicit-do semantics for
free — that also matches how the root process is spawned.
- Kont mutation (kont.result = returned, kont.pid = returned in the YIELD/HALT/BLOCK cases): fine while continuations are single-shot and freshly allocated, same caveat as the old
EvalArgs.done — worth a NOTE comment so future-you doesn't reuse a kont.
- Still open from the TODO (unchanged, just confirming): no global quota, env sharing, parser items.

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

