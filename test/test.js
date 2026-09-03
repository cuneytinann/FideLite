#!/usr/bin/env node
// =====================================================================
// newengine — standard test suite
//
// Same corpus, same depths and same reference values as the original
// FideLite suite, retargeted at the numeric newengine core.
//
// What changed versus the old harness, and why:
//
//   board      s[]  (ASCII letters, a8 = 0)   ->  b[]  (numeric, a1 = 0)
//   moves      G(i)                           ->  L(i)
//   apply      M(from,to,'q')                 ->  M(from,to,3)
//   en-passant Y   ('-' = none)               ->  e   (-1 = none)
//   halfmove   o                              ->  n
//   check      J(W)                           ->  l(g)
//   FIDE 6.9   Q(W)                           ->  H(g)
//
// Third retarget (readability rename). Same engine, same structure, same
// byte count: only the single-letter names were shifted, mostly by case.
// Two pairs SWAPPED roles, and they are the whole risk of this port:
//
//   castling mask    C      ->  c            castling bits    c()  ->  C()
//   legal moves      l(i)   ->  L(i)         check            L()  ->  l()
//
// The rest of the shift, for reference:
//
//   side to move     T      ->  t            threat flag      t    ->  T
//   en passant       E      ->  e            geometry         g()  ->  G()
//   FIDE 6.9         h()    ->  H()          threat test      v()  ->  V()
//   draw claim       X()    ->  D()          repetition count G    ->  $
//   horizontal dist  H      ->  h            vertical dist    V    ->  v
//   colour / side    O      ->  g            FIDE 6.9 scratch j    ->  O
//
// b, n, M(), I(), Z(), A(), F() keep their names, so FEN handling and the
// perft driver are otherwise untouched.
//
// The index flip is the part that bites: every square number differs by
// ^56 between the two engines, so FEN parsing, square naming and the
// castling/en-passant fields all had to be rewritten rather than ported.
// Castling BIT semantics are unchanged (1=WK 2=WQ 4=BK 8=BQ) — verified
// against newengine's own c() rather than assumed.
//
// The engine is loaded as a bare core: no driver, no DOM, no prompt loop.
// M() is used (not O()) because perft must not touch castling rights,
// the repetition table or side-to-move — the harness owns those.
// =====================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

// Engine selection. ENGINE=path always wins; otherwise the first of these
// that exists in this folder is used, most capable first:
//
//   engine_4x.js                the speed build (+48 B, ~2-8x faster, same rules)
//   engine.js                   the byte-record build, full FIDE
//   engine_onlyMoveGenerator.js move generation only, no side to move, no result
//
// The suite only ever exercises move generation — L(), M() and C() — so every
// level in the list can run it. What the lower levels drop (result codes,
// counters, material) is never called here; see cmdDetect for what each one
// actually carries. Delete files from the top of the list to walk down it.
const ENGINE_CANDIDATES = ['./engine_4x.js', './engine.js', './engine_onlyMoveGenerator.js'];
const ENGINE_FILE = process.env.ENGINE ||
  ENGINE_CANDIDATES.find(p => fs.existsSync(path.join(__dirname, p))) ||
  './engine.js';

// ============== Piece encoding ==============
// newengine: piece = type*2 + colour, colour bit 0 (1 = White), 0 = empty.
// type: 1 bishop, 2 rook, 3 queen, 4 pawn, 5 king, 6 knight.
const FROM_FEN = { b: 2, B: 3, r: 4, R: 5, q: 6, Q: 7, p: 8, P: 9, k: 10, K: 11, n: 12, N: 13 };
const TO_FEN = Object.fromEntries(Object.entries(FROM_FEN).map(([k, v]) => [v, k]));

// Promotion argument for M()/O(): the TYPE, not a lookup index.
const PROMO = { q: 3, r: 2, b: 1, n: 6 };

// ---- squares: newengine is a1 = 0, file = i&7, rank = i>>3 ----
const sqName = i => String.fromCharCode(97 + (i & 7)) + ((i >> 3) + 1);
const nameSq = s => (+s[1] - 1) * 8 + (s.charCodeAt(0) - 97);

