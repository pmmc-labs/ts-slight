import { readFileSync }   from 'node:fs';
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
    console.time('slight-run');
    let halted = await strand.run(exprs, env);
    console.timeEnd('slight-run');
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
