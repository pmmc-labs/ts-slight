import assert from 'node:assert';
import {
    sym, num, list,
    newMapEnv, newRibEnv, snapshotEnv, bind, lookup, bindParams,
    isError, isEnv,
} from '../src/index.ts';

// map layer: bind and lookup
let root = newMapEnv();
bind( sym('x'), num(1), root );
assert.deepEqual( lookup(sym('x'), root), num(1), 'MENV bind/lookup' );

// map layers chain: defuns layer over builtins layer
let defuns = newMapEnv(root);
bind( sym('f'), num(99), defuns );
assert.deepEqual( lookup(sym('f'), defuns), num(99), 'MENV local hit' );
assert.deepEqual( lookup(sym('x'), defuns), num(1),  'MENV parent fallthrough' );

// rib frame over map: local hit and fallthrough
let frame = newRibEnv(defuns);
bind( sym('y'), num(2), frame );
assert.deepEqual( lookup(sym('y'), frame), num(2), 'RENV local hit' );
assert.deepEqual( lookup(sym('x'), frame), num(1), 'RENV -> MENV fallthrough' );

// shadowing: re-bind prepends, newest node wins
bind( sym('y'), num(3), frame );
assert.deepEqual( lookup(sym('y'), frame), num(3), 'newest rib node wins' );

// unbound name -> ERROR term (not a throw)
assert.ok( isError( lookup(sym('nope'), frame) ), 'unbound is ERROR' );

// bindParams builds a rib frame directly
let params = list( sym('a'), sym('b') );
let callf  = bindParams( params, list( num(10), num(20) ), defuns );
assert.ok( !isError(callf), 'bindParams ok' );
if (!isError(callf)) {
    assert.equal( callf.type, 'RENV', 'bindParams returns a rib frame' );
    assert.deepEqual( lookup(sym('a'), callf), num(10) );
    assert.deepEqual( lookup(sym('b'), callf), num(20) );
    assert.deepEqual( lookup(sym('x'), callf), num(1), 'params frame falls through' );
    assert.ok( isEnv(callf) );
}

// arity mismatches still return ERROR
assert.ok( isError( bindParams( params, list(num(1)), defuns ) ),                 'missing arg' );
assert.ok( isError( bindParams( params, list(num(1), num(2), num(3)), defuns ) ), 'extra arg' );

// snapshot: pinned head, parent keeps moving
let live = newRibEnv(root);
bind( sym('s'), num(1), live );
let snap = snapshotEnv(live);
bind( sym('s'), num(2), live );
assert.deepEqual( lookup(sym('s'), live), num(2), 'live env sees the re-bind' );
assert.deepEqual( lookup(sym('s'), snap), num(1), 'snapshot is pinned at fork time' );

// snapshot of a map layer is the layer itself
assert.equal( snapshotEnv(root), root, 'MENV snapshot is identity' );

console.log('ok - env unit tests passed');
