#!/usr/bin/env node
// =====================================================================
// FideLite — move generation speed (perft)
//
//   node bench.js                   compares engine.js, engine_string.js and
//                                   engine_4x.js from this folder (engine.js is
//                                   the baseline); speed-comparison.bat runs this
//   node bench.js a.js b.js ...     compares the given files (the first is the baseline)
//
//   --rounds=N    number of rounds (default 3)
//   --fast        Start, CPW 3 and CPW 4 at depth 4; Kiwipete, CPW 5 and CPW 6 at
//                 depth 3 (default: all six at depth 4)
//   --site        the plan of the perft table on the site: Start d4, Kiwipete d3,
//                 CPW 3 d5, CPW 4 d4, CPW 5 d3, CPW 6 d3; calls are counted at the
//                 same depths, position by position
//   --no-count    skip the call counts
//   --no-warmup   skip the uncounted warm-up run at the start
//
// What is measured is the engine's own move generation: O() walks the moves,
// L() filters every candidate through G(), U() and T(). Moves are played plainly
// (c, U, t); the repetition key of M() (b+e+t+c) stays out of the count. Leaf
// nodes are counted in O()'s callback (bulk counting).
//
// Two boards are spoken; which one an engine uses is read from b once it loads:
//   0x88     engine.js, engine_4x.js — raw move U(), promotion piece as a number (3 5 6 4)
//   letters  engine_string.js — 64 letters, a8 = 0, '-' empty, t 1/0; raw move X(),
//            promotion piece as a letter ('q' 'r' 'b' 'n'); L(i) returns a target list
// On the letter board the U() column counts X() calls, i.e. board copies all the same.
//
// Method:
//   * every measurement runs in its own process; the engines share no JIT state
//   * the order of the engines rotates every round, which evens out warm-up and drift
//   * the MEDIAN is reported, not the best round
//   * every position's node count is checked against the known value; a single
//     mismatch stops the measurement
//   * G(), T() and U() calls and the ray steps inside G are counted once, in a
//     separate untimed process (machine-independent)
//
// The report is printed and saved to the results/ folder.
// =====================================================================
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { spawnSync } = require('child_process');

// FENs and expected counts from the CPW table of test.js.
const POSITIONS = [
  { name: 'Start',    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    exp: { 3: 8902, 4: 197281 } },
  { name: 'Kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    exp: { 3: 97862, 4: 4085603 } },
  { name: 'CPW 3',    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    exp: { 3: 2812, 4: 43238, 5: 674624 } },
  { name: 'CPW 4',    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    exp: { 3: 9467, 4: 422333 } },
  { name: 'CPW 5',    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    exp: { 3: 62379, 4: 2103487 } },
  { name: 'CPW 6',    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    exp: { 3: 89890, 4: 3894594 } },
];
const HEAVY = new Set(['Kiwipete', 'CPW 5', 'CPW 6']);
const SITE_D = { 'Start': 4, 'Kiwipete': 3, 'CPW 3': 5, 'CPW 4': 4, 'CPW 5': 3, 'CPW 6': 3 };
const DEFAULT_ENGINES = ['engine.js', 'engine_string.js', 'engine_4x.js'];

// ---------------------------------------------------------------- loading an engine
const S_DEF = 'S=_=>(i+=s)';          // G's ray walk on the 0x88 board; counted when instrumented
function loadEngine(file, instrument) {
  let src = fs.readFileSync(file, 'utf8');
  const bytes = Buffer.byteLength(src);
  let sCount = false;
  if (instrument && src.split(S_DEF).length === 2) { src = src.replace(S_DEF, 'S=_=>(__s++,i+=s)'); sCount = true; }
  const ctx = { __s: 0 };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: path.basename(file) });
  const str = Array.isArray(ctx.b) && typeof ctx.b[0] === 'string';
  for (const f of str ? ['O', 'L', 'G', 'T', 'X', 'C'] : ['O', 'L', 'G', 'T', 'U', 'C'])
    if (typeof ctx[f] !== 'function') throw new Error(path.basename(file) + ': no ' + f + '()');
  if (!str) {
    // Perft through the engine's own O(). X is U()'s promotion flag (0 = promotion),
    // written by U() inside L() just before O() calls back.
    vm.runInContext('__perft=(d,s,m=0)=>(O((j,x)=>(d>1?(X?[3]:[3,5,6,4]).map(p=>(s=[b,e,c,t],' +
                    'c&=~C(j)&~C(x),e=U(j,x,p),t^=8,m+=__perft(d-1),[b,e,c,t]=s)):m+=X?1:4,1)),m)', ctx);
  } else {
    // Letter board: O() also hands the piece letter to the callback; the promotion
    // list is built as in the engine's own H(). X() is the raw move: it copies the
    // board and returns the e.p. square or '-'.
    vm.runInContext("__perft=(d,s,m=0)=>(O((i,f,p)=>([...(j(p)!='P'|f%56>7?'q':'qrbn')].map(u=>" +
                    "d>1?(s=[b,e,c,t],c&=~C(i)&~C(f),e=X(i,f,u),t^=1,m+=__perft(d-1),[b,e,c,t]=s):m++),1)),m)", ctx);
  }
  return { ctx, bytes, sCount, str };
}

