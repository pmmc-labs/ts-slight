import { type Process  } from './strand.ts';
import { type Kontinue } from './konts.ts';
import { pprint, uncons } from './terms.ts';

export const DEBUG : boolean = (globalThis as any).process?.env?.["DEBUG"] == '1';

import { Console } from 'console';

import { inspect } from "node:util"

export const Logger = new Console({
    stdout         : process.stdout,
    stderr         : process.stderr,
    inspectOptions : {
        depth       : 20,
        breakLength : process.stdout.columns - (process.stdout.columns / 4), // 75% of the screen
    },
});

export function LOG (...msgs : any[]) : void {
    Logger.log( ...msgs );
}

export function TRACE (proc : Process) : void {
    switch (proc.kont.type) {
    case 'EVAL_HEAD'  :
    case 'EVAL_ARGS'  :
    case 'DEFINE'     :
    case 'DROP'       :
    case 'COND'       :
    case 'SEND'       :
    case 'DISCONNECT' :
    case 'SYSCALL'    :
    case 'YIELD'      :
    case 'EVAL'       :
    case 'BLOCK'      : return;
    case 'APPLY'      :
    case 'SCOPE_EXIT' :
    case 'RETURN'     :
    case 'HALT'       :
    case 'ERR'        :
    case 'EVAL_EXPR'  :
    }

    let depth = 0;
    let kont : Kontinue = proc.kont;
    while (kont != undefined) {
        depth++;
        if (kont.type == 'HALT') break;
        kont = kont.kont;
    }

    if (depth > 0) depth--;

    switch (proc.kont.type) {
    case 'APPLY':
        if (proc.kont.call.type == 'LAMBDA') {
            Logger.log(
                [
                    proc.pid.ident.toString().padStart(4, '0'),
                    proc.steps.toString().padStart(6, '0'),
                    `${proc.kont.type.padStart(11, ' ')} > ${pprint(proc.kont.call)}`
                ].join(' | '),
            );
        }
        break;
    case 'SCOPE_EXIT':
        Logger.log(
            [
                proc.pid.ident.toString().padStart(4, '0'),
                proc.steps.toString().padStart(6, '0'),
                `${proc.kont.type.padStart(11, ' ')} < ${pprint(proc.kont.call)}`
            ].join(' | '),
        );
        break;
    default:
        Logger.log(
            [
                proc.pid.ident.toString().padStart(4, '0'),
                proc.steps.toString().padStart(6, '0'),
                pprintKont(proc.kont, depth)
            ].join(' | '),
        );
        break;
    }
}

export function dumpKont (kont : Kontinue) : string {
    switch (kont.type) {
    case 'EVAL'       : return `${kont.type} : ${pprint(kont.expr)}`;
    case 'EVAL_EXPR'  : return `${kont.type} : ${pprint(kont.expr)}`;
    case 'EVAL_HEAD'  : return `${kont.type} : ${pprint(kont.args)}`;
    case 'APPLY'      : return `${kont.type} : ${pprint(kont.call)}`;
    case 'RETURN'     : return `${kont.type} : ${pprint(kont.value)}`;
    case 'DEFINE'     : return `${kont.type} : ${pprint(kont.name)}`;
    case 'EVAL_ARGS'  : return `${kont.type} : ${pprint(kont.args)} -> [${kont.done.map(pprint).join(' ')}]`;
    case 'BLOCK'      : return `${kont.type} : ${kont.on == undefined ? '' : (kont.on.target == 'JOIN' ? pprint(kont.on.pid) : kont.on.target)}`;
    case 'HALT'       : return `${kont.type} : ${kont.result == undefined ? '' : pprint(kont.result)}`;
    case 'ERR'        : return `${kont.type} : ${pprint(kont.error)}`;
    case 'FOLD/RIGHT' : return `${kont.type} : ${pprint(kont.seq)} ${pprint(kont.acc)}`;
    case 'FOLD/LEFT'  : return `${kont.type} : ${pprint(kont.seq)} ${pprint(kont.acc)}`;
    case 'DROP'       : return `${kont.type}`;
    case 'COND'       : return `${kont.type}`;
    case 'SCOPE_EXIT' : return `${kont.type} : ${pprint(kont.call)}`;
    case 'SEND'       : return `${kont.type}`;
    case 'DISCONNECT' : return `${kont.type}`;
    case 'SYSCALL'    : return `${kont.type}`;
    case 'YIELD'      : return `${kont.type}`;
    default:
        return "WTF!";
    }
}

