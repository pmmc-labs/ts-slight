import { prove } from '../src/index.ts';

prove(`

    ;; fork isolation: a parent (let) after fork must not leak to the child.
    ;; The child does not run until the parent blocks on join, so the
    ;; rebinding always happens before the child reads iso-x.
    (let iso-x 1)
    (let iso-pid (fork iso-x))
    (let iso-x 2)

    ;; deep lookup: locals, enclosing frames, and builtins
    (defun make-add3 (a) (lambda (b) (lambda (c) (+ a (+ b c)))))

    ;; shadowing within one scope: newest binding wins
    (let sh 1)
    (let sh (+ sh 10))

(run-tests (list
    (diag "env semantics")

    (is (join iso-pid) 1 "... child sees the fork-time binding, not the later one")
    (is iso-x 2          "... parent sees its own rebinding")

    (is (((make-add3 1) 2) 3) 6 "... nested lambda frames resolve through the chain")

    (is sh 11 "... re-let shadows, newest binding wins")
))

`).catch((e) => {
    console.error(String(e));
    process.exit(1);
});
