import assert from 'node:assert';
import { parse, expand, initalizeEnv, Strand, type ProcessResult } from '../src/index.ts';

async function run (source : string) : Promise<ProcessResult[]> {
    let exprs  = expand(parse(source));
    let strand = new Strand();
    return strand.run( exprs, initalizeEnv() );
}

// call-frame lines look like `     0 : (level-3 42)`; context lines like `  in RETURN : ...`
const isFrameLine = (line : string, name : string) : boolean =>
    new RegExp(`^\\s+\\d+ : \\(${name} `).test(line);

// -- deep non-tail error: call frames present, innermost-first ----------------
{
    let results = await run(`
        (defun level-3 (x) (car x))
        (defun level-2 (x) (+ 1 (level-3 x)))
        (defun level-1 (x) (+ 1 (level-2 x)))
        (level-1 42)
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');

    let i3 = err.trace.findIndex((l) => isFrameLine(l, 'level-3'));
    let i2 = err.trace.findIndex((l) => isFrameLine(l, 'level-2'));
    let i1 = err.trace.findIndex((l) => isFrameLine(l, 'level-1'));
    assert.ok( i3 >= 0, 'trace has a (level-3 42) frame' );
    assert.ok( i2 >= 0, 'trace has a (level-2 42) frame' );
    assert.ok( i1 >= 0, 'trace has a (level-1 42) frame' );
    assert.ok( i3 < i2 && i2 < i1, 'call frames are innermost-first' );
    assert.ok( err.trace[i3]!.includes('(level-3 42)'), 'frame shows the args' );
    assert.ok( err.trace.some((l) => l.startsWith('  in ')), 'trace has context lines' );
}

// -- error inside a tail loop: exactly one frame survives TCO -----------------
{
    let results = await run(`
        (defun loop (n)
            (if (== n 0) (car 99)
                (loop (- n 1))))
        (loop 1000)
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');

    let loop_frames = err.trace.filter((l) => isFrameLine(l, 'loop'));
    assert.equal( loop_frames.length, 1, 'exactly one loop frame survives TCO' );
    assert.ok( loop_frames[0]!.includes('(loop 0)'), 'the frame shows the current call, not the first' );
    // 5 context konts + a handful of frames; see renderTrace defaults (context_frames=5, call_cap=10)
    assert.ok( err.trace.length < 25, `trace is bounded, got ${err.trace.length} lines` );
}

// -- deep non-tail recursion: trace is capped with an elision line ------------
{
    let results = await run(`
        (defun sink (n)
            (if (== n 0) (car 99)
                (+ 1 (sink (- n 1)))))
        (sink 100)
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');

    let sink_frames = err.trace.filter((l) => isFrameLine(l, 'sink'));
    assert.equal( sink_frames.length, 20, 'capped at first 10 + last 10 call frames' );
    assert.ok( err.trace.some((l) => l.includes('frame(s) elided')), 'elision line present' );
}

// -- deadlocked process: swept child faults with a DEADLOCKED! error ----------
{
    let results = await run(`
        (fork (recv))
        :main-done
    `);
    let halt = results.find((r) => r.type == 'HALT');
    let err  = results.find((r) => r.type == 'ERR');
    if (halt == undefined || halt.type != 'HALT') throw new Error('expected a HALT result for main');
    if (err  == undefined || err.type  != 'ERR')  throw new Error('expected an ERR result for the swept child');

    assert.ok( String(err.error.error).includes('DEADLOCKED'), 'error mentions DEADLOCKED' );
    assert.ok( err.trace.some((l) => l.startsWith('  in BLOCK')), 'trace has a BLOCK context line' );
}

// -- joiner fault keeps its own trace, not the child's -------------------------
{
    let results = await run(`
        (defun boom (x) (car x))
        (defun child () (+ 1 (boom 1)))
        (join (fork (child)))
    `);
    let errs = results.filter((r) => r.type == 'ERR');
    assert.equal( errs.length, 2, 'expected two ERR results (child and joiner)' );

    let with_boom = errs.filter((e) => e.type == 'ERR' && e.trace.some((l) => isFrameLine(l, 'boom')));
    assert.equal( with_boom.length, 1, 'exactly one of the two traces has the (boom 1) frame' );
}

// -- 1M tail calls complete (previously quadratic / unrunnable) ---------------
{
    let start = performance.now();
    let results = await run(`
        (defun countdown (n)
            (if (== n 0) :done
                (countdown (- n 1))))
        (countdown 1000000)
    `);
    let ms = performance.now() - start;
    let halt = results[0];
    if (halt == undefined || halt.type != 'HALT') throw new Error('expected a HALT result');
    assert.ok( ms < 30000, `1M tail calls should be seconds, took ${Math.round(ms)}ms` );
    console.log(`# 1M tail calls in ${Math.round(ms)}ms`);
}

console.log('ok - trace tests passed');