// ============== Engine loading ==============
function readEngine(p = ENGINE_FILE) {
  const full = path.isAbsolute(p) ? p : path.join(__dirname, p);
  if (!fs.existsSync(full)) {
    console.error(`ERROR: engine not found: ${p}`);
    console.error(`Looked next to test.js for, in order:`);
    for (const cand of ENGINE_CANDIDATES) console.error(`  ${cand.slice(2)}`);
    console.error(`Put one of them here, or set ENGINE=path`);
    process.exit(1);
  }
  let src = fs.readFileSync(full, 'utf8');
  // Accept an .html wrapper too, so a shipped build can be tested directly.
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (m) src = m[1];
  // Cut any driver: the core ends at the last engine definition (F=...).
  // prompt builds continue with `for(`/`while(`, event builds with a driver
  // that needs a DOM. Neither is wanted here.
  for (const marker of ['while(!z)', ';for(', ',for(', ';J=v=>', ';J=V=>', ",y=' onclick='", ';onkeyup', ';setInterval']) {
    const cut = src.indexOf(marker);
    if (cut > 0) src = src.slice(0, cut);
  }
  return src;
}

function loadEngine(p = ENGINE_FILE) {
  const src = readEngine(p);
  const sb = { Math, String, Number, Array, Object, JSON, console };
  vm.createContext(sb);
  try {
    vm.runInContext(src, sb);
  } catch (e) {
    console.error('ERROR: engine failed to load: ' + e.message);
    process.exit(1);
  }
  // Only what the suite actually calls. l(), H(), I(), Z(), A(), D() and F()
  // are deliberately absent from the lower levels, and no test touches them —
  // requiring them here would lock the suite to the two full engines.
  for (const fn of ['L', 'M', 'C', 'G']) {
    if (typeof sb[fn] !== 'function') {
      console.error(`ERROR: engine is missing ${fn}() — is this a newengine core?`);
      process.exit(1);
    }
  }
  sb.__src = src;
  return sb;
}

// ============== FEN <-> engine state ==============
// FEN lists rank 8 first; newengine stores rank 1 first. Hence the flip.
function setFEN(env, fen) {
  const [pieces, side, castling, ep, halfmove] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(0);
  let sq = 56;                       // a8 in newengine indexing
  for (const ch of pieces) {
    if (ch === '/') { sq -= 16; continue; }
    if (/\d/.test(ch)) { sq += +ch; continue; }
    if (!(ch in FROM_FEN)) throw new Error('bad FEN piece: ' + ch);
    board[sq++] = FROM_FEN[ch];
  }
  env.b = board;
  env.t = side === 'w' ? 1 : 0;
  let cr = 0;
  if (castling && castling !== '-') {
    if (castling.includes('K')) cr |= 1;
    if (castling.includes('Q')) cr |= 2;
    if (castling.includes('k')) cr |= 4;
    if (castling.includes('q')) cr |= 8;
  }
  env.c = cr;
  env.e = (!ep || ep === '-') ? -1 : nameSq(ep);
  env.n = halfmove ? +halfmove : 0;
}

function envToFEN(env) {
  let pieces = '';
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = env.b[r * 8 + f];
      if (!p) empty++;
      else { if (empty) { row += empty; empty = 0; } row += TO_FEN[p]; }
    }
    if (empty) row += empty;
    pieces += (r < 7 ? '/' : '') + row;
  }
  let castling = '';
  if (env.c & 1) castling += 'K';
  if (env.c & 2) castling += 'Q';
  if (env.c & 4) castling += 'k';
  if (env.c & 8) castling += 'q';
  if (!castling) castling = '-';
  const ep = (env.e == null || env.e < 0) ? '-' : sqName(env.e);
  return `${pieces} ${env.t ? 'w' : 'b'} ${castling} ${ep} ${env.n} 1`;
}