function setFEN(ctx, fen, str) {
  const [pieces, side, castling, ep] = fen.split(' ');
  if (str) {                                                      // letter board, a8 = 0
    ctx.b = [...pieces.replace(/\d/g, k => '-'.repeat(k)).replace(/\//g, '')];
    ctx.t = side === 'w' ? 1 : 0;
    ctx.c = (castling.includes('K') ? 4 : 0) | (castling.includes('Q') ? 8 : 0) |
            (castling.includes('k') ? 1 : 0) | (castling.includes('q') ? 2 : 0);
    ctx.e = ep === '-' ? '-' : (8 - ep[1]) * 8 + (ep.charCodeAt(0) - 97);
    ctx.n = 0;
    return;
  }
  const B = [];
  for (let i = 0; i < 120; i++) if (!(i & 8)) B[i] = 0;          // 0x88: off-board squares stay holes
  pieces.split('/').forEach((row, k) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      let p = 'pkqnrb'.indexOf(ch.toLowerCase()) + 1;
      if (ch < 'a') p += 8;
      B[(7 - k) * 16 + f++] = p;
    }
  });
  ctx.b = B;
  ctx.t = side === 'w' ? 8 : 0;
  ctx.c = (castling.includes('K') ? 1 : 0) | (castling.includes('Q') ? 2 : 0) |
          (castling.includes('k') ? 4 : 0) | (castling.includes('q') ? 8 : 0);
  ctx.e = ep === '-' ? 8 : (ep.charCodeAt(0) - 97) + 16 * (+ep[1] - 1);
  ctx.n = 0;
}

// ---------------------------------------------------------------- child process
function child(file, plan, count) {
  const { ctx, sCount, str } = loadEngine(file, count);
  const res = [];
  let g = 0, tt = 0, u = 0;
  if (count) {
    // The engine's own calls resolve the globals G, T and U, so wrappers count them.
    // On the letter board U is a string ('indexOf'); X() makes the board copy.
    const MK = str ? 'X' : 'U';
    const G0 = ctx.G, T0 = ctx.T, U0 = ctx[MK];
    ctx.G = function () { g++; return G0.apply(this, arguments); };
    ctx.T = function () { tt++; return T0.apply(this, arguments); };
    ctx[MK] = function () { u++; return U0.apply(this, arguments); };
  }
  for (const [p, d] of plan) {
    setFEN(ctx, POSITIONS[p].fen, str);
    g = tt = u = 0; ctx.__s = 0;
    const t0 = process.hrtime.bigint();
    const nodes = ctx.__perft(d);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    res.push({ p, d, nodes, ms, g, t: tt, u, s: sCount ? ctx.__s : null });
  }
  process.stdout.write(JSON.stringify(res));
}

