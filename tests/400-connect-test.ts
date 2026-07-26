import assert from 'node:assert';
import {
    parse, expand, initalizeEnv, Strand, EVENT_SOURCES, str, isNum,
    type ProcessResult,
} from '../src/index.ts';

async function run (source : string) : Promise<{ results : ProcessResult[], strand : Strand }> {
    let exprs   = expand(parse(source));
    let strand  = new Strand();
    let results = await strand.run( exprs, initalizeEnv() );
    return { results, strand };
}

// registers a source that emits `script` one Str at a time on timers;
// the returned state records whether stop() was called
function scripted (name : string, script : string[], delay_ms : number = 5) : { stopped : boolean } {
    let state  = { stopped : false };
    let timers : NodeJS.Timeout[] = [];
    EVENT_SOURCES.set(name, (emit) => {
        script.forEach((s, i) => timers.push(setTimeout(() => emit(str(s)), delay_ms * (i + 1))));
        return () => { state.stopped = true; timers.forEach(clearTimeout); };
    });
    return state;
}

// -- happy path: events drive the actor; halt auto-disconnects; loop exits ----
{
    let src = scripted('t1', ['a', 'b', 'q']);
    let { results } = await run(`
        (defun Counter (n)
            (let key (recv))
            (if (eq? key "q") n (Counter (+ n 1))))
        (join (connect :t1 (Counter 0)))
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.ok( isNum(main.result), 'join returned the count' );
    assert.equal( (main.result as any).value, 2, 'actor counted a,b before q' );
    assert.ok( src.stopped, 'source stopped on actor halt (auto-disconnect)' );
}

// -- explicit sends interleave with stream events -----------------------------
{
    let src = scripted('t2', ['q'], 20);
    let { results } = await run(`
        (defun Counter (n)
            (let key (recv))
            (if (eq? key "q") n (Counter (+ n 1))))
        (let actor (connect :t2 (Counter 0)))
        (send actor "x")
        (send actor "y")
        (join actor)
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.equal( (main.result as any).value, 2, 'both explicit sends arrived before the scripted q' );
    assert.ok( src.stopped, 'source stopped on actor halt' );
}

// -- unknown source raises, spawns no orphan ----------------------------------
{
    let { results, strand } = await run(`(connect :no-such-source (recv))`);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('Unknown event source'), 'error names the problem' );
    assert.equal( strand.metrics().procs, 1, 'only the init process was ever spawned' );
}

// -- busy source raises on second connect, spawns no orphan -------------------
{
    let src = scripted('t4', ['q'], 10);
    let { results, strand } = await run(`
        (defun Sink () (let k (recv)) (if (eq? k "q") :done (Sink)))
        (let a (connect :t4 (Sink)))
        (connect :t4 (Sink))
    `);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('already connected'), 'error names the problem' );
    assert.equal( strand.metrics().procs, 2, 'second connect spawned no orphan' );
    assert.ok( src.stopped, 'first connection still tore down cleanly' );
}

// -- disconnect detaches without killing the actor ----------------------------
{
    // scripted far in the future: proves stop() cancels pending timers,
    // because the test would otherwise stall for a second
    let src = scripted('t5', ['z'], 1000);
    let { results } = await run(`
        (defun Sink () (let k (recv)) (if (eq? k "q") :done (Sink)))
        (let actor (connect :t5 (Sink)))
        (disconnect actor)
        (send actor "q")
        (join actor)
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.ok( src.stopped, 'disconnect stopped the source' );
}

// -- disconnect of a pid with no live connection raises -----------------------
{
    let { results } = await run(`(disconnect (fork :x))`);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('no live connection'), 'error names the problem' );
}

// -- disconnect of a non-pid raises -------------------------------------------
{
    let { results } = await run(`(disconnect 42)`);
    let err = results.find((r) => r.type == 'ERR');
    if (err == undefined || err.type != 'ERR') throw new Error('expected an ERR result');
    assert.ok( String(err.error.error).includes('expects a PID'), 'error names the problem' );
}

console.log('ok - connect tests passed');