// ============== Perft ==============
// l() returns fully legal destinations, so no legality filter is needed here.
// Promotions are expanded to four moves, as perft requires.
function makePerft(env) {
  const snap = () => ({ b: env.b.slice(), c: env.c, e: env.e, n: env.n, t: env.t });
  const restore = st => { env.b = st.b; env.c = st.c; env.e = st.e; env.n = st.n; env.t = st.t; };
  const PROMOS = ['q', 'r', 'b', 'n'];

  function perft(depth) {
    if (depth === 0) return 1;
    let nodes = 0;
    const side = env.t;
    for (let from = 0; from < 64; from++) {
      const p = env.b[from];
      if (!p || (p & 1) !== side) continue;
      const isPawn = (p >> 1) === 4;
      for (const to of env.L(from)) {
        const promo = isPawn && (to < 8 || to >= 56);
        for (const q of (promo ? PROMOS : ['q'])) {
          const st = snap();
          // Castling rights must be updated by hand: M() deliberately does not,
          // because it also runs inside l()'s legality probe. A() would do it,
          // but A() also flips T and counts repetitions, which perft must not.
          env.c &= ~env.C(from) & ~env.C(to);
          env.M(from, to, PROMO[q]);
          env.t ^= 1;
          nodes += perft(depth - 1);
          restore(st);
        }
      }
    }
    return nodes;
  }
  return perft;
}

function legalMoves(env) {
  const moves = [];
  const side = env.t;
  for (let i = 0; i < 64; i++) {
    const p = env.b[i];
    if (!p || (p & 1) !== side) continue;
    const isPawn = (p >> 1) === 4;
    for (const to of env.L(i)) {
      if (isPawn && (to < 8 || to >= 56)) {
        for (const q of ['q', 'r', 'b', 'n']) moves.push(sqName(i) + sqName(to) + q);
      } else moves.push(sqName(i) + sqName(to));
    }
  }
  return moves.sort();
}

// ============== Stockfish ==============
const SF = process.env.STOCKFISH ||
  (process.platform === 'win32' ? 'stockfish.exe' :
    (fs.existsSync('/usr/games/stockfish') ? '/usr/games/stockfish' :
      fs.existsSync('/usr/bin/stockfish') ? '/usr/bin/stockfish' :
        fs.existsSync('/opt/homebrew/bin/stockfish') ? '/opt/homebrew/bin/stockfish' : 'stockfish'));

function sfRun(input, timeoutMs = 600000) {
  const r = spawnSync(SF, [], { input, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return (r.stdout || '') + (r.stderr || '');
}
function hasStockfish() { try { return /Stockfish/i.test(sfRun('quit\n', 5000)); } catch { return false; } }
function sfPerft(fen, depth) {
  const out = sfRun(`position fen ${fen}\ngo perft ${depth}\nquit\n`);
  const m = out.match(/Nodes searched:\s*(\d+)/);
  return m ? +m[1] : null;
}
function sfLegalMoves(fen) {
  const out = sfRun(`position fen ${fen}\ngo perft 1\nquit\n`);
  const moves = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([a-h][1-8][a-h][1-8][qrbn]?):\s*1\s*$/);
    if (m) moves.push(m[1]);
  }
  return moves.sort();
}

// ============== Reference positions ==============
// Node counts from the Chess Programming Wiki Perft Results page. The table
// intentionally runs deeper than this harness will normally compute: a present
// but unreachable entry costs nothing, whereas a MISSING entry silently
// downgrades a correct run to "(no reference)".
const CPW = [
  { name: "Start", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    expected: { 1: 20, 2: 400, 3: 8902, 4: 197281, 5: 4865609, 6: 119060324, 7: 3195901860, 8: 84998978956 } },
  { name: "Kiwipete", fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    expected: { 1: 48, 2: 2039, 3: 97862, 4: 4085603, 5: 193690690, 6: 8031647685 } },
  { name: "Position3", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    expected: { 1: 14, 2: 191, 3: 2812, 4: 43238, 5: 674624, 6: 11030083, 7: 178633661, 8: 3009794393 } },
  { name: "Position4", fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    expected: { 1: 6, 2: 264, 3: 9467, 4: 422333, 5: 15833292, 6: 706045033 } },
  { name: "Position4Mirror", fen: "r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1",
    expected: { 1: 6, 2: 264, 3: 9467, 4: 422333, 5: 15833292, 6: 706045033 } },
  { name: "Position5", fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    expected: { 1: 44, 2: 1486, 3: 62379, 4: 2103487, 5: 89941194 } },
  { name: "Position6", fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    expected: { 1: 46, 2: 2079, 3: 89890, 4: 3894594, 5: 164075551, 6: 6923051137, 7: 287188994746 } },
];

