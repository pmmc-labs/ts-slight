import { type TERM, isNum } from './terms.ts';

// -----------------------------------------------------------------------------

export const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>> = new Map();

SYSCALLS.set('sleep', (args : TERM[]) : Promise<TERM> => {
    let ms = args[0];
    if (ms == undefined || !isNum(ms)) return Promise.reject(`sleep expects (ms : NUM)`);
    return new Promise((resolve) => setTimeout(() => resolve(ms), ms.value));
});
