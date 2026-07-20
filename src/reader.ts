
import {
    type TERM, type Sym, type Str, type Num, type Bool, type LIST, type Cons, type Nil,
    list, cons, car, cdr, cadr, cddr, str, num, bool, sym, NIL, TRUE, FALSE, uncons,
    isCons, isNil, isSym, isStr, isNum, isBool, isTrue, isFalse,
} from './terms.ts';

export function expand (exprs : TERM[]) : TERM[] {
    return exprs.map(expand_expr)
}

function expand_expr (expr : TERM) : TERM {
    switch (expr.type) {
    case 'CONS' :
        let head = expr.first;
        let tail = expr.rest;
        if (isSym(head) && isCons(tail)) {
            switch (head.ident) {
            case 'when' :
                let [ when_cond, when_if_true, ...when_if_true_rest ] = uncons(tail);
                if (when_cond    == undefined) throw new Error(`Expected cond for WHEN, got undefined`);
                if (when_if_true == undefined) throw new Error(`Expected if-true for WHEN, got undefined`);
                if (when_if_true_rest.length > 0) when_if_true = list( sym('do'), when_if_true, ...when_if_true_rest);
                return list( sym('if'), expand_expr(when_cond), expand_expr(when_if_true), NIL );
            case 'case' :
                let topic = tail.first;
                if (isCons(topic)
                && isCons(topic.first)
                && isCons((topic.first).first)
                && isSym(((topic.first).first).first)
                && (((topic.first).first).first).ident == 'quote') {
                    throw new Error(`You forgot the topic on the (case) expression`)
                }
                let kases = uncons(tail.rest);
                let compiled_kases : LIST = NIL;
                while (kases.length > 0) {
                    let kase = kases.pop();
                    if (kase == undefined) throw new Error(`Expected kase for CASE, got undefined`);
                    if (!isCons(kase))     throw new Error('Expected kases to be cons in (cond)');

                    let [ cond, if_true, ...if_true_rest ] = uncons(kase);
                    if (cond    == undefined) throw new Error(`Expected kase/cond for CASE, got undefined`);
                    if (if_true == undefined) throw new Error(`Expected kase/if-true for CASE, got undefined`);

                    if (!isBool(cond)) {
                        cond = list( sym('eq?'), topic, cond );
                    }
                    if (if_true_rest.length > 0) {
                        if_true = list( sym('do'), if_true, ...if_true_rest);
                    }
                    compiled_kases = list( sym('if'), expand_expr(cond), expand_expr(if_true), compiled_kases );
                }
                return compiled_kases;
            case 'cond' :
                let clauses = uncons(tail);
                let compiled_clauses : LIST = NIL;
                while (clauses.length > 0) {
                    let clause = clauses.pop();
                    if (clause == undefined) throw new Error(`Expected clause for COND, got undefined`);
                    if (!isCons(clause))     throw new Error('Expected clauses to be cons in (cond)');

                    let [ cond, if_true, ...if_true_rest ] = uncons(clause);
                    if (cond    == undefined) throw new Error(`Expected clause/cond for COND, got undefined`);
                    if (if_true == undefined) throw new Error(`Expected clause/if-true for COND, got undefined`);

                    if (if_true_rest.length > 0) {
                        if_true = list( sym('do'), if_true, ...if_true_rest);
                    }
                    compiled_clauses = list( sym('if'), expand_expr(cond), expand_expr(if_true), compiled_clauses );
                }
                return compiled_clauses;
            }
        }
        return cons(
            expand_expr( head ),
            expand_expr( tail ) as LIST
        );
    case 'NIL'  :
    case 'SYM'  :
    case 'STR'  :
    case 'NUM'  :
    case 'BOOL' : return expr;
    default:
        throw new Error(`Unexpected expr type ${expr.type}, expected Cons,Nil,Sym,Num,Str or Bool`);
    }
}

