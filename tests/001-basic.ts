
import { DEBUG } from '../src/debug.ts';
import { newEnv, pprint } from '../src/terms.ts';
import { parse } from '../src/parser.ts';
import { initalizeEnv } from '../src/builtins.ts';
import { Strand } from '../src/strand.ts';

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