const TRICKY = [
  { name: "Illegal ep #1",               fen: "3k4/3p4/8/K1P4r/8/8/8/8 b - - 0 1",         ref: { 1: 18, 2: 92, 3: 1670, 6: 1134888 } },
  { name: "Illegal ep #2",               fen: "8/8/4k3/8/2p5/8/B2P2K1/8 w - - 0 1",        ref: { 1: 13, 2: 102, 3: 1266, 6: 1015133 } },
  { name: "EP capture checks opp.",      fen: "8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1",       ref: { 1: 15, 2: 126, 3: 1928, 6: 1440467 } },
  { name: "Short castling gives check",  fen: "5k2/8/8/8/8/8/8/4K2R w K - 0 1",            ref: { 1: 15, 2: 66, 3: 1198, 6: 661072 } },
  { name: "Long castling gives check",   fen: "3k4/8/8/8/8/8/8/R3K3 w Q - 0 1",            ref: { 1: 16, 2: 71, 3: 1286, 6: 803711 } },
  { name: "Castle Rights",               fen: "r3k2r/1b4bq/8/8/8/8/7B/R3K2R w KQkq - 0 1", ref: { 1: 26, 2: 1141, 3: 27826, 4: 1274206 } },
  { name: "Castling Prevented",          fen: "r3k2r/8/3Q4/8/8/5q2/8/R3K2R b KQkq - 0 1",  ref: { 1: 44, 2: 1494, 3: 50509, 4: 1720476 } },
  { name: "Promote out of Check",        fen: "2K2r2/4P3/8/8/8/8/8/3k4 w - - 0 1",         ref: { 1: 11, 2: 133, 3: 1442, 6: 3821001 } },
  { name: "Discovered Check",            fen: "8/8/1P2K3/8/2n5/1q6/8/5k2 b - - 0 1",       ref: { 1: 29, 2: 165, 3: 5160, 5: 1004658 } },
  { name: "Promote to give check",       fen: "4k3/1P6/8/8/8/8/K7/8 w - - 0 1",            ref: { 1: 9, 2: 40, 3: 472, 6: 217342 } },
  { name: "Under Promote to give check", fen: "8/P1k5/K7/8/8/8/8/8 w - - 0 1",             ref: { 1: 6, 2: 27, 3: 273, 6: 92683 } },
  { name: "Self Stalemate",              fen: "K1k5/8/P7/8/8/8/8/8 w - - 0 1",             ref: { 1: 2, 2: 6, 3: 13, 6: 2217 } },
  { name: "Stalemate & Checkmate I",     fen: "8/k1P5/8/1K6/8/8/8/8 w - - 0 1",            ref: { 1: 10, 2: 25, 3: 268, 7: 567584 } },
  { name: "Stalemate & Checkmate II",    fen: "8/8/2k5/5q2/5n2/8/5K2/8 b - - 0 1",         ref: { 1: 37, 2: 183, 3: 6559, 4: 23527 } },
  { name: "Bishop pin avoid",            fen: "1k6/1b6/8/8/7R/8/8/4K2R b K - 0 1",         ref: { 1: 13, 2: 284, 3: 3529, 5: 1063513 } },
];

const POS_ALIAS = {
  start: 'Start', kiwipete: 'Kiwipete', pos2: 'Kiwipete',
  pos3: 'Position3', pos4: 'Position4', pos4m: 'Position4Mirror',
  pos5: 'Position5', pos6: 'Position6',
};

const fmt = n => n.toLocaleString('en-US');