export function pprintKont (kont : Kontinue, depth : number) : string {
    let kontStr = `${kont.type.padStart(11, ' ')} | ${depth.toString().padStart(3, ' ')} | ${kont.env.type == 'MENV' ? 'TOP' : 'LEX' } | ${(depth > 0 ? "-".repeat(depth) : "^")}`;
    switch (kont.type) {
    case 'EVAL'       : kontStr += ` ${pprint(kont.expr)}`;  break;
    case 'EVAL_EXPR'  : kontStr += ` ${pprint(kont.expr)}`;  break;
    case 'EVAL_HEAD'  : kontStr += ` ${pprint(kont.args)}`;  break;
    case 'APPLY'      : kontStr += ` ${pprint(kont.call)}`;  break;
    case 'RETURN'     : kontStr += ` ${pprint(kont.value)}`; break;
    case 'DEFINE'     : kontStr += ` ${pprint(kont.name)}`;  break;
    case 'EVAL_ARGS'  : kontStr += ` ${pprint(kont.args)} -> [${kont.done.map(pprint).join(' ')}]`; break;
    case 'BLOCK'      : kontStr += ` ${kont.on == undefined ? '' : (kont.on.target == 'JOIN' ? pprint(kont.on.pid) : kont.on.target)}`; break;
    case 'HALT'       : kontStr += ` ${kont.result == undefined ? '' : pprint(kont.result)}`; break;
    case 'ERR'        : kontStr += ` ${pprint(kont.error)}`; break;
    case 'FOLD/RIGHT' : kontStr += ` ${pprint(kont.seq)} ${pprint(kont.acc)}`; break;
    case 'FOLD/LEFT'  : kontStr += ` ${pprint(kont.seq)} ${pprint(kont.acc)}`; break;
    case 'DROP'       : break;
    case 'COND'       : break;
    case 'SCOPE_EXIT' : kontStr += ` ${pprint(kont.call)}`; break;
    case 'SEND'       : break;
    case 'DISCONNECT' : break;
    case 'SYSCALL'    : break;
    case 'YIELD'      : break;
    }
    return kontStr;
}

// Reconstruct an error trace by walking the kont chain: the innermost
// pending konts give expression-level context, and each surviving
// SCOPE_EXIT is one call frame (tail-elided frames are invisible).
// Deep chains are capped Python-style: first/last `call_cap` frames.
export function renderTrace (kont : Kontinue, context_frames : number = 5, call_cap : number = 10) : string[] {
    if (kont.type == 'ERR') kont = kont.kont;

    let lines : string[] = [];

    let walk : Kontinue = kont;
    let context = 0;
    while (walk.type != 'HALT' && context < context_frames) {
        lines.push(`  in ${dumpKont(walk)}`);
        context++;
        walk = walk.kont;
    }

    let frames : string[] = [];
    walk = kont;
    while (walk.type != 'HALT') {
        if (walk.type == 'SCOPE_EXIT') {
            let name = walk.call.type == 'LAMBDA'
                ? (walk.call.name != undefined ? walk.call.name.ident : '<lambda>')
                : walk.call.name;
            frames.push(`(${[ name, ...uncons(walk.args).map(pprint) ].join(' ')})`);
        }
        walk = walk.kont;
    }

    let fmt = (f : string, i : number) : string => `  ${i.toString().padStart(4, ' ')} : ${f}`;
    if (frames.length > (2 * call_cap) + 1) {
        lines.push( ...frames.slice(0, call_cap).map(fmt) );
        lines.push(`  ... ${frames.length - (2 * call_cap)} frame(s) elided ...`);
        lines.push( ...frames.slice(-call_cap).map((f, i) => fmt(f, frames.length - call_cap + i)) );
    } else {
        lines.push( ...frames.map(fmt) );
    }
    return lines;
}
