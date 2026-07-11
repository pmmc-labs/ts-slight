import { readFileSync } from 'node:fs';

import {
    DEBUG, parse, initalizeEnv, Strand,
    newEnv, bind, sym, str, list, pprint,
} from '../src/index.ts';

async function main () {
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
    let halted = await strand.run(exprs, env);

    for (const proc of halted) {
        if (proc.kont.type == 'HALT') {
            console.log(pprint(proc.pid), ' HALTED: ', proc.kont.result == undefined ? '!!!' : pprint(proc.kont.result));
        } else if (proc.kont.type == 'ERR') {
            console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.kont.error));
        }
    }
}

main().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