// Which rungs of the ladder are present, so a run on a lower level is never
// mistaken for a run on the full engine.
const LEVELS = {
  './engine_4x.js': 'full FIDE, speed build',
  './engine.js': 'full FIDE, byte-record build',
  './engine_onlyMoveGenerator.js': 'move generation only',
};

function banner() {
  const src = readEngine();
  const level = LEVELS[ENGINE_FILE];
  const skipped = ENGINE_CANDIDATES.slice(0, ENGINE_CANDIDATES.indexOf(ENGINE_FILE))
    .filter(p => !fs.existsSync(path.join(__dirname, p))).length;
  console.log(`\nEngine: ${ENGINE_FILE}  (${Buffer.byteLength(src, 'utf8')} B of core)`
    + (level ? `\n        ${level}` : '')
    + (skipped ? `  [${skipped} higher level(s) not in this folder]` : ''));
  return src;
}

// ============== Command: detect ==============
function cmdDetect() {
  const src = banner();
  const env = loadEngine();
  console.log(`\n  API present:`);
  for (const [fn, what] of [['L', 'legal moves'], ['M', 'apply move'], ['A', 'play real move'],
                            ['Z', 'result code'], ['D', 'draw claim'], ['F', 'flag/resign'],
                            ['l', 'check'], ['H', 'FIDE 6.9'], ['I', 'insufficient material'],
                            ['C', 'castling bits'], ['G', 'geometry']]) {
    console.log(`    ${typeof env[fn] === 'function' ? '+' : '-'} ${fn.padEnd(2)} ${what}`);
  }
  console.log(`\n  initial state: c=${env.c} t=${env.t} e=${env.e} n=${env.n}`);
  // Castling bit semantics, checked rather than assumed.
  const bits = [0, 4, 7, 56, 60, 63].map(i => `${sqName(i)}=${env.C(i)}`).join(' ');
  console.log(`  castling bits: ${bits}`);
  console.log(`  board: ${env.b.length} squares, a1=${env.b[0]} h8=${env.b[63]}`);
  console.log(`\n  Stockfish: ${hasStockfish() ? 'found (' + SF + ')' : 'NOT found'}\n`);
}

// ============== Command: sanity ==============
function cmdSanity() {
  banner();
  const env = loadEngine();
  const perft = makePerft(env);
  const cases = [
    ['Start', CPW[0].fen, 3, 8902],
    ['Position3', CPW[2].fen, 3, 2812],
    ['Kiwipete', CPW[1].fen, 3, 97862],
  ];
  let pass = 0;
  console.log('');
  for (const [name, fen, d, exp] of cases) {
    setFEN(env, fen);
    const got = perft(d);
    const ok = got === exp;
    if (ok) pass++;
    console.log(`  ${name}: ${fmt(got)} ${ok ? '\u2713' : '\u2717 expected ' + fmt(exp)}`);
  }
  console.log(`\nSanity: ${pass}/${cases.length} passed\n`);
  return pass === cases.length;
}

// ============== Command: cpw ==============
function cmdCPW(maxDepth = 4, minDepth = 1) {
  banner();
  const env = loadEngine();
  const perft = makePerft(env);
  let pass = 0, fail = 0, skip = 0;
  console.log('');
  for (const pos of CPW) {
    console.log(`${pos.name}:`);
    for (let d = +minDepth; d <= +maxDepth; d++) {
      const exp = pos.expected[d];
      if (exp == null) { console.log(`  d${d}: (no reference)`); skip++; continue; }
      const t0 = Date.now();
      setFEN(env, pos.fen);
      const got = perft(d);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const ok = got === exp;
      ok ? pass++ : fail++;
      console.log(`  d${d}: ${fmt(got)} ${ok ? '\u2713' : '\u2717 expected ' + fmt(exp)} (${secs}s)`);
    }
  }
  console.log(`\nCPW: ${pass} passed, ${fail} failed${skip ? ', ' + skip + ' without reference' : ''}\n`);
  return fail === 0;
}

