#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Benchmark harness for slight.
//
//   usage: node bench/bench.mjs [--full] [--trials N] [--no-build]
//
// Runs the fixed-work suite N trials per config (default 3), reports the
// median of: wall time, msgs/sec, steps/msg, steps/sec, GC share, peak heap.
// Raw per-trial records are appended to bench/results/<sha>.jsonl so results
// stay keyed to the commit that produced them.
//
// It also checks scheduler determinism: for each config, the program output
// (minus timing and metrics lines) must be byte-identical across trials.
//
// msgs/sec is derived from the runtime's own counters (@@METRICS line,
// emitted when SLIGHT_METRICS=1), not from anything the benchmark prints.
// The three-way decomposition to watch:
//   steps/sec  -- interpreter clock speed (V8, GC, locality)
//   steps/msg  -- semantic cost of the language per message
//   msgs/sec   = steps/sec / steps/msg
// -----------------------------------------------------------------------------

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv     = process.argv.slice(2);
const FULL     = argv.includes('--full');
const NO_BUILD = argv.includes('--no-build');
const GC       = argv.includes('--gc'); // --trace-gc adds ~4% wall overhead, so opt-in
const t_ix     = argv.indexOf('--trials');
const TRIALS   = t_ix >= 0 ? parseInt(argv[t_ix + 1], 10) : 3;

const QUICK = [
    { name : 'fib',        file : 'examples/fib.slight',              args : ['25'] },
    { name : 'ring',       file : 'examples/ring-benchmark.slight',   args : ['1000', '100'] },
    { name : 'tournament', file : 'examples/fixed-tournament.slight', args : ['1', '25000'] },
    { name : 'tournament', file : 'examples/fixed-tournament.slight', args : ['100', '250'] },
    { name : 'tournament', file : 'examples/fixed-tournament.slight', args : ['10000', '10'] },
];
const EXTRA = [
    { name : 'fib',        file : 'examples/fib.slight',              args : ['27'] },
    { name : 'ring',       file : 'examples/ring-benchmark.slight',   args : ['10000', '100'] },
    { name : 'tournament', file : 'examples/fixed-tournament.slight', args : ['100000', '10'] },
];
const SUITE = FULL ? QUICK.concat(EXTRA) : QUICK;

// -----------------------------------------------------------------------------

// the three formats console.timeEnd emits: 1.23ms | 1.234s | 2:35.745 (m:ss.mmm)
const TIME_LINE = [
    /^([\w./-]+): ([\d.]+)ms$/,
    /^([\w./-]+): ([\d.]+)s$/,
    /^([\w./-]+): (\d+):([\d.]+) \(m:ss\.mmm\)$/,
];

function parsePhaseMs (line) {
    let m;
    if ((m = line.match(TIME_LINE[0]))) return [ m[1], parseFloat(m[2]) ];
    if ((m = line.match(TIME_LINE[1]))) return [ m[1], parseFloat(m[2]) * 1000 ];
    if ((m = line.match(TIME_LINE[2]))) return [ m[1], parseInt(m[2], 10) * 60000 + parseFloat(m[3]) * 1000 ];
    return undefined;
}

