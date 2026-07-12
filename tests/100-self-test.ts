import { prove } from '../src/index.ts';

prove(`

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

    (defun length-iter (lst count)
        (if (nil? lst) count
            (length-iter (tail lst) (+ count 1))))

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


(run-tests (list
    (diag "Testing the tester")

    (ok #true "... got true")
    (ok (not #false) "... got true??")
    (ok 10 "... 10 is a true value")
    (ok (not ()) "... () is not a true value")

    (is 10 10 "... 10 is the same as 10")
    (is 10 (* 2 5) "... 10 is the same as (* 2 5)")

    (diag "Number tests")

    (ok (== (+ 2 2) 4) "... + seems to work")
    (ok (== (- 4 2) 2) "... - seems to work")
    (ok (== (* 4 2) 8) "... * seems to work")
    (ok (== (/ 6 2) 3) "... / seems to work")
    (ok (== (% 10 7) 3) "... % seems to work")

    (is (+ 1.5 1.5) 3   "... 1.5 + 1.5 == 3")
    (is (+ 1.5 1.7) 3.2 "... 1.5 + 1.7 == 3.2")
    (is (* 2.5   2) 5   "... 2.5 * 2 == 5")
    (is (* 2.5 0.2) 0.5 "... 2.5 * 0.2 == 0.5")
    (is (- 4.5   2) 2.5 "... 4.5 - 2 == 2.5")
    (is (/ 4   0.5) 8   "... 4 / 0.5 == 8")

    (diag "basic number comparisons")
    (ok (<  1    2 ) "... one is less than two")
    (ok (<= 1    2 ) "... one is less than or equal two")
    (ok (<= 1    1 ) "... one is less than or equal one")
    (ok (>  10   2 ) "... ten is greater than two")
    (ok (>= 10   2 ) "... ten is greater than or equal two")
    (ok (>= 10   10) "... ten is greater than or equal ten")

    (diag "Addition tests")
    (is (+ 1 2)     3       "... 1 + 2 = 3")
    (is (+ 10 20)   30      "... 10 + 20 = 30")
    (is (+ 1.5 2.5) 4       "... 1.5 + 2.5 = 4")
    (is (+ -5 10)   5       "... -5 + 10 = 5")
    (is (+ -5 -3)   -8      "... -5 + -3 = -8")
    (is (+ 0 0)     0       "... 0 + 0 = 0")

    (diag "Subtraction tests")
    (is (- 5 3)     2       "... 5 - 3 = 2")
    (is (- 3 5)     -2      "... 3 - 5 = -2")
    (is (- 10.5 0.5) 10     "... 10.5 - 0.5 = 10")
    (is (- 0 5)     -5      "... 0 - 5 = -5")
    (is (- -3 -5)   2       "... -3 - -5 = 2")


    (diag "Multiplication tests")
    (is (* 3 4)     12      "... 3 * 4 = 12")
    (is (* 2.5 4)   10      "... 2.5 * 4 = 10")
    (is (* -3 4)    -12     "... -3 * 4 = -12")
    (is (* -3 -4)   12      "... -3 * -4 = 12")
    (is (* 5 0)     0       "... 5 * 0 = 0")


    (diag "Division tests")
    (is (/ 10 2)    5       "... 10 / 2 = 5")
    (is (/ 7 2)     3.5     "... 7 / 2 = 3.5")
    (is (/ 1 4)     0.25    "... 1 / 4 = 0.25")
    (is (/ -10 2)   -5      "... -10 / 2 = -5")
    (is (/ 0 5)     0       "... 0 / 5 = 0")

    (diag "Modulo tests")
    (is (% 10 3)    1       "... 10 % 3 = 1")
    (is (% 15 5)    0       "... 15 % 5 = 0")
    (is (% 7 4)     3       "... 7 % 4 = 3")
    (is (% 10 10)   0       "... 10 % 10 = 0")

    (diag "Nested arithmetic tests")
    (is (+ 1 (* 2 3))               7   "... 1 + (2 * 3) = 7")
    (is (* (+ 1 2) (+ 3 4))         21  "... (1+2) * (3+4) = 21")
    (is (- (* 10 10) (+ 50 50))     0   "... (10*10) - (50+50) = 0")
    (is (/ (+ 10 20) (- 10 5))      6   "... (10+20) / (10-5) = 6")
    (is (* 2 (- 20 5))              30  "... 2 * (20-5) = 30")
    (is (* 2 (- (* 10 2) 5))        30  "... 2 * ((10*2)-5) = 30")
    (is (* (- 3.2 1.2) (- (* 10 2) 5)) 30 "... (3.2-1.2) * ((10*2)-5) = 30")

    (diag "Equality (==) tests")
    (ok (== 1 1)            "... 1 == 1")
    (ok (== 0 0)            "... 0 == 0")
    (ok (== -5 -5)          "... -5 == -5")
    (ok (== 3.14 3.14)      "... 3.14 == 3.14")
    (ok (not (== 1 2))      "... 1 != 2")
    (ok (== 1 1.0)          "... 1 == 1.0 (numeric equality)")

    (diag "Inequality (!=) tests")
    (ok (!= 1 2)            "... 1 != 2")
    (ok (!= 0 1)            "... 0 != 1")
    (ok (!= -1 1)           "... -1 != 1")
    (ok (not (!= 5 5))      "... not (5 != 5)")

    (diag "Less than (<) tests")
    (ok (< 1 2)             "... 1 < 2")
    (ok (< -5 0)            "... -5 < 0")
    (ok (< 0 0.1)           "... 0 < 0.1")
    (ok (not (< 2 1))       "... not (2 < 1)")
    (ok (not (< 1 1))       "... not (1 < 1)")

    (diag "Less than or equal (<=) tests")
    (ok (<= 1 2)            "... 1 <= 2")
    (ok (<= 1 1)            "... 1 <= 1")
    (ok (<= -1 0)           "... -1 <= 0")
    (ok (not (<= 2 1))      "... not (2 <= 1)")

    (diag "Greater than (>) tests")
    (ok (> 2 1)             "... 2 > 1")
    (ok (> 0 -5)            "... 0 > -5")
    (ok (> 0.1 0)           "... 0.1 > 0")
    (ok (not (> 1 2))       "... not (1 > 2)")
    (ok (not (> 1 1))       "... not (1 > 1)")

    (diag "Greater than or equal (>=) tests")
    (ok (>= 2 1)            "... 2 >= 1")
    (ok (>= 1 1)            "... 1 >= 1")
    (ok (>= 0 -1)           "... 0 >= -1")
    (ok (not (>= 1 2))      "... not (1 >= 2)")

    (diag "String Tests")
    (ok (== (~ "hello " "world") "hello world") "... ~ seems to work")
    (is (~ "hello" " world")    "hello world"   "... concatenate two strings")
    (is (~ "foo" "bar")         "foobar"        "... concatenate without space")
    (is (~ "" "test")           "test"          "... concatenate with empty string")
    (is (~ "test" "")           "test"          "... concatenate to empty string")
    (is (~ "" "")               ""              "... concatenate two empty strings")
    (is (~ "a" (~ "b" "c"))     "abc"           "... nested concatenation")

    (diag "char comparisons")
    (ok (<  "a" "b") "... a is less than b")
    (ok (<= "a" "b") "... a is less than or equal b")
    (ok (<= "a" "a") "... a is less than or equal a")
    (ok (>  "b" "a") "... b is greater than a")
    (ok (>= "b" "a") "... b is greater than  or equal a")
    (ok (>= "b" "b") "... b is greater than  or equal b")

    (diag "String equality (eq) tests")
    (ok (== "hello" "hello")        "... 'hello' eq 'hello'")
    (ok (== "" "")                  "... '' eq ''")
    (ok (not (== "hello" "world"))  "... not ('hello' eq 'world')")
    (ok (not (== "Hello" "hello"))  "... case sensitive: 'Hello' ne 'hello'")

    (diag "String inequality (ne) tests")
    (ok (!= "hello" "world")        "... 'hello' ne 'world'")
    (ok (!= "a" "b")                "... 'a' ne 'b'")
    (ok (not (!= "test" "test"))    "... not ('test' ne 'test')")

    (diag "String less than (lt) tests")
    (ok (< "a" "b")                "... 'a' lt 'b'")
    (ok (< "abc" "abd")            "... 'abc' lt 'abd'")
    (ok (< "A" "a")                "... 'A' lt 'a' (ASCII order)")
    (ok (not (< "b" "a"))          "... not ('b' lt 'a')")
    (ok (not (< "a" "a"))          "... not ('a' lt 'a')")

    (diag "String less than or equal (le) tests")
    (ok (<= "a" "b")                "... 'a' le 'b'")
    (ok (<= "a" "a")                "... 'a' le 'a'")
    (ok (not (<= "b" "a"))          "... not ('b' le 'a')")

    (diag "String greater than (gt) tests")
    (ok (> "b" "a")                "... 'b' gt 'a'")
    (ok (> "abd" "abc")            "... 'abd' gt 'abc'")
    (ok (> "a" "A")                "... 'a' gt 'A' (ASCII order)")
    (ok (not (> "a" "b"))          "... not ('a' gt 'b')")
    (ok (not (> "a" "a"))          "... not ('a' gt 'a')")

    (diag "String greater than or equal (ge) tests")
    (ok (>= "b" "a")                "... 'b' ge 'a'")
    (ok (>= "a" "a")                "... 'a' ge 'a'")
    (ok (not (>= "a" "b"))          "... not ('a' ge 'b')")

    (diag "not operator tests")
    (ok (not #false)             "... not false = true")
    (ok (not (not #true))        "... not not true = true")
    (ok (not ())                "... not nil = true")
    (ok (not (not 1))           "... not not 1 = true")
    (ok (not (not "hello"))     "... not not 'hello' = true")

    (diag "and operator tests")
    (ok (and #true #true)         "... true and true = true")
    (ok (not (and #true  #false)) "... true and false = false")
    (ok (not (and #false #true))  "... false and true = false")
    (ok (not (and #false #false)) "... false and false = false")

    (diag "and short-circuit evaluation")
    (is (and #false 42)     #false   "... false and 42 returns false (short-circuit)")
    (is (and #true 42)      42      "... true and 42 returns 42")
    (is (and 1 2)           2       "... 1 and 2 returns 2")
    (is (and 0 2)           0       "... 0 and 2 returns 0 (short-circuit)")

    (diag "or operator tests")
    (ok (or #true #true)          "... true or true = true")
    (ok (or #true #false)         "... true or false = true")
    (ok (or #false #true)         "... false or true = true")
    (ok (not (or #false #false))  "... false or false = false")

    (diag "or short-circuit evaluation")
    (is (or #true 42)       #true   "... true or 42 returns true (short-circuit)")
    (is (or #false 42)      42      "... false or 42 returns 42")
    (is (or 1 2)            1       "... 1 or 2 returns 1 (short-circuit)")
    (is (or 0 2)            2       "... 0 or 2 returns 2")
    (is (or () "default")   "default" "... nil or 'default' returns 'default'")

    (diag "Combined logical operations")
    (ok (and (or #true #false) #true)  "... (true or false) and true = true")
    (ok (or (and #false #true) #true)  "... (false and true) or true = true")
    (ok (not (and (not #true) #true)) "... not ((not true) and true) = true")

    (ok ((lambda () #true)) "... lambdas work")
    (ok ((lambda (x) x) #true) "... lambdas w/ arg work")
    (ok ((lambda (x y) (eq? x y)) 10 10) "... lambdas w/ 2 args work")

    (diag "test control structures ...")

    (diag "if with boolean conditions")
    (is (if #true 1 2)       1       "... if true returns then-branch")
    (is (if #false 1 2)      2       "... if false returns else-branch")

    (diag "if with computed conditions")
    (is (if (> 5 3) "bigger" "smaller") "bigger" "... 5 > 3")
    (is (if (< 5 3) "bigger" "smaller") "smaller" "... not 5 < 3")
    (is (if (== 2 2) "equal" "different") "equal" "... 2 == 2")

    (diag "if with expressions in branches")
    (is (if #true (+ 1 2) (+ 3 4))   3   "... evaluates then-expr")
    (is (if #false (+ 1 2) (+ 3 4))  7   "... evaluates else-expr")

    (diag "Nested if expressions")
    (is (if #true (if #true 1 2) 3)   1   "... nested if, both true")
    (is (if #true (if #false 1 2) 3)  2   "... nested if, outer true inner false")
    (is (if #false 1 (if #true 2 3))  2   "... nested in else branch")

    (diag "when with boolean conditions")
    (is (when #true 1 )      1       "... if true returns then-branch")
    (is (when #false 1)      ()      "... if false returns nil")

    (diag "Nested when expressions")
    (is (when #true (when #true  1))   1   "... nested if, both true")
    (is (when #true (when #false 1))   ()   "... nested if, outer true inner false")
    (is (when #false 1 (when #true 3)) ()   "... nested in else branch")

    (diag "do block tests")
    (is (do 1 2 3)                  3   "... do returns last value")
    (is (do (+ 1 1) (+ 2 2) (+ 3 3)) 6  "... do evaluates all, returns last")

    (diag "user defined function")

    (is (fib  6)                8 "... fib(6) = 8")
    (is (fact 6)              720 "... fact(6) = 720")
    (is (fact (fib 6))      40320 "... this should pass")
    (is (length (list 1 2 3))   3 "... length(1 2 3) = 3")

    (ok (even? 10) "... this should pass")
    (ok (not (odd? 10)) "... this should pass")

    (is 5 (length (list 1 2 3 4 5)) "... this should pass")
    (is 5 (length-iter (list 1 2 3 4 5) 0) "... this should pass")
    (is 0 (tail-call-demo 10) "... this should pass")

    (diag "misc 30 tests")
    (is (* 2 (- 20 5))                 30 "... * 2 (20 - 5) == 30")
    (is (* 2 (- (* 10 2) 5))           30 "... * 2 ((10 * 2) - 5) == 30")
    (is (* (- 3.2 1.2) (- (* 10 2) 5)) 30 "... (3.2 - 1.2) * ((10 * 2) - 5) == 30")
    (is 30 (+ 10 20) "... these are all 30")
    (is 30 (+ 10.5 19.5) "... these are all 30")
    (is 30 (+ (* 2 5) 20) "... these are all 30")
    (is 30 (+ 10 (* 4 5)) "... these are all 30")
    (is 30 (+ (* 2 5) (* 4 5)) "... these are all 30")
    (is 30 (+ (* 2 (- 9 4)) (* 4 5)) "... these are all 30")
    (is 30 (+ (* 2 (- 9 4)) (* 4 (+ 4 1))) "... these are all 30")
    (is 30 thirty "... these are all 30")
    (is 30 thur-tee "... these are all 30")
    (is 30 (get-thirty) "... these are all 30")
    (is 30 (adder 10 20) "... these are all 30")
    (is 30 (adder (double 5) 20) "... these are all 30")
    (is 30 (adder 10 (* (double 2) 5)) "... these are all 30")
    (is 30 (adder (fib 6) 22) "... these are all 30")
    (is 30 (adder (fib 8) (+ 1 (double 4))) "... these are all 30")
    (is 30 (- (fact 6) (+ (* (fact 3) 100) 90)) "... these are all 30")
    (is 30 ((lambda (n m) (+ n m)) 10 20) "... these are all 30")
    (is 30 ((lambda (f n m) (f n m)) adder 10 20) "... these are all 30")
    (is 30 (+ (length (list 0 1 2 3 4 5 6 7 8 9)) 20) "... these are all 30")
    (is 30 (length (range 1 30)) "... these are all 30")
    (is 30 (+ (length (range 1 10)) (length (range 1 (* 4 5)))) "... these are all 30")
    (is 30 (+ (product (list 2 1 5)) (sum (list 2 4 6 8))) "... these are all 30")
    (is 30 (sum (list 4 (fib 8) (- (fact 3) 1))) "... these are all 30")
    (is 30 (+ (sum (range 0 (fib 6))) (- 2 8)) "... these are all 30")
    (is 30 (sum (grep (lambda (x) (>= x 10)) (list 0 2 10 4 7 20 3 1))) "... these are all 30")
    (is 30 (sum (map (lambda (x) (if (<= x 20) x 0)) (list 100 25 10 411 75 20 35 1000))) "... these are all 30")
    (is 30 (if (even? (* 2 5)) (+ (* 2 5) 20) -1) "... these are all 30")
    (is 30 (if (even? (* 3 5)) -1 (if (odd? (* 3 5)) 30 -1)) "... these are all 30")
    (is 30 ((make-adder 10) 20) "... these are all 30")
    (is 30 ((make-adder 20) 10) "... these are all 30")
    (is 30 (join (fork (+ 10 20))) "... these are all 30")
    (is 30 (join (fork (+ (yield 10) (yield 20)))) "... these are all 30")
    (is 30 (join pid) "... these are all 30")
    (is 30 (- (join (fact-fork 6)) (+ (* (join (fact-fork 3)) 100) 90))     "... these are all 30")
))

`).catch((e) => {
    console.error(String(e));
    process.exit(1);
});
