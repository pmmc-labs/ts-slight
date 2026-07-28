import assert from 'node:assert';
import { parse, expand, initalizeEnv, Strand, type ProcessResult } from '../src/index.ts';

// every case must TERMINATE: a hung run() means the killed process (or its
// in-flight syscall) kept the scheduler alive -- the exact bugs under test
async function run (source : string, timeout_ms : number = 5000) : Promise<ProcessResult[]> {
    let exprs  = expand(parse(source));
    let strand = new Strand();
    let guard : ReturnType<typeof setTimeout> | undefined;
    let timeout = new Promise<never>((_, reject) => {
        guard = setTimeout(() => reject(new Error(`run() did not terminate within ${timeout_ms}ms -- killed process still live?`)), timeout_ms);
    });
    let results = await Promise.race([ strand.run( exprs, initalizeEnv() ), timeout ]);
    clearTimeout(guard!);
    return results;
}

function errOf (results : ProcessResult[], pid_ident : number) : string {
    let r = results.find((r) => r.pid.ident == pid_ident);
    if (r == undefined || r.type != 'ERR') throw new Error(`expected PID[${pid_ident}] to be ERR, got ${r == undefined ? 'nothing' : r.type}`);
    return String(r.error.error);
}

// -- kill a process blocked on a syscall (sleep): it must not resurrect ------
{
    let results = await run(`
        (defun Ticker () (syscall 'sleep 25) (yield (Ticker)))
        (let t (yield (fork (Ticker))))
        (syscall 'sleep 80)
        (kill t)
        :done
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.ok( errOf(results, 2).includes('KILLED'), 'sleeping ticker records ERR KILLED' );
}

// -- kill a runnable process (yield spinner): the runqueue must drop it ------
{
    let results = await run(`
        (defun Spin () (yield (Spin)))
        (let s (fork (Spin)))
        (yield ())
        (kill s)
        :done
    `);
    let main = results.find((r) => r.pid.ident == 1);
    if (main == undefined || main.type != 'HALT') throw new Error('expected main to HALT');
    assert.ok( errOf(results, 2).includes('KILLED'), 'spinner records ERR KILLED' );
}

// -- join AFTER kill faults the joiner with KILLED, not DEADLOCKED -----------
{
    let results = await run(`
        (let p (fork (recv)))
        (kill p)
        (join p)
    `);
    assert.ok( errOf(results, 1).includes('KILLED'), 'late joiner faults with KILLED' );
    assert.ok( errOf(results, 2).includes('KILLED'), 'killed recv-er records ERR KILLED, not DEADLOCKED' );
}

// -- a waiter already joined at kill time is faulted with KILLED -------------
{
    let results = await run(`
        (defun Sleeper () (syscall 'sleep 500) :never)
        (let p (fork (Sleeper)))
        (fork (do (syscall 'sleep 50) (kill p)))
        (join p)
    `);
    assert.ok( errOf(results, 1).includes('KILLED'), 'current joiner faulted with KILLED' );
    assert.ok( errOf(results, 2).includes('KILLED'), 'sleeper records ERR KILLED' );
    let killer = results.find((r) => r.pid.ident == 3);
    if (killer == undefined || killer.type != 'HALT') throw new Error('expected killer to HALT');
}

console.log('ok - kill tests passed');