// ============== Command: pos ==============
function cmdPos(name, depth) {
  banner();
  const key = POS_ALIAS[String(name).toLowerCase()] || name;
  const pos = CPW.find(p => p.name.toLowerCase() === String(key).toLowerCase());
  if (!pos) { console.error(`Unknown position: ${name}\nKnown: ${Object.keys(POS_ALIAS).join(' ')}`); process.exit(1); }
  const env = loadEngine();
  const perft = makePerft(env);
  const d = +depth;
  const exp = pos.expected[d];
  console.log(`\n${pos.name} d${d}${exp != null ? '  (expected ' + fmt(exp) + ')' : ''}`);
  const t0 = Date.now();
  setFEN(env, pos.fen);
  const got = perft(d);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (exp == null) { console.log(`  ${fmt(got)}  (no reference) (${secs}s)\n`); return true; }
  const ok = got === exp;
  console.log(`  ${fmt(got)} ${ok ? '\u2713 [published \u2713]' : '\u2717 expected ' + fmt(exp)} (${secs}s)\n`);
  return ok;
}

// ============== Command: verify (vs Stockfish) ==============
function cmdVerify(fen, depth) {
  banner();
  if (!hasStockfish()) { console.error('ERROR: verify requires Stockfish.'); process.exit(1); }
  const env = loadEngine();
  const perft = makePerft(env);
  const d = +depth;
  console.log(`\nFEN: ${fen}\nDepth: ${d}`);
  const t0 = Date.now();
  setFEN(env, fen);
  const got = perft(d);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const sf = sfPerft(fen, d);
  const ok = sf != null && got === sf;
  console.log(`  newengine: ${fmt(got)} (${secs}s)`);
  console.log(`  Stockfish: ${sf == null ? '(failed)' : fmt(sf)}  ${ok ? 'SF=' + fmt(sf) + ' \u2713' : '\u2717'}\n`);
  return ok;
}

