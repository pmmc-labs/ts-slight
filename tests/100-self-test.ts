import { prove } from '../src/index.ts';

prove(`

(run-tests (list
    (ok #true "... got true")
    (ok (not #false) "... got true??")
    (ok 10 "... 10 is a true value")
    (ok (not ()) "... () is not a true value")
))

`).catch((e) => {
    console.error(String(e));
    process.exit(1);
});
