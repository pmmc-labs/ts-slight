import { readFileSync }   from 'node:fs';
import { DEBUG }          from './debug.ts';
import { parse }          from './parser.ts';
import { initalizeEnv }   from './builtins.ts';
import { Strand }         from './strand.ts';
import {
    newEnv, bind,
    sym, list, str,
    pprint,
} from './terms.ts';

export * from './debug.ts';
export * from './terms.ts';
export * from './parser.ts';
export * from './builtins.ts';
export * from './syscalls.ts';
export * from './konts.ts';
export * from './strand.ts';

export async function main () {
    let path = process.argv[2];
    if (path == undefined) {
        console.error(`usage: slight <file.slight> [args ...]`);
        process.exit(1);
    }

    let source = readFileSync(path, 'utf8');
    let exprs  = parse(source);

    if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

    let env = newEnv();
    env = bind( sym('@ARGV'), list( ...process.argv.slice(3).map((arg) => str(arg)) ), env );
    env = initalizeEnv( env );

    let strand = new Strand();
    if (DEBUG) console.time('tests');
    let halted = await strand.run(exprs, env);
    if (DEBUG) console.timeEnd('tests');
    if (DEBUG) {
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
}

export async function prove (test_source : string) {
    let test_module_path = './lib/Test.slight';
    let test_module_source = readFileSync(test_module_path, 'utf8');
    let source = [ test_module_source, test_source ].join("\n\n");
    let exprs  = parse(source);
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