function median (xs) {
    let s = [ ...xs ].sort((a, b) => a - b);
    let mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt (x, digits = 0) {
    if (x === undefined || Number.isNaN(x)) return '-';
    return x.toLocaleString('en-US', { minimumFractionDigits : digits, maximumFractionDigits : digits });
}

function runOne (cfg) {
    let res = spawnSync('node', [ ...(GC ? [ '--trace-gc' ] : []), 'js/bin/slight.js', cfg.file, ...cfg.args ], {
        cwd       : ROOT,
        env       : { ...process.env, SLIGHT_METRICS : '1', DEBUG : '0' },
        encoding  : 'utf8',
        maxBuffer : 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
        throw new Error(`${cfg.file} ${cfg.args.join(' ')} exited ${res.status}\n${res.stderr}`);
    }
    let lines = res.stdout.split('\n');
    let mline = lines.find((l) => l.startsWith('@@METRICS '));
    if (mline == undefined) throw new Error(`no @@METRICS line from ${cfg.file} (SLIGHT_METRICS not wired up?)`);
    let metrics = JSON.parse(mline.slice('@@METRICS '.length));

    // Node 23 no longer emits 'gc' performance entries, so the runtime's
    // gc_ms is always 0 -- sum the main-thread pauses from --trace-gc instead
    // (emitted on stdout: "..., pooled: 239 MB, 0.12 / 0.00 ms (average mu = ...)")
    const GC_LINE = /^\[\d+:0x[0-9a-f]+\]/;
    let gc_ms = 0, gc_count = 0;
    for (const line of lines) {
        if (!GC_LINE.test(line)) continue;
        let m = line.match(/, ([\d.]+) \/ [\d.]+ ms/);
        if (m) { gc_ms += parseFloat(m[1]); gc_count++; }
    }
    metrics.gc_ms    = Math.round(gc_ms * 100) / 100;
    metrics.gc_count = gc_count;
    lines = lines.filter((l) => !GC_LINE.test(l)); // keep GC noise out of phases/canonical

    let phases = {};
    for (const line of lines) {
        let p = parsePhaseMs(line);
        if (p != undefined) phases[p[0]] = p[1];
    }

    // program output minus timing + metrics lines: must be identical across
    // trials if the scheduler is deterministic
    let canonical = lines
        .filter((l) => !l.startsWith('@@METRICS ') && parsePhaseMs(l) == undefined)
        .join('\n');

    let failed = lines.some((l) => l.includes('FAIL') || l.includes('ERRORED') || l.includes('DEADLOCKED'));

    return { phases, metrics, canonical, failed };
}

// -----------------------------------------------------------------------------

if (!NO_BUILD) {
    console.error('building ...');
    execSync('npm run build', { cwd : ROOT, stdio : [ 'ignore', 'ignore', 'inherit' ] });
}

let sha   = execSync('git rev-parse --short HEAD', { cwd : ROOT, encoding : 'utf8' }).trim();
let dirty = execSync('git status --porcelain',     { cwd : ROOT, encoding : 'utf8' }).trim().length > 0;
let label = dirty ? `${sha}-dirty` : sha;

let results_dir = join(ROOT, 'bench', 'results');
mkdirSync(results_dir, { recursive : true });
let jsonl = join(results_dir, `${label}.jsonl`);

console.error(`suite: ${SUITE.length} configs x ${TRIALS} trials  (commit ${label})`);

let rows = [];
let nondeterministic = [];

for (const cfg of SUITE) {
    let key = `${cfg.name} ${cfg.args.join('x')}`;
    process.stderr.write(`  ${key} ...`);
    let trials = [];
    for (let t = 0; t < TRIALS; t++) {
        let run = runOne(cfg);
        trials.push(run);
        appendFileSync(jsonl, JSON.stringify({
            ts : new Date().toISOString(), sha, dirty,
            name : cfg.name, file : cfg.file, args : cfg.args, trial : t,
            phases : run.phases, metrics : run.metrics, failed : run.failed,
        }) + '\n');
        process.stderr.write(` ${Math.round(run.metrics.wall_ms)}ms`);
    }
    process.stderr.write('\n');

    let deterministic = trials.every((r) => r.canonical === trials[0].canonical);
    if (!deterministic) nondeterministic.push(key);

    let wall  = median(trials.map((r) => r.metrics.wall_ms));
    let sent  = median(trials.map((r) => r.metrics.sent));
    let steps = median(trials.map((r) => r.metrics.steps));
    let gc    = median(trials.map((r) => r.metrics.gc_ms));
    let heap  = median(trials.map((r) => r.metrics.peak_heap_mb));

    rows.push({
        config      : key,
        'wall ms'   : fmt(wall),
        'msgs/s'    : sent > 0 ? fmt(sent / wall * 1000) : '-',
        'steps/msg' : sent > 0 ? fmt(steps / sent, 1) : '-',
        'steps/s'   : fmt(steps / wall * 1000),
        'gc %'      : fmt(gc / wall * 100, 1),
        'peak MB'   : fmt(heap),
        'ok'        : trials.some((r) => r.failed) ? 'FAIL' : (deterministic ? 'yes' : 'NONDET'),
    });
}

// manual table so the columns stay tight
let cols   = Object.keys(rows[0]);
let widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
let line   = (vals) => vals.map((v, i) => String(v).padStart(widths[i])).join('  ');
console.log('');
console.log(line(cols));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const r of rows) console.log(line(cols.map((c) => r[c])));
console.log('');
console.log(`raw runs appended to bench/results/${label}.jsonl`);
if (nondeterministic.length > 0) {
    console.log(`NONDETERMINISM detected in: ${nondeterministic.join(', ')}`);
    process.exitCode = 1;
} else {
    console.log('determinism: output byte-identical across all trials of every config');
}
