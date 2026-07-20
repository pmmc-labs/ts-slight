import { DEBUG }          from './debug.ts';
import { parse }          from './parser.ts';
import {
    initalizeEnv,
    liftListOp,
}   from './builtins.ts';
import { Strand, Process, ProcessResult } from './strand.ts';
import {
    type Sym, type Str,
    newMapEnv,
    NIL,
    sym, list, str, num,
    bind, pprint, uncons, raise,
    isSym,
} from './terms.ts';

export * from './debug.ts';
export * from './terms.ts';
export * from './parser.ts';
export * from './builtins.ts';
export * from './syscalls.ts';
export * from './konts.ts';
export * from './strand.ts';

export async function run (source : string, prelude : string = '', args : string[] = []) : Promise<ProcessResult[]> {
    let exprs = parse([ prelude, source ].join("\n;; -- \n"));

    if (DEBUG) console.log("Parsed: ", exprs.map(pprint));

    let env = newMapEnv();
    env = bind( sym('@ARGV'), list( ...args.map((arg) => str(arg)) ), env );
    env = initalizeEnv( env );

    let strand = new Strand();
    let halted = await strand.run(exprs, env);
    for (const proc of halted) {
        if (proc.type == 'ERR') {
            console.log(pprint(proc.pid), ' ERRORED: ', pprint(proc.error));
        }
    }
    return halted;
}

