import { type Process, type Kontinue } from './konts.ts';
import { pprint } from './terms.ts';

export const DEBUG : boolean = (globalThis as any).process?.env?.["DEBUG"] == '1';

export function LOG (...msgs : any[]) : void {
    console.log( ...msgs );
}

export function TRACE (proc : Process) : void {
    switch (proc.kont.type) {
    case 'EVAL_HEAD'  :
    case 'EVAL_ARGS'  :
    case 'EVAL_EXPR'  : return;
    case 'EVAL'       :
    case 'APPLY'      :
    case 'RETURN'     :
    case 'DEFINE'     :
    case 'DROP'       :
    case 'COND'       :
    case 'SCOPE_EXIT' :
    case 'SEND'       :
    case 'SYSCALL'    :
    case 'YIELD'      :
    case 'BLOCK'      :
    case 'HALT'       :
    case 'ERR'        :
    }

    let depth = 0;
    let kont : Kontinue = proc.kont;
    while (kont != undefined) {
        depth++;
        if (kont.type == 'HALT') break;
        kont = kont.kont;
    }

    if (depth > 0) depth--;

    console.log(
        [
            proc.pid.ident.toString().padStart(4, '0'),
            proc.steps.toString().padStart(6, '0'),
            pprintKont(proc.kont, depth)
        ].join(' | '),
    );
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
    case 'DROP'       : break;
    case 'COND'       : break;
    case 'SCOPE_EXIT' : break;
    case 'SEND'       : break;
    case 'SYSCALL'    : break;
    case 'YIELD'      : break;
    }
    return kontStr;
}