// ---------------------------------------------------------------- parent process
function runChild(file, plan, count) {
  const r = spawnSync(process.execPath,
    [__filename, '--child', file, JSON.stringify(plan), count ? '1' : '0'],
    { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(path.basename(file) + ' crashed:\n' + (r.stderr || r.stdout));
  const res = JSON.parse(r.stdout);
  for (const x of res) {
    const want = POSITIONS[x.p].exp[x.d];
    if (x.nodes !== want)
      throw new Error(`${path.basename(file)}: ${POSITIONS[x.p].name} d${x.d} = ${x.nodes}, expected ${want} — engine WRONG, measurement stopped`);
  }
  return res;
}

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const x3 = v => fmt(v, 3) + '×';
const sg = (v, d = 1) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), d);
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
const sum = a => a.reduce((x, y) => x + y, 0);

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--child') return child(argv[1], JSON.parse(argv[2]), argv[3] === '1');

  const opt = k => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
  const rounds = Math.max(1, parseInt(opt('rounds'), 10) || 3);
  const fast = argv.includes('--fast'), site = argv.includes('--site'), count = !argv.includes('--no-count');
  const plan = POSITIONS.map((pos, p) => [p, site ? SITE_D[pos.name] : fast && HEAVY.has(pos.name) ? 3 : 4]);
  const countPlan = site ? plan : POSITIONS.map((_, p) => [p, 3]);
  const cDepth = site ? 'at the same depths as the plan' : 'at depth 3';

  let files = argv.filter(a => !a.startsWith('--'));
  if (!files.length) files = DEFAULT_ENGINES.map(f => path.join(__dirname, f)).filter(f => fs.existsSync(f));
  if (files.length < 2) { console.error('At least two engines are needed (the first is the baseline).'); process.exit(1); }

  const names = files.map(f => path.basename(f, '.js'));
  const bytes = files.map(f => loadEngine(f).bytes);
  const W = Math.max(...names.map(n => n.length), 8);
  const cpu = os.cpus()[0].model.trim();
  const planTxt = plan.map(([p, d]) => `${POSITIONS[p].name} d${d}`).join(', ');

  console.log(`\nFideLite move generation speed — ${rounds} round${rounds > 1 ? 's' : ''}, median`);
  console.log(`Plan: ${planTxt}`);
  console.log(`node ${process.version}, ${cpu}`);
  console.log('Engines: ' + names.map((n, i) => `${n} (${fmt(bytes[i])} B)`).join(', '));
  console.log('Every engine runs in its own process each round; the order rotates every round.\n');

  // ---- warm-up: the first run warms up the CPU and the disk cache; it is not counted
  if (!argv.includes('--no-warmup')) {
    process.stdout.write('  warm-up run (not counted)... ');
    const w0 = Date.now();
    runChild(files[0], [[0, 4], [3, 4]], false);
    console.log(fmt((Date.now() - w0) / 1000, 1) + ' s');
  }

  // ---- timed rounds
  const times = files.map(() => plan.map(() => []));      // [engine][position][round]
  const totals = files.map(() => []);
  const t00 = Date.now();
  let runs = 0;
  for (let r = 0; r < rounds; r++) {
    const order = files.map((_, i) => (i + r) % files.length);
    for (const i of order) {
      const res = runChild(files[i], plan, false);
      res.forEach((x, k) => times[i][k].push(x.ms));
      const tot = sum(res.map(x => x.ms));
      totals[i].push(tot);
      runs++;
      const left = (Date.now() - t00) / runs * (rounds * files.length - runs) / 60000;
      console.log(`  round ${r + 1}/${rounds}  ${padR(names[i], W)}  ${pad(fmt(tot / 1000, 1), 7)} s` +
                  (runs < rounds * files.length ? `   (about ${fmt(left, 0)} min left)` : ''));
    }
  }
  const el = (Date.now() - t00) / 1000;

  // ---- call counts (untimed)
  let counts = null;
  if (count) {
    console.log(`\n  counting G() / T() / U() calls ${cDepth} (not timed)...`);
    counts = files.map(f => runChild(f, countPlan, true));
  }

  // ---- report
  const out = [];
  const line = s => out.push(s);
  line(`FideLite move generation speed — ${rounds} round${rounds > 1 ? 's' : ''}, median`);
  line(`Plan: ${planTxt}`);
  line(`node ${process.version}, ${cpu}, ${os.cpus().length} cores, ${new Date().toISOString()}`);
  line(`Time: ${fmt(el / 60, 1)} min. Every node count is correct.`);
  line('');

  const colW = 22;
  line(padR('Position', 14) + names.map(n => pad(n.length > colW - 2 ? n.slice(0, colW - 2) : n, colW)).join(''));
  plan.forEach(([p, d], k) => {
    const base = median(times[0][k]);
    let s = padR(`${POSITIONS[p].name} d${d}`, 14);
    files.forEach((_, i) => {
      const m = median(times[i][k]);
      s += pad(fmt(m) + ' ms' + (i ? ` ${x3(base / m)}` : ''), colW);
    });
    line(s);
  });
  line('');

  const bT = median(totals[0]);
  const noise = a => { const s = [...a].sort((x, y) => x - y); return (s[s.length - 1] - s[0]) / 2 / median(a) * 100; };
  const cOf = (i, k) => counts[i].some(x => x[k] == null) ? null : sum(counts[i].map(x => x[k]));
  line(padR('Engine', W) + pad('Bytes', 7) + pad('ΔBytes', 8) + pad('Total', 12) + pad('Speed', 9) +
       pad('Gain', 10) + pad('%/byte', 9) + pad('Noise', 9));
  files.forEach((_, i) => {
    const m = median(totals[i]), sp = bT / m, db = bytes[i] - bytes[0], gain = (sp - 1) * 100;
    line(padR(names[i], W) + pad(fmt(bytes[i]), 7) + pad(i ? (db >= 0 ? '+' : '') + db : '—', 8) +
         pad(fmt(m / 1000, 2) + ' s', 12) + pad(x3(i ? sp : 1), 9) +
         pad(i ? sg(gain) + '%' : '—', 10) +
         pad(i && db > 0 ? sg(gain / db, 2) : '—', 9) +
         pad('±' + fmt(noise(totals[i]), 1) + '%', 9));
  });
  if (counts) {
    line('');
    line(`Call counts, ${cDepth}, all six positions (machine-independent; in brackets: baseline / engine):`);
    line(padR('Engine', W) + ['G()', 'T()', 'U()', 'ray steps'].map(h => pad(h, 24)).join(''));
    files.forEach((_, i) => {
      line(padR(names[i], W) + ['g', 't', 'u', 's'].map(k => {
        const v = cOf(i, k), v0 = cOf(0, k);
        return pad(v == null ? '— (not counted)' : fmt(v) + (i && v0 != null ? ` (${x3(v0 / v)})` : ''), 24);
      }).join(''));
    });
    line('');
    line('G() calls, position by position (in brackets: baseline / engine):');
    line(padR('Position', 14) + names.map(n => pad(n.length > colW - 2 ? n.slice(0, colW - 2) : n, colW)).join(''));
    countPlan.forEach(([p, d], k) => {
      line(padR(`${POSITIONS[p].name} d${d}`, 14) + files.map((_, i) =>
        pad(fmt(counts[i][k].g) + (i ? ` ${x3(counts[0][k].g / counts[i][k].g)}` : ''), colW)).join(''));
    });
  }
  line('');
  line('Speed     = baseline median / engine median (above 1.000× the engine is faster)');
  line('Gain      = (Speed − 1) × 100        %/byte = Gain / ΔBytes');
  line('Noise     = (slowest round − fastest round) / 2 / median; if a gain is below this,');
  line('            the difference may be noise: add rounds.');
  line('ray steps = steps of the ray walk inside G (not counted when an engine defines it differently).');
  line('Letter board (engine_string.js): the U() column counts X() calls. G() and the ray steps count');
  line('            functions built differently on the two boards and do not compare across them.');
  line('');
  line('Round totals (s):');
  files.forEach((_, i) => line('  ' + padR(names[i], W) + '  ' + totals[i].map(x => fmt(x / 1000, 2)).join('  ')));

  const report = out.join('\n');
  console.log('\n' + report + '\n');
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const fn = path.join(dir, `speed_${names.join('+').slice(0, 80)}${site ? '_site' : fast ? '_fast' : ''}_${stamp}.txt`);
  fs.writeFileSync(fn, report + '\n');
  console.log('Saved: ' + fn);
}
main();
