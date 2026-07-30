
import { type TERM, list, str, num, bool, sym, pprint } from './terms.ts';

// -----------------------------------------------------------------------------

export function parse (source : string) : TERM[] {
    const lexer  = /\;[^\n]*|"[^"]*"|\'|\(|\)|[^\s()']+/g;

    let tokens = source.match(lexer)!;

    if (tokens == undefined) throw new Error(`Expected tokens from (${source})`)

    let done  : any[] = [];
    let stack : any[] = [];

    const isQuoteFrame = (frame : any) : boolean => Array.isArray(frame) && (frame as any).quoted === true;

    // a completed term lands in the enclosing frame (or `done` at top level);
    // a quote frame is complete as soon as it holds its one datum
    const emit = (term : any) : void => {
        let tos = stack.at(-1);
        if (tos == undefined) {
            done.push(term);
        } else {
            tos.push(term);
            if (isQuoteFrame(tos) && tos.length == 2) {
                stack.pop();
                emit(list(...tos));
            }
        }
    }

    while (tokens.length > 0) {
        let token = tokens.shift()!;
        if (token.startsWith(';')) continue;
        switch (token) {
        case '(':
            stack.push([]);
            break;
        case ')': {
            let frame = stack.pop();
            if (frame == undefined) {
                let last = done.at(-1);
                throw new Error(`PARSE ERROR: unexpected ')' ... ${last == undefined ? '??' : pprint(last)}) <--`);
            }
            if (isQuoteFrame(frame)) {
                throw new Error(`PARSE ERROR: dangling ' before ')' ... ${stack.flat().map(pprint).join(' ')}') <--`);
            }
            emit(list(...frame));
            break;
        }
        case "'": {
            let qframe : any = [ sym('quote') ];
            qframe.quoted = true;
            stack.push(qframe);
            break;
        }
        default:
            if (token.startsWith('"')) {
                if (token.length < 2 || !token.endsWith('"')) {
                    throw new Error(`PARSE ERROR: unterminated string ... ${stack.flat().map(pprint).join(' ')} ${token} ? <--`);
                }
                emit(str(token.slice(1, -1)));
            } else if (token == '#true') {
                emit(bool(true));
            } else if (token == '#false') {
                emit(bool(false));
            } else if (/^-?\d+(\.\d+)?$/.test(token)) {
                emit(num(Number(token)));
            } else {
                if (token.startsWith(':')) {
                    let qframe : any = [ sym('quote') ];
                    qframe.quoted = true;
                    stack.push(qframe);
                    emit(sym(token.slice(1)));
                } else {
                    emit(sym(token));
                }
            }
        }
    }

    if (stack.length > 0) {
        if (isQuoteFrame(stack.at(-1))) {
            let last = done.at(-1);
            throw new Error(`PARSE ERROR: ' at end of input ... ${last == undefined ? '??' : pprint(last)} ' <--`);
        }
        throw new Error(`PARSE ERROR: unclosed '(' ... (${stack.flat().map(pprint).join(' ')} ? <--`);
    }

    return done;
}
