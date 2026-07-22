import { type Process  } from './strand.ts';
import { type Kontinue } from './konts.ts';
import { pprint } from './terms.ts';

export const DEBUG : boolean = (globalThis as any).process?.env?.["DEBUG"] == '1';

export function LOG (...msgs : any[]) : void {
    console.log( ...msgs );
}

export function TRACE (proc : Process) : void {
    switch (proc.kont.type) {
    case 'EVAL_HEAD'  :
    case 'EVAL_ARGS'  :
    case 'DEFINE'     :
    case 'DROP'       :
    case 'COND'       :
    case 'SEND'       :
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
            console.log(
                [
                    proc.pid.ident.toString().padStart(4, '0'),
                    proc.steps.toString().padStart(6, '0'),
                    `${proc.kont.type.padStart(11, ' ')} > ${pprint(proc.kont.call)}`
                ].join(' | '),
            );
        }
        break;
    case 'SCOPE_EXIT':
        console.log(
            [
                proc.pid.ident.toString().padStart(4, '0'),
                proc.steps.toString().padStart(6, '0'),
                `${proc.kont.type.padStart(11, ' ')} < ${proc.kont.entry_step}`
            ].join(' | '),
        );
        break;
    default:
        console.log(
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
    case 'SCOPE_EXIT' : return `${kont.type}`;
    case 'SEND'       : return `${kont.type}`;
    case 'SYSCALL'    : return `${kont.type}`;
    case 'YIELD'      : return `${kont.type}`;
    default:
        return "WTF!";
    }
}

export function pprintKont (kont : Kontinue, depth : number) : string {
    let kontStr = `${kont.type.padStart(11, ' ')} | ${depth.toString().padStart(3, ' ')} | ${(depth > 0 ? "-".repeat(depth) : "^")}`;
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
    case 'SCOPE_EXIT' : break;
    case 'SEND'       : break;
    case 'SYSCALL'    : break;
    case 'YIELD'      : break;
    }
    return kontStr;
}