// ============== Command: perft / divide ==============
function cmdPerft(fen, depth) {
  const env = loadEngine();
  const perft = makePerft(env);
  setFEN(env, fen);
  const t0 = Date.now();
  const got = perft(+depth);
  console.log(`${fmt(got)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return true;
}

function cmdDivide(fen, depth) {
  const env = loadEngine();
  const perft = makePerft(env);
  const d = +depth;
  setFEN(env, fen);
  const snap = () => ({ b: env.b.slice(), c: env.c, e: env.e, n: env.n, t: env.t });
  const restore = st => { env.b = st.b; env.c = st.c; env.e = st.e; env.n = st.n; env.t = st.t; };
  let total = 0;
  const out = [];
  for (let from = 0; from < 64; from++) {
    const p = env.b[from];
    if (!p || (p & 1) !== env.t) continue;
    const isPawn = (p >> 1) === 4;
    for (const to of env.L(from)) {
      const promo = isPawn && (to < 8 || to >= 56);
      for (const q of (promo ? ['q', 'r', 'b', 'n'] : ['q'])) {
        const st = snap();
        env.c &= ~env.C(from) & ~env.C(to);
        env.M(from, to, PROMO[q]);
        env.t ^= 1;
        const sub = d > 1 ? perft(d - 1) : 1;
        restore(st);
        out.push(`${sqName(from)}${sqName(to)}${promo ? q : ''}: ${sub}`);
        total += sub;
      }
    }
  }
  out.sort();
  for (const l of out) console.log(l);
  console.log(`\nNodes searched: ${total}`);
  return true;
}

// ============== Command: tricky ==============
function cmdTricky(maxDepth = 4) {
  banner();
  const useSF = hasStockfish();
  console.log(useSF ? 'Stockfish: cross-checking enabled' : 'Stockfish: not found (reference values only)');
  const env = loadEngine();
  const perft = makePerft(env);
  let pass = 0, fail = 0;
  console.log('');
  for (const pos of TRICKY) {
    // Each position has its OWN published depth; never exceed it pointlessly.
    const published = Math.max(...Object.keys(pos.ref).map(Number));
    const d = Math.min(+maxDepth, published);
    const exp = pos.ref[d];
    const t0 = Date.now();
    setFEN(env, pos.fen);
    const got = perft(d);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    let line = `  ${pos.name.padEnd(30)} d${d}: ${fmt(got)}`;
    let ok = true;
    if (exp != null) {
      ok = got === exp;
      // d1-d3 entries are not published: they were generated by an independent
      // reference implementation and agree with newengine. Label them honestly.
      const tag = d >= 4 ? '[published \u2713]' : '[ref \u2713]';
      line += ok ? ` \u2713 ${tag}` : ` \u2717 expected ${fmt(exp)}`;
    } else {
      const sf = useSF ? sfPerft(pos.fen, d) : null;
      if (sf != null) { ok = got === sf; line += ok ? ` SF=${fmt(sf)} \u2713` : ` \u2717 SF=${fmt(sf)}`; }
      else line += ' (no reference)';
    }
    if (useSF && exp != null) {
      const sf = sfPerft(pos.fen, d);
      if (sf != null && sf !== got) { ok = false; line += ` \u2717 SF=${fmt(sf)}`; }
      else if (sf != null) line += ` SF=${fmt(sf)} \u2713`;
    }
    line += ` (${secs}s)`;
    ok ? pass++ : fail++;
    console.log(line);
  }
  console.log(`\nTricky: ${pass} passed, ${fail} failed\n`);
  return fail === 0;
}

// ============== Command: vajolet ==============
function cmdVajolet(n = 30, maxDepth = 3, startIdx = 0) {
  banner();
  const file = process.env.VAJOLET || './vajolet_perft.txt';
  if (!fs.existsSync(file)) { console.error(`ERROR: ${file} not found`); process.exit(1); }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const env = loadEngine();
  const perft = makePerft(env);
  let pass = 0, fail = 0;
  const failures = [];
  const end = Math.min(+startIdx + +n, lines.length);
  console.log(`\n${lines.length} positions in file; running ${+startIdx}..${end - 1} to depth ${maxDepth}\n`);
  for (let idx = +startIdx; idx < end; idx++) {
    const parts = lines[idx].split(',');
    const fen = parts[0].trim() + ' 0 1';
    let row = `  [${String(idx + 1).padStart(3)}] `;
    let bad = false;
    for (let d = 1; d <= +maxDepth; d++) {
      const exp = parts[d] != null ? +parts[d] : null;
      if (exp == null || Number.isNaN(exp)) continue;
      setFEN(env, fen);
      const got = perft(d);
      if (got === exp) { pass++; row += `d${d}\u2713 `; }
      else { fail++; bad = true; row += `d${d}\u2717(${fmt(got)}\u2260${fmt(exp)}) `; }
    }
    if (bad) failures.push({ idx: idx + 1, fen });
    console.log(row);
  }
  console.log(`\nVajolet: ${pass} passed, ${fail} failed`);
  for (const f of failures.slice(0, 5)) console.log(`  FAIL [${f.idx}] ${f.fen}`);
  console.log('');
  return fail === 0;
}

// ============== Command: random (vs Stockfish) ==============
function cmdRandom(start, games = 20, maxPlies = 60) {
  banner();
  if (!hasStockfish()) { console.error('ERROR: random requires Stockfish.'); process.exit(1); }
  const PRESETS = {
    standard: CPW[0].fen, start: CPW[0].fen, kiwipete: CPW[1].fen,
    pos3: CPW[2].fen, pos4: CPW[3].fen, pos5: CPW[5].fen,
  };
  const fen = PRESETS[start] || start;
  const env = loadEngine();
  let ok = 0; const mismatches = [];
  console.log('');
  for (let g = 0; g < +games; g++) {
    setFEN(env, fen);
    let rng = (g + 1) | 0, fault = null;
    for (let ply = 0; ply < +maxPlies; ply++) {
      const curFEN = envToFEN(env);
      const fl = legalMoves(env);
      const sf = sfLegalMoves(curFEN);
      if (fl.length !== sf.length || fl.some((m, i) => m !== sf[i])) { fault = { ply, fen: curFEN, fl, sf }; break; }
      if (fl.length === 0 || env.n > 100) break;
      rng = (rng * 1664525 + 1013904223) | 0;
      const choice = fl[Math.abs(rng) % fl.length];
      const from = nameSq(choice.slice(0, 2)), to = nameSq(choice.slice(2, 4));
      env.c &= ~env.C(from) & ~env.C(to);
      env.M(from, to, PROMO[choice.length === 5 ? choice[4] : 'q']);
      env.t ^= 1;
    }
    if (fault) { mismatches.push({ g: g + 1, ...fault }); process.stdout.write('X'); }
    else { ok++; process.stdout.write('.'); }
  }
  console.log(`\n\nRandom: ${ok}/${games} fully matching`);
  for (const m of mismatches.slice(0, 3)) {
    console.log(`\nGame ${m.g} ply ${m.ply}:\n  FEN: ${m.fen}`);
    const onlyFL = m.fl.filter(x => !m.sf.includes(x));
    const onlySF = m.sf.filter(x => !m.fl.includes(x));
    if (onlyFL.length) console.log(`  engine only: ${onlyFL.join(' ')}`);
    if (onlySF.length) console.log(`  SF only    : ${onlySF.join(' ')}`);
  }
  console.log('');
  return mismatches.length === 0;
}

// ============== Command: all ==============
function cmdAll() {
  const results = [];
  results.push(['sanity', cmdSanity()]);
  results.push(['cpw d4', cmdCPW(4)]);
  results.push(['tricky d4', cmdTricky(4)]);
  if (fs.existsSync(process.env.VAJOLET || './vajolet_perft.txt')) results.push(['vajolet 20 d3', cmdVajolet(20, 3)]);
  console.log('=========================');
  for (const [n, ok] of results) console.log(`  ${ok ? '\u2713' : '\u2717'} ${n}`);
  const bad = results.filter(r => !r[1]).length;
  console.log(`=========================\n${bad ? bad + ' SUITE(S) FAILED' : 'ALL PASSED'}\n`);
  return bad === 0;
}

// ============== main ==============
const [, , cmd, ...args] = process.argv;
const USAGE = `
newengine test suite

  node test.js detect                        report API / castling bits / Stockfish
  node test.js sanity                        quick check (d3)
  node test.js cpw [maxD] [minD]             CPW positions over a depth range
  node test.js pos <name> <depth>            single position (start/kiwipete/pos3..pos6/pos4m)
  node test.js verify "<FEN>" <depth>        engine vs Stockfish, any position
  node test.js tricky [maxD]                 van Kervinck tricky positions
  node test.js vajolet [N] [maxD] [startIdx] Vajolet CSV suite
  node test.js random <preset|FEN> [games] [plies]   move-list equality vs Stockfish
  node test.js perft "<FEN>" <depth>         raw perft
  node test.js divide "<FEN>" <depth>        divide perft (debugging)
  node test.js all                           sanity + cpw d4 + tricky d4 + vajolet
`;

let okExit = true;
switch (cmd) {
  case 'detect': cmdDetect(); break;
  case 'sanity': okExit = cmdSanity(); break;
  case 'cpw': okExit = cmdCPW(args[0] ?? 4, args[1] ?? 1); break;
  case 'pos': okExit = cmdPos(args[0], args[1]); break;
  case 'verify': okExit = cmdVerify(args[0], args[1]); break;
  case 'perft': okExit = cmdPerft(args[0], args[1]); break;
  case 'divide': okExit = cmdDivide(args[0], args[1]); break;
  case 'tricky': okExit = cmdTricky(args[0] ?? 4); break;
  case 'vajolet': okExit = cmdVajolet(args[0] ?? 30, args[1] ?? 3, args[2] ?? 0); break;
  case 'random': okExit = cmdRandom(args[0] ?? 'kiwipete', args[1] ?? 20, args[2] ?? 60); break;
  case 'all': okExit = cmdAll(); break;
  default: console.log(USAGE);
}
process.exit(okExit ? 0 : 1);
