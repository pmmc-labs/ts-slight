<!----------------------------------------------------------------------------->
# TODO
<!----------------------------------------------------------------------------->

- restore global quota

- look at what Claude said below ...

```
Confirmed bugs (I ran these)

1. npm test is broken. package.json:9 points at js/tests/001-basic.js, which doesn't exist — it exits with ERR_MODULE_NOT_FOUND. The three real test files (050, 100,
200) all pass when run directly (215 assertions total), but nothing runs them all. A one-liner fixes this:

"test": "rm -rf ./js && tsc && for t in js/tests/*.js; do node $t || exit 1; done"

2. Strict-Bool if vs. truthy and/or is a semantic trap. if requires a literal Bool (strand.ts:543), but and/or deliberately return truthy values ((and #true 42) → 42,
tested at 100-self-test.ts:253). Composing them faults:

(if (and #true 42) "yes" "no")   →  E!Expected Bool returned to COND, got NUM

Since when, cond, and case all expand to if, the strictness spreads everywhere. You need to pick one: either if adopts the same truthy test and/or already use (the
isBool ? … : isNum ? … : isNil chain at strand.ts:526 — the logic already exists, one branch below), or and/or coerce to Bool. The current split means whether a
condition works depends on which operator produced it.

3. case evaluates its topic once per clause. reader.ts:39 splices the raw topic expression into each (eq? topic cond) test. I confirmed side effects run once per
non-matching clause:

(case (do (sys/io/print-ln "TOPIC EVALUATED") 2) (1 "one") (2 "two"))
→ prints TOPIC EVALUATED twice

With a topic like (recv) this would consume two messages. The classic fix is expanding to (let <gensym> topic) around the chain — you have let and interned syms, so a
$case-topic-N counter sym would do until real gensym/hygiene arrives.

4. Prelude max and min are broken. Prelude.slight:45-49 — the lambda body calls (max acc n) recursively, but max takes a list, and there's no numeric two-arg max
builtin (it's still in the TODO block at builtins.ts:118). (max (list 1 2 3)) → ARITY MISMATCH! got extra args (1). Also, even once fixed, seeding min with 0 returns 0
for any all-positive list. These are the only Prelude functions with zero test coverage — which is exactly why they're the broken ones. Worth adding a Prelude section
to the self-test.

5. The Prelude path is CWD-dependent. index.ts:23 reads ./lib/Prelude.slight relative to wherever you launched node — running slight from any other directory dies with
ENOENT (confirmed). Resolve it against the module instead: new URL('../../lib/Prelude.slight', import.meta.url) (mind the extra ../ since it runs from js/src/).

6. browser.ts skips the reader pass. Its run() calls parse() but never expand() (browser.ts:28), so any when/case/cond in browser-run code hits the strand.ts:368 throw
("should be resolved in the Reader"). This is drift from the near-duplicate main()/prove() in index.ts — see the structural note below.

7. @ARGV truncates float arguments. index.ts:44 tests with Number(arg) but converts with parseInt(arg) — slight foo.slight 1.5 binds 1. Also Number('') == 0 is not
NaN, so an empty arg becomes num(NaN) via parseInt(''). Just use num(Number(arg)).

8. rand and abs have unchecked casts. builtins.ts:130-131 do (n as Num).value with no isNum guard — (rand "foo") silently returns num(NaN) instead of a type error,
unlike every other builtin which raises properly.

7. @ARGV truncates float arguments. index.ts:44 tests with Number(arg) but converts with parseInt(arg) — slight foo.slight 1.5 binds 1. Also Number('') == 0 is not NaN, so an empty arg becomes num(NaN) via
parseInt(''). Just use num(Number(arg)).

8. rand and abs have unchecked casts. builtins.ts:130-131 do (n as Num).value with no isNum guard — (rand "foo") silently returns num(NaN) instead of a type error, unlike every other builtin which raises
properly.

Design and structure (the WIP-appropriate stuff)

RunQueue's method names lie. strand.ts:23-46 — unshift pushes to front, pop behaves like shift, and push items come out LIFO (newest spawn first) while unshift items come out FIFO. The resulting policy — fresh
spawns jump ahead of yielded processes — appears deliberate (spawnProcess says "push this so it runs immediately") and is load-bearing for your deterministic-scheduling story, but nobody can see that from names
borrowed from Array with opposite meanings. Rename to something like enqueue/enqueueUrgent/dequeue and write the policy down in a comment.

halted grows forever. Every finished process's result is retained (strand.ts:192) so late joins work — but that's an unbounded leak for the long-running-server use case (simple-db-server.slight exists, so you're
headed there). Your memory notes say reaping is on your radar; the honest observation is that the current join semantics require infinite retention because any pid might be joined later. Erlang's answer (you
only get a result if you set up a monitor/link before death) is probably where this lands. Related dead code: sendMessage's this.halted.has(...) check at strand.ts:122 can never fire, since haltProcess already
deleted the pid from procs, making the first check catch it.

index.ts is three things at once. It's the library barrel (export *), the CLI entrypoint (main), the test harness (prove), and the metrics instrumentation — and because it imports node:fs, it can't be the
browser entry, which is why browser.ts exists as a hand-maintained near-copy of run(). That duplication already produced bug #6. The natural split: a pure src/index.ts barrel (no node imports), move
main/prove/metrics into bin/slight.ts or a src/cli.ts, and have browser and CLI share one "parse → expand → initEnv → run" pipeline function so expand can't be forgotten in one of them.

Process/Chan/WaitFor live in konts.ts. konts.ts:135-142 — the file has quietly become "all runtime types." Fine for now, but Process and Chan are scheduler concepts, not continuations; when you do the lowering
pass you've planned, a process.ts (or folding them into strand.ts) will make the seam cleaner. Similarly Chan is imported by strand.ts but the mailbox is constructed as an inline literal (strand.ts:209), so the
type isn't actually enforcing anything there.

EVAL_ARGS copies the done-array on every argument (strand.ts:461, let done = [...kont.done]). Konts here are single-shot (you've explicitly ruled out call/cc), so mutating kont.done in place is safe and turns
O(n²) allocation per call into O(n). Given steps/msg is one of your named perf levers and every function call pays this, it's probably the cheapest win on the list.

Serialization landmines for the migration vision. isNil/isTrue/isFalse are reference-identity checks against singletons (terms.ts:32-35), and syms/small nums are interned. Perfect for a single-heap interpreter —
but process migration and a git-backed image both mean deserializing terms, and a deserialized {type:'NIL'} will fail isNil while isCons's type-tag check succeeds. Not something to fix now; something to write
down so the deserializer knows it must re-intern through sym/num/bool and map NIL by tag, not identity.

Smaller things

- initalizeEnv (builtins.ts:98) is a typo for initialize — it's exported API in three call sites; cheapest to fix now.
- cadr returns TERM (with ERROR smuggled in) while cddr returns LIST | ERROR (terms.ts:114-122) — inconsistent signatures for sibling functions.
- list() (terms.ts:105) calls args.reverse() — mutation of the caller's array is invisible at call sites that pass a named array rather than a spread.
- Parser: source.match(lexer)! at parser.ts:9 — the ! defeats the null-check on the next line (it still works because == undefined catches null, but one of the two is redundant). tokens.shift() in the loop is
O(n²) on big sources; an index cursor fixes it when it matters. String escapes (\", \n) don't exist yet — presumably known.
- kontinue's big switch(true) in EVAL_EXPR shares one scope across cases, which is why the variables are named and_cond/or_cond/etc. Wrapping each case in { } (as some already are) would let them all be
cond/if_true and would let you turn noFallthroughCasesInSwitch back on.
- DEFINE at strand.ts:519 binds into let local which is never used — enabling the commented-out noUnusedLocals in tsconfig would catch this class of thing; the codebase is small enough that turning it on now is
cheap.
- bench/results/ is untracked but the harness's comment says results "stay keyed to the commit that produced them" — decide whether that means committing them (then git add) or not (then .gitignore it); the
current ?? state is the one wrong answer.
- Stray .DS_Store files in tests/, examples/, docs/superpowers/ — .gitignore covers the name but a find . -name .DS_Store -delete would tidy the tree.

What's genuinely good

Worth saying explicitly since you asked for honest: the stepper design (step's quota loop + kontinue as a pure-ish transition function) is easy to follow and the ERROR-terms-are-never-values invariant at
strand.ts:326 is enforced in exactly one place, which is the right way to do it. The snapshotEnv comment block (terms.ts:134-140) explains why the whole rib chain gets pinned and points at the test that proves
it — that's the kind of comment that survives. And the bench harness checking byte-identical output across trials as a determinism regression test is a quietly excellent idea that most language runtimes don't
have.

If I were picking three things to do next: fix npm test (#1), resolve the truthiness split (#2) since it shapes every program anyone writes from here on, and do the index/browser entrypoint split (#6/structure)
before the two copies drift further.
```
