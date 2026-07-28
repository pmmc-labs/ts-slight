
import * as fs from "node:fs/promises"

import {
    type TERM,
    TRUE, FALSE, NIL,
    isNum, isStr, isList, isCons, isLiteral,
    str, pprint, uncons,
} from './terms.ts';

// -----------------------------------------------------------------------------

export const SYSCALLS : Map<string, (args : TERM[]) => Promise<TERM>> = new Map();

SYSCALLS.set('sleep', (args : TERM[]) : Promise<TERM> => {
    let ms = args[0];
    if (ms == undefined || !isNum(ms)) return Promise.reject(`sleep expects (ms : NUM)`);
    return new Promise((resolve) => setTimeout(() => resolve(ms), ms.value));
});


SYSCALLS.set('slurp', (args : TERM[]) : Promise<TERM> => {
    let path = args[0];
    if (path == undefined || !isStr(path)) return Promise.reject(`slurp expects (path : STR)`);
    return new Promise((resolve) =>
        fs.readFile( path.value, { encoding: 'utf8' } )
            .then((contents) => resolve(str(contents)))
    );
});

SYSCALLS.set('spew', (args : TERM[]) : Promise<TERM> => {
    let path = args[0];
    let data = args[1];
    if (path == undefined || !isStr(path)) return Promise.reject(`slurp expects first arg to be a string (path : STR)`);
    if (data == undefined || !(isStr(data) || isList(data)) ) return Promise.reject(`slurp expects second arg to be a string or list (data : STR | LIST)`);
    let contents = "";
    if (isStr(data)) {
        contents = data.value;
    } else if (isList(data) && isCons(data)) {
        contents = uncons(data).map((t) => (isLiteral(t) ? t.value : pprint(t))).join("\n");
    }
    return new Promise((resolve) =>
        fs.writeFile( path.value, contents, { encoding: 'utf8' } )
            .then((success) => resolve(success == undefined ? TRUE : FALSE))
    );
});
