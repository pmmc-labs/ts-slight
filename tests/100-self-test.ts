import { prove } from '../src/index.ts';

prove(`

(run-tests (list
    (ok #true "... got true")
    (ok (not #false) "... got true??")
    (ok 10 "... 10 is a true value")
    (ok (not ()) "... () is not a true value")

    (ok (== (+ 2 2) 4) "... + seems to work")
    (ok (== (- 4 2) 2) "... - seems to work")
    (ok (== (* 4 2) 8) "... * seems to work")
    (ok (== (/ 6 2) 3) "... / seems to work")
    (ok (== (% 10 7) 3) "... % seems to work")

    (ok (== (~ "hello " "world") "hello world") "... ~ seems to work")

    (ok ((lambda () #true)) "... lambdas work")
    (ok ((lambda (x) x) #true) "... lambdas w/ arg work")
    (ok ((lambda (x y) (eq? x y)) 10 10) "... lambdas w/ 2 args work")

))

`).catch((e) => {
    console.error(String(e));
    process.exit(1);
});
