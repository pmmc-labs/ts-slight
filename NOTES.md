
# Concurrency Mechanisms

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
