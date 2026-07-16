import { readFileSync }   from 'node:fs';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { DEBUG }          from './debug.ts';
import { parse }          from './parser.ts';
import { expand }         from './reader.ts';
import { initalizeEnv }   from './builtins.ts';
import { Strand }         from './strand.ts';
import {
    newMapEnv, bind,
    sym, list, str, num,
    pprint,
} from './terms.ts';

export * from './debug.ts';
export * from './terms.ts';
export * from './parser.ts';
export * from './builtins.ts';
export * from './syscalls.ts';
export * from './konts.ts';
export * from './strand.ts';

function loadPrelude () {
    let path = './lib/Prelude.slight';
    let source = readFileSync(path, 'utf8');
    return source;
}

export async function main () {
    let path = process.argv[2];
    if (path == undefined) {
        console.error(`usage: slight <file.slight> [args ...]`);
        process.exit(1);
    }

    let source  = [
        loadPrelude(),
        readFileSync(path, 'utf8')
    ].join("\n;; -- \n");

    let exprs = expand(parse(source));
    if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

    let env = newMapEnv();
    env = bind( sym('@ARGV'), list( ...process.argv.slice(3).map((arg) => !isNaN(Number(arg)) ? num(parseInt(arg)) : str(arg)) ), env );
    env = initalizeEnv( env );

    let strand = new Strand();

    // when SLIGHT_METRICS=1, emit a single machine-readable `@@METRICS {...}`
    // line after the run: wall clock, kont transitions, messages, dispatches,
    // GC time and peak heap -- consumed by bench/bench.mjs
    const METRICS = (globalThis as any).process?.env?.["SLIGHT_METRICS"] == '1';
    let gc_ms = 0, gc_count = 0, peak_heap = 0;
    let gc_obs : PerformanceObserver | undefined;
    let heap_poll : ReturnType<typeof setInterval> | undefined;
    if (METRICS) {
        gc_obs = new PerformanceObserver((entries) => {
            for (const e of entries.getEntries()) { gc_ms += e.duration; gc_count++; }
        });
        gc_obs.observe({ entryTypes : ['gc'] });
        heap_poll = setInterval(() => {
            let used = process.memoryUsage().heapUsed;
            if (used > peak_heap) peak_heap = used;
        }, 100);
        heap_poll.unref();
    }

    console.time('slight-run');
    let wall_start = performance.now();
    let halted = await strand.run(exprs, env);
    let wall_ms = performance.now() - wall_start;
    console.timeEnd('slight-run');

    if (METRICS) {
        if (heap_poll != undefined) clearInterval(heap_poll);
        if (gc_obs != undefined) gc_obs.disconnect();
        let mem = process.memoryUsage();
        if (mem.heapUsed > peak_heap) peak_heap = mem.heapUsed;
        console.log('@@METRICS ' + JSON.stringify({
            wall_ms      : Math.round(wall_ms * 1000) / 1000,
            ...strand.metrics(),
            gc_ms        : Math.round(gc_ms * 1000) / 1000,
            gc_count     : gc_count,
            peak_heap_mb : Math.round(peak_heap / 1048576 * 10) / 10,
            rss_mb       : Math.round(mem.rss / 1048576 * 10) / 10,
        }));
    }

    for (const proc of halted) {
        if (DEBUG) console.group(`Process ${pprint(proc.pid)} ran for ${proc.steps} step(s)`);
        if (proc.kont.type == 'HALT') {
            if (DEBUG) console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
        } else if (proc.kont.type == 'ERR') {
            console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
        }
        if (DEBUG) console.groupEnd();
    }
}

export async function prove (test_source : string) {
    let source = [
        loadPrelude(),
        readFileSync('./lib/Test.slight', 'utf8'),
        test_source
    ].join("\n;; -- \n");

    let exprs = expand(parse(source));
    if (DEBUG) console.log("Test Parsed: ", exprs.map(pprint));
    let env = initalizeEnv();
    let strand = new Strand();
    console.time('tests');
    let halted = await strand.run(exprs, env);
    console.timeEnd('tests');
    for (const proc of halted) {
        console.group(`Process ${pprint(proc.pid)} ran for ${proc.steps} step(s)`);
        if (proc.kont.type == 'HALT') {
            console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
        } else if (proc.kont.type == 'ERR') {
            console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
        }
        console.groupEnd();
    }
}
