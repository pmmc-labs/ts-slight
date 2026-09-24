<!----------------------------------------------------------------------------->
# Slight Language
<!----------------------------------------------------------------------------->

Slight is an s-expression based language of the LISP family, but with a 
minimal syntax.

<!----------------------------------------------------------------------------->
## Terms
<!----------------------------------------------------------------------------->

All terms are immutable. 

### Booleans

Booleans are represeted by the `#true` and `#false` constants. 

### Numbers

Numbers can be either integers or floats.

### Strings

Strings are utf8. 

### Symbols

Symbols are internally managed opaque values. 

### Lists

Lists are basic cons lists, with `()` representing the Nil constant. 

### Functions

Functions are `lambda` defintions. 

### ProcessID

Opaque objects around a numeric process ID.

<!----------------------------------------------------------------------------->
## Operators
<!----------------------------------------------------------------------------->

### Comparison

These are all binary operators.

- `eq?`
- `ne?`
- `gt?`
- `ge?`
- `lt?`
- `le?`

### Logical

These are all binary operators, except `not` which is unary.

The `and` and `or` are short circuiting, while `and?` and `or?` are not. 

- `and` and `and?`
- `or`  and `or?`
- `not`

### Math Operators

These operations are binary ops and only applicable to numbers.

- `+`
- `-` 
- `*` 
- `/` 
- `%` 

<!----------------------------------------------------------------------------->
## Builtins
<!----------------------------------------------------------------------------->

### Lists

The list predicates:

- `nil?  <term>`
- `cons? <term>`
    
The list constructors:

- `list <term>, ...<term>`
- `cons <term>, <list|nil>`

The list accessor functions:

- `car`
- `cdr`
- `cadr`
- `cddr`
- `caddr`
- `cdddr`

### Definitions

- `defun <name> <params> <body>`
- `let <name> <value>`

### Construction

- `lambda <params> <body>`

### Conditionals

- `if <cond> <if-true> <if-false>`
- `when <cond> <if-true>`
- `case <topic> (<term> <body>) ... (<term> <body>)`
- `cond (<cond> <body>) ... (<cond> <body>)`

### Iteration

Optimized operations on lists, to build other list functions on top of. 

- `fold/l <init> <lambda[acc,n]>`
- `fold/r <init> <lambda[acc,n]> `

### Misc.

- `apply <lambda|sym> <list>`
- `do <expr> ... <expr>` 
- `raise <term>` 
- `quote <term> ... <term>`

<!----------------------------------------------------------------------------->
## Processes
<!----------------------------------------------------------------------------->

Processes are a fuel driven preemptive concurrency mechanism that drives the 
actor system.  

- quota system
    - two parts:
        - fuel, which is how many ticks it gets before being preempted
        - refills, which is how many times it the fuel can be refilled
            - inf, which means just run dont ask
            - n, keep it metered
            - 0, this is basically a killed process


### Process control

- `$$` is the current process ID
- `^$$` is the current parent process ID
- `pid?` returns true if it is a process ID
    
- `fork <lambda>` 
    - spawns a new process, returns a PID, then runs `<lambda>` in the process

- `yield <expr>` 
    - evalutes the `<expr>` and then yields control of the current process.
        - XXX: is this confusing to have `<expr>` involved at all?
    
- `join <pid>`
    - blocking wait for the `<pid>` to exit, then return the last value of the process
        
- `kill <pid>`
    - kills a given pid
 
### Message Passing

- `msg <tag> ...<term>`
    - A message constructor, discriminated by tag

- `send <pid> <msg>`
    - Send a message to a pid, returns immediately with nil

- `recv`
    - nullary function that blocks until a message is available and returns it

### Stream Subscriptioons

- `connect <sym> <pid>`
    - connects a pid to an event stream or outside resource
    
- `disconnect <pid>`
    - disconnects the pid from an event stream or outside resource

<!----------------------------------------------------------------------------->
## Special Forms 
<!----------------------------------------------------------------------------->

The following are special forms and so need handling in the parser. 

- `quote`
- `lambda`
- `defun`
- `let`

The conditionals are special but can be implemented as transforms or 
expansions of either `if` or `cond`

- `if`
- `when`
- `case`
- `cond`

The short circuit logic ops can be implemented in terms of conditionals
or the conditionals could be implemented in terms of them. 

- `and`
- `or` 

<!----------------------------------------------------------------------------->
# Current set of TS Slight Builtins
<!----------------------------------------------------------------------------->

- #true #false
- and or not

- do if when case cond

- raise 
- quote
- lambda
- gensym 

- fold/l fold/r 

- let defun

- yield fork join kill $$

- connect disconnect

- send recv

- syscall
    - sleep localtime
    - slurp spew

- slight/parse slight/eval slight/eval-in-top-level

- apply
- dotimes

## Eq & Ord

- == != 
- eq? ne?
- <= < >= > 
- true? false?

## Type predicates

- nil? cons? sym? str? num? bool? lambda? builtin?
- list? atom? literal? callable? 
- type-of

## Lists

- list
- cons car cdr cadr  cddr  caddr cadddr cddddr

- length
- reverse append concat-list
- sum product
- map grep filter
- skip take nth
- find member?
- range 

- assoc 
- lookup 

## Numbers

- constants: PI
- binops: +  -  *  /  % 
- inc dec 
- max min hex pow  abs  cos  sin  exp  tan  ceil sqrt floor  round  trunc 
- rand 
- format-num 

## Strings

- constants: \n \r \t \e
- binop: ~
- uc lc
- substring 
- concat 

- index-of 
- last-index-of 
- starts-with 
- ends-with 
- pad-end 
- pad-start

- str-join 
- str-splice-at 
- str-split-at  
- str-repeat 
- str-split 
- str-len 

## TTY

- tty/screen/rows
- tty/screen/cols
- tty/write

## Benchmarking

- time-it
- time-it/end

## TODO

- ast->str 

## To deprecate 

- sys/io/print-ln
- poke
- ansi/hide-cursor
- ansi/show-cursor
- head 
- tail 
- pprint 




