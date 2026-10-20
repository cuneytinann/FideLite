#!/usr/bin/env node
// =====================================================================
// FideLite — standard test suite
//
// Perft and move-list tests over the engine's move generation: the CPW
// positions, the tricky suite, the Vajolet corpus and, when Stockfish is
// present, random games compared move list by move list.
//
// Only move generation is exercised: L(), C(), G() and the raw move — U() on
// the 0x88 board, M() on the string board. Perft counts every
// move sequence from a position and never touches result codes, counters,
// repetition or draw rules, so every level of the engine — down to the bare
// move-generator core — runs the same suite and must give the same numbers.
//
// Two board dialects are spoken:
//
//   0x88    engine.js, engine_4x.js, engine_onlyMoveGenerator.js and every
//           L2/L3 build made from them.
//             square   16*rank + file, a1 = 0, h8 = 119; i & 8 is off the board
//             board    b[] sparse: the 64 squares hold a code, the rest are holes
//             piece    P1 K2 Q3 N4 R5 B6, +8 for White, 0 empty
//             side     t = 8 White, 0 Black
//             e.p.     e = the square, 8 when there is none (8 is a hole)
//             castling c: 1 = K, 2 = Q, 4 = k, 8 = q; C(square) gives its bits
//             legality L(i,u) -> is the move i->u legal (i must be the mover's)
//             move     L(i,u); c &= ~C(i) & ~C(u); e = U(i,u,p); t ^= 8
//             promo    p = 3 queen, 5 rook, 6 bishop, 4 knight
//                      (the DOM builds read it from the global y instead)
//           L(i,u) must run right before U(i,u) for the same move: while
//           checking a castling move it stores the rook's square, and U takes
//           the rook from there. The castling mask and the e.p. square are
//           written by the engine's full move M(), which perft does not use, so
//           the harness writes them; U() returns the e.p. square of every
//           double step, legal capture or not, which perft does not mind.
//
//   string  engine_string.js and the string-board builds.
//             square   a8 = 0, h1 = 63
//             board    b[] holds the FEN letter itself, '-' is empty
//             side     t = 1 White, 0 Black;  e.p. e = the square, '-' for none
//             legality L(i) -> the legal destinations of the piece on i
//             move     c &= ~C(i) & ~C(u); M(i,u,'q'); t ^= 1   (M writes e and n)
//
// The engine is loaded as a bare core: no driver, no DOM, no prompt loop.
// =====================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

// Engine selection. Four engines can run this suite:
//
//   1  engine_4x.js                speed build, 0x88 board (+118 B, ~3.5x faster move generation)
//   2  engine.js                   byte-record build, 0x88 board, full FIDE
//   3  engine_onlyMoveGenerator.js move generation only: engine.js up to M(), counters dropped
//   4  engine_string.js            string board: b[] holds FEN letters, '-' is empty
//
// How the engine is chosen, first match wins:
//   ENGINE=path            an explicit file, no prompt
//   --engine=N  /  -e N    one of the four by number, no prompt
//   interactive picker     arrows + Enter, or type 1-4; bare Enter takes 1
//   not a TTY (.bat, pipe) the first of the four present in this folder
//
// The picker draws on stderr and `node test.js pick` prints the chosen path on
// stdout, so a script can ask once and pin the answer for every run that follows:
//   for /f "usebackq delims=" %%e in (`node test.js pick`) do set "ENGINE=%%e"
//   ENGINE=$(node test.js pick)          # sh
const ENGINES = [
  { file: 'engine_4x.js',                what: 'speed build, 0x88 board' },
  { file: 'engine.js',                   what: 'byte-record build, 0x88 board' },
  { file: 'engine_onlyMoveGenerator.js', what: 'move generation only, 0x88 board' },
  { file: 'engine_string.js',            what: 'string board (FEN letters)' },
];
const ENGINE_CANDIDATES = ENGINES.map(e => './' + e.file);
const here = f => path.join(__dirname, f);

function pickEngine(interactive) {
  if (process.env.ENGINE) return process.env.ENGINE;
  const argv = process.argv.slice(2);
  let n = null;
  for (let i = 0; i < argv.length; i++) {
    let m = /^--engine=([1-4])$/.exec(argv[i]);
    if (m) n = +m[1];
    else if (argv[i] === '-e' && /^[1-4]$/.test(argv[i + 1] || '')) n = +argv[++i];
  }
  if (n) return './' + ENGINES[n - 1].file;

  const present = ENGINES.map((e, i) => ({ ...e, i })).filter(e => fs.existsSync(here(e.file)));
  if (!present.length) return './engine.js';
  if (!interactive || !process.stdin.isTTY || !process.stderr.isTTY) return './' + present[0].file;

  let sel = present.findIndex(e => e.i === 0);
  if (sel < 0) sel = 0;
  const H = ENGINES.length + 3;
  const draw = first => {
    if (!first) process.stderr.write(`\x1b[${H}A`);
    process.stderr.write('\n  Which engine?   (arrows + Enter, or type 1-4; Enter alone takes 1)\n');
    ENGINES.forEach((e, i) => {
      const p = present.find(x => x.i === i);
      const cur = p && present[sel].i === i;
      const line = `   ${cur ? '>' : ' '} ${i + 1}  ${e.file.padEnd(28)} ${e.what}` +
                   (p ? '' : '   [not in this folder]');
      process.stderr.write(`\x1b[2K${cur ? '\x1b[1m' : p ? '' : '\x1b[2m'}${line}\x1b[0m\n`);
    });
    process.stderr.write('\n');
  };
  draw(true);
  const buf = Buffer.alloc(8);
  process.stdin.setRawMode(true);
  try {
    for (;;) {
      let k = 0;
      try { k = fs.readSync(0, buf, 0, 8); }
      catch (err) { if (err.code === 'EAGAIN') continue; throw err; }
      const key = buf.slice(0, k).toString('latin1');
      if (key === '\x03' || key === 'q') { process.stderr.write('\n'); process.exit(130); }
      if (key === '\r' || key === '\n') break;
      if (key === '\x1b[A' || key === 'k') { sel = (sel + present.length - 1) % present.length; draw(false); continue; }
      if (key === '\x1b[B' || key === 'j') { sel = (sel + 1) % present.length; draw(false); continue; }
      const d = /^[1-4]$/.test(key) ? +key : 0;          // a wrong key is simply ignored
      if (d) { const p = present.findIndex(x => x.i === d - 1); if (p >= 0) { sel = p; draw(false); } }
    }
  } finally { process.stdin.setRawMode(false); }
  return './' + present[sel].file;
}

let ENGINE_FILE = './engine.js';        // set from main(); readEngine() reads it at call time

// ============== Board dialects ==============
// Everything the suite does to a square or a piece goes through D, so the perft
// driver, the FEN codec and the move lists are written once.
const PROMOS = ['q', 'r', 'b', 'n'];
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

const X88 = {
  name: '0x88 (P1 K2 Q3 N4 R5 B6, +8 White; t = 8/0; no e.p. = 8)',
  squares: range(0, 120).filter(i => !(i & 8)),
  EMPTY: 0,
  sq: (file, rank) => rank * 16 + file,
  file: i => i & 7,
  rank: i => i >> 4,
  fromFen: ch => ({ p: 1, k: 2, q: 3, n: 4, r: 5, b: 6 })[ch.toLowerCase()] + (ch < 'a' ? 8 : 0),
  toFen: p => { const ch = 'pkqnrb'[(p & 7) - 1]; return p & 8 ? ch.toUpperCase() : ch; },
  empty: p => !p,
  own: (p, t) => p > 0 && (p & 8) === t,
  pawn: p => (p & 7) === 1,
  white: 8, black: 0,
  isWhite: t => t === 8,
  noEp: 8,
  hasEp: e => e !== 8 && e != null,
  castleIn: cr => cr,                    // 1 K, 2 Q, 4 k, 8 q, as in FEN order
  castleOut: c => c,
  targets: (env, i) => X88.squares.filter(u => env.L(i, u)),
  play(env, i, u, q) {
    env.L(i, u);                         // stores the castling rook's square for U
    const p = env.b[i];
    env.n = (p & 7) === 1 || env.b[u] ? 0 : env.n + 1;
    env.c &= ~env.C(i) & ~env.C(u);
    const y = { q: 3, r: 5, b: 6, n: 4 }[q];
    // The engine files take the promotion piece as U's third argument. The DOM
    // builds (L3.html, L3_light.html, L2.html) have no such parameter and read the
    // global y that their promotion panel sets; loadEngine() found out which.
    env.e = env.__promoArg ? env.U(i, u, y) : (env.y = y, env.U(i, u));
    env.t ^= 8;
  },
};

const STR = {
  name: "string (FEN letters, '-' empty; a8 = 0; t = 1/0)",
  squares: range(0, 64),
  EMPTY: '-',
  sq: (file, rank) => (7 - rank) * 8 + file,
  file: i => i & 7,
  rank: i => 7 - (i >> 3),
  fromFen: ch => ch,
  toFen: p => p,
  empty: p => p === '-',
  own: (p, t) => p !== '-' && (p < 'a') === !!t,
  pawn: p => p === 'P' || p === 'p',
  white: 1, black: 0,
  isWhite: t => t === 1,
  noEp: '-',
  hasEp: e => e != null && e !== '-',
  castleIn: cr => cr >> 2 | (cr & 3) << 2,   // a8 = 0 turns the bits round: K=4 Q=8 k=1 q=2
  castleOut: c => c >> 2 | (c & 3) << 2,
  targets: (env, i) => env.L(i),
  play(env, i, u, q) {
    env.c &= ~env.C(i) & ~env.C(u);
    env.M(i, u, q);                        // writes e and n itself; promotion argument is lower case
    env.t ^= 1;
  },
};
let D = X88;      // set by loadEngine() from the board it finds

const sqName = i => String.fromCharCode(97 + D.file(i)) + (D.rank(i) + 1);
const nameSq = s => D.sq(s.charCodeAt(0) - 97, +s[1] - 1);
const lastRank = i => D.rank(i) === 0 || D.rank(i) === 7;

// ============== Engine loading ==============
// Any shipped file can be handed over: a bare engine (.js), a plain build
// (.html / .cjs) or a RegPack-packed build. The script is split into its
// top-level statements and each one is evaluated on its own, in order; a
// statement that needs a DOM, prompt(), stdin or a timer simply throws and is
// skipped. The first loop (a prompt or stdin driver) ends the walk, so no game
// is started. A for…in loop is not a driver: it lays out the starting position.
function readEngine(p = ENGINE_FILE) {
  const full = path.isAbsolute(p) ? p : path.join(__dirname, p);
  if (!fs.existsSync(full)) {
    console.error(`ERROR: engine not found: ${p}`);
    console.error(`Looked next to test.js for, in order:`);
    for (const cand of ENGINE_CANDIDATES) console.error(`  ${cand.slice(2)}`);
    console.error(`Put one of them here, or set ENGINE=path`);
    process.exit(1);
  }
  let src = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  // Accept an .html wrapper too, so a shipped build can be tested directly.
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (m) src = m[1];
  // A RegPack build hands back its own source when eval(_) is captured.
  if (/eval\(_\)\s*$/.test(src)) {
    const box = {};
    vm.createContext(box);
    vm.runInContext(src.replace(/eval\(_\)\s*$/, '__src=_'), box);
    src = box.__src;
  }
  return src;
}

// Top-level statements, split on commas and semicolons outside brackets,
// strings, template literals and regex literals.
function splitTop(js) {
  const out = [], st = [];
  let cur = '';
  for (let i = 0; i < js.length; i++) {
    const ch = js[i], top = st[st.length - 1];
    if (top === "'" || top === '"') { cur += ch; if (ch === '\\') { cur += js[++i]; continue; } if (ch === top) st.pop(); continue; }
    if (top === '`') { cur += ch; if (ch === '\\') { cur += js[++i]; continue; } if (ch === '`') st.pop(); else if (ch === '$' && js[i + 1] === '{') { cur += js[++i]; st.push('${'); } continue; }
    if (ch === "'" || ch === '"' || ch === '`') { st.push(ch); cur += ch; continue; }
    if (ch === '/' && js[i + 1] !== '/' && /[=(,:?&|!;{}[]$/.test(cur.trimEnd())) {
      let j = i + 1, cls = 0;
      while (j < js.length) { if (js[j] === '\\') { j += 2; continue; } if (js[j] === '[') cls = 1; else if (js[j] === ']') cls = 0; else if (js[j] === '/' && !cls) break; j++; }
      j++; while (/[a-z]/.test(js[j] || '')) j++;
      cur += js.slice(i, j); i = j - 1; continue;
    }
    if ('([{'.includes(ch)) st.push(ch);
    else if (')]}'.includes(ch)) st.pop();
    if (!st.length && (ch === ',' || ch === ';')) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function loadEngine(p = ENGINE_FILE) {
  const src = readEngine(p);
  const quiet = { log() {}, error() {}, warn() {} };
  const sb = { Math, String, Number, Array, Object, JSON, BigInt, Date, console: quiet };
  vm.createContext(sb);
  let loaded = 0;
  for (const stmt of splitTop(src)) {
    if (/^\s*(for|while)\s*\((?!\w+ in )/.test(stmt)) break;   // a driver loop begins; for(j in …) only lays out the board
    try { vm.runInContext(stmt, sb); loaded++; }
    catch (e) {
      // An interface statement fails when it runs (there is no DOM here).
      // A statement that does not even parse is a broken definition, never an
      // interface line, and is reported.
      if (e && e.name === 'SyntaxError') {
        console.error(`ERROR: a statement does not parse: ${stmt.trim().slice(0, 60)}...`);
        console.error(`  ${e.message}`);
        process.exit(1);
      }
    }
  }
  if (!loaded) {
    console.error('ERROR: engine failed to load: no statement could be evaluated');
    process.exit(1);
  }
  if (!Array.isArray(sb.b)) {
    console.error('ERROR: no board b[] after loading');
    process.exit(1);
  }
  // The board tells us which dialect to speak.
  if (typeof sb.b[0] === 'string') D = STR;
  else if (sb.b.length === 120) D = X88;
  else {
    console.error(`ERROR: a ${sb.b.length}-square numeric board is not a dialect this suite speaks (0x88 or string board)`);
    process.exit(1);
  }
  // Only what the suite actually calls. The raw move is U() on the 0x88 board
  // and M() on the string board; on the 0x88 board M() is the full move, which
  // also flips the side and writes the counters, so it must never stand in for U().
  for (const fn of D === X88 ? ['L', 'U', 'C', 'G'] : ['L', 'M', 'C', 'G']) {
    if (typeof sb[fn] !== 'function') {
      console.error(`ERROR: engine is missing ${fn}()` +
        (fn === 'C' ? ' — L1 builds keep castling in a touched-squares ledger and are not supported' : '') +
        (fn === 'U' && typeof sb.M === 'function' ? ' — an 0x88 build with the old names (raw move M)? This suite speaks the new names' : ''));
      process.exit(1);
    }
  }
  if (D === STR && !Array.isArray(sb.L(12))) {
    console.error('ERROR: string board, but L(i) does not return a move list');
    process.exit(1);
  }
  // A full move generator never lets a piece take its own side. Some light
  // builds leave that to their UI (a click on an own piece selects it), so their
  // L() is not a complete legality test: a1 rook to b1 must be refused.
  if (D === X88 && sb.L(0, 1)) {
    console.error('ERROR: L() accepts a capture of an own piece — this build filters that in its UI and is not a full move generator');
    process.exit(1);
  }
  // How U() takes the promotion piece: a white pawn on a7 goes to a8 with 4
  // (knight) as the argument and 6 (bishop) in the global y.
  if (D === X88) {
    const save = [sb.b, sb.t, sb.e, sb.y];
    sb.b = []; for (const i of X88.squares) sb.b[i] = 0;
    sb.b[96] = 9; sb.t = 8; sb.e = 8; sb.y = 6;
    sb.U(96, 112, 4);
    sb.__promoArg = sb.b[112] === 12;
    [sb.b, sb.t, sb.e, sb.y] = save;
  }
  sb.__src = src;
  return sb;
}

// ============== FEN <-> engine state ==============
function setFEN(env, fen) {
  const [pieces, side, castling, ep, halfmove] = fen.trim().split(/\s+/);
  const board = [];
  for (const i of D.squares) board[i] = D.EMPTY;      // 0x88: the off-board squares stay holes
  const ranks = pieces.split('/');
  if (ranks.length !== 8) throw new Error('bad FEN board: ' + pieces);
  ranks.forEach((row, k) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += +ch; continue; }
      if (!/^[pnbrqkPNBRQK]$/.test(ch)) throw new Error('bad FEN piece: ' + ch);
      board[D.sq(file++, 7 - k)] = D.fromFen(ch);
    }
  });
  env.b = board;
  env.t = side === 'w' ? D.white : D.black;
  let cr = 0;
  if (castling && castling !== '-') {
    if (castling.includes('K')) cr |= 1;
    if (castling.includes('Q')) cr |= 2;
    if (castling.includes('k')) cr |= 4;
    if (castling.includes('q')) cr |= 8;
  }
  env.c = D.castleIn(cr);
  env.e = (!ep || ep === '-') ? D.noEp : nameSq(ep);
  env.n = halfmove ? +halfmove : 0;
}

function envToFEN(env) {
  let pieces = '';
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = env.b[D.sq(f, r)];
      if (D.empty(p)) empty++;
      else { if (empty) { row += empty; empty = 0; } row += D.toFen(p); }
    }
    if (empty) row += empty;
    pieces += (r < 7 ? '/' : '') + row;
  }
  let castling = '';
  const c = D.castleOut(env.c);
  if (c & 1) castling += 'K';
  if (c & 2) castling += 'Q';
  if (c & 4) castling += 'k';
  if (c & 8) castling += 'q';
  if (!castling) castling = '-';
  const ep = D.hasEp(env.e) ? sqName(env.e) : '-';
  return `${pieces} ${D.isWhite(env.t) ? 'w' : 'b'} ${castling} ${ep} ${env.n} 1`;
}

// ============== Moves and perft ==============
// L() gives fully legal moves, so no legality filter is needed here.
// Promotions are expanded to four moves, as perft requires.
const snap = env => ({ b: env.b.slice(), c: env.c, e: env.e, n: env.n, t: env.t });
const restore = (env, st) => { env.b = st.b; env.c = st.c; env.e = st.e; env.n = st.n; env.t = st.t; };

// Every legal move of the side to move as [from, to, promo], promo '' or q/r/b/n.
function moveList(env) {
  const out = [];
  for (const i of D.squares) {
    const p = env.b[i];
    if (!D.own(p, env.t)) continue;
    const promo = D.pawn(p);
    for (const u of D.targets(env, i)) {
      if (promo && lastRank(u)) for (const q of PROMOS) out.push([i, u, q]);
      else out.push([i, u, '']);
    }
  }
  return out;
}

function makePerft(env) {
  function perft(depth) {
    if (depth === 0) return 1;
    const moves = moveList(env);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const [i, u, q] of moves) {
      const st = snap(env);
      D.play(env, i, u, q || 'q');
      nodes += perft(depth - 1);
      restore(env, st);
    }
    return nodes;
  }
  return perft;
}

function legalMoves(env) {
  return moveList(env).map(([i, u, q]) => sqName(i) + sqName(u) + q).sort();
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

// Which rung of the ladder is running, so a run on a lower level is never
// mistaken for a run on the full engine.
const LEVELS = {
  './engine_4x.js': 'full FIDE, speed build, 0x88 board',
  './engine.js': 'full FIDE, byte-record build, 0x88 board',
  './engine_onlyMoveGenerator.js': 'move generation only, 0x88 board',
  './engine_string.js': 'full FIDE, string board (FEN letters)',
};

function banner() {
  const src = readEngine();
  const level = LEVELS[ENGINE_FILE];
  const skipped = ENGINE_CANDIDATES.slice(0, ENGINE_CANDIDATES.indexOf(ENGINE_FILE))
    .filter(p => !fs.existsSync(here(p.slice(2)))).length;
  console.log(`\nEngine: ${ENGINE_FILE}  (${Buffer.byteLength(src, 'utf8')} B of core)`
    + (level ? `\n        ${level}` : '')
    + (skipped ? `  [${skipped} higher level(s) not in this folder]` : ''));
  return src;
}

// ============== Command: detect ==============
// What each name means in each dialect. Only L, C, G and the raw move (U on the
// 0x88 board, M on the string board) are ever called.
const API = {
  x88: [['L', 'legality of one move L(i,u)'], ['U', 'apply a move on a board copy'], ['C', 'castling bits of a square'],
        ['G', 'geometry'], ['T', 'check / square attacked'], ['M', 'full move'], ['O', 'legal-move walker'],
        ['V', 'mate-ability, dead position (5.2.2)'], ['H', 'FIDE 6.9 search'], ['Z', 'result code'],
        ['D', 'draw offer / claim'], ['F', 'flag / resign'], ['A', 'play a move with its verdict']],
  string: [['L', 'legal destinations L(i)'], ['M', 'apply a move (writes e and n, not t)'], ['X', 'apply a move on a board copy'],
           ['C', 'castling bits of a square'], ['G', 'geometry'], ['T', 'check / square attacked'],
           ['O', 'legal-move walker'], ['V', 'mate-ability, dead position (5.2.2)'], ['H', 'FIDE 6.9 search'],
           ['Z', 'result code'], ['D', 'draw offer / claim'], ['F', 'flag / resign'], ['A', 'play a move with its verdict']],
};

function cmdDetect() {
  banner();
  const env = loadEngine();
  console.log(`\n  API present:`);
  for (const [fn, what] of API[D === X88 ? 'x88' : 'string']) {
    console.log(`    ${typeof env[fn] === 'function' ? '+' : '-'} ${fn.padEnd(2)} ${what}`);
  }
  console.log(`\n  dialect: ${D.name}`);
  console.log(`  initial state: c=${env.c} t=${env.t} e=${JSON.stringify(env.e)}`);
  // Castling bit semantics, checked rather than assumed.
  const bits = ['a1', 'e1', 'h1', 'a8', 'e8', 'h8'].map(s => `${s}=${env.C(nameSq(s))}`).join(' ');
  console.log(`  castling bits: ${bits}`);
  console.log(`  board: ${env.b.length} slots, ${D.squares.length} squares, a1=${JSON.stringify(env.b[nameSq('a1')])} h8=${JSON.stringify(env.b[nameSq('h8')])}`);
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
    console.log(`  ${name}: ${fmt(got)} ${ok ? '✓' : '✗ expected ' + fmt(exp)}`);
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
      console.log(`  d${d}: ${fmt(got)} ${ok ? '✓' : '✗ expected ' + fmt(exp)} (${secs}s)`);
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
  console.log(`  ${fmt(got)} ${ok ? '✓ [published ✓]' : '✗ expected ' + fmt(exp)} (${secs}s)\n`);
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
  console.log(`  engine:    ${fmt(got)} (${secs}s)`);
  console.log(`  Stockfish: ${sf == null ? '(failed)' : fmt(sf)}  ${ok ? 'SF=' + fmt(sf) + ' ✓' : '✗'}\n`);
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
  let total = 0;
  const out = [];
  for (const [i, u, q] of moveList(env)) {
    const st = snap(env);
    D.play(env, i, u, q || 'q');
    const sub = d > 1 ? perft(d - 1) : 1;
    restore(env, st);
    out.push(`${sqName(i)}${sqName(u)}${q}: ${sub}`);
    total += sub;
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
      // reference implementation (ref.js) and agree with the engine. Labelled honestly.
      const tag = d >= 4 ? '[published ✓]' : '[ref ✓]';
      line += ok ? ` ✓ ${tag}` : ` ✗ expected ${fmt(exp)}`;
    } else {
      const sf = useSF ? sfPerft(pos.fen, d) : null;
      if (sf != null) { ok = got === sf; line += ok ? ` SF=${fmt(sf)} ✓` : ` ✗ SF=${fmt(sf)}`; }
      else line += ' (no reference)';
    }
    if (useSF && exp != null) {
      const sf = sfPerft(pos.fen, d);
      if (sf != null && sf !== got) { ok = false; line += ` ✗ SF=${fmt(sf)}`; }
      else if (sf != null) line += ` SF=${fmt(sf)} ✓`;
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
  const file = process.env.VAJOLET || here('vajolet_perft.txt');
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
      if (got === exp) { pass++; row += `d${d}✓ `; }
      else { fail++; bad = true; row += `d${d}✗(${fmt(got)}≠${fmt(exp)}) `; }
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
      D.play(env, nameSq(choice.slice(0, 2)), nameSq(choice.slice(2, 4)), choice[4] || 'q');
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
  if (fs.existsSync(process.env.VAJOLET || here('vajolet_perft.txt'))) results.push(['vajolet 20 d3', cmdVajolet(20, 3)]);
  console.log('=========================');
  for (const [n, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${n}`);
  const bad = results.filter(r => !r[1]).length;
  console.log(`=========================\n${bad ? bad + ' SUITE(S) FAILED' : 'ALL PASSED'}\n`);
  return bad === 0;
}

// ============== main ==============
// Engine flags (--engine=N, -e N) may stand anywhere; they are not command arguments.
const argv = process.argv.slice(2).filter((a, i, all) => !/^--engine=/.test(a) && a !== '-e' && all[i - 1] !== '-e');
const [cmd, ...args] = argv;
const USAGE = `
FideLite test suite

  node test.js detect                        report dialect / API / castling bits / Stockfish
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
  node test.js pick                          ask once, print the chosen engine path

Engine: a picker appears when a command is given. Skip it with
  ENGINE=./engine_string.js node test.js sanity
  node test.js sanity --engine=3            (1 4x, 2 engine, 3 movegen, 4 string)

A script that runs several commands should ask once and pin the answer:
  for /f "usebackq delims=" %%e in (\`node test.js pick\`) do set "ENGINE=%%e"
`;

ENGINE_FILE = pickEngine(!!cmd && cmd !== 'help' && cmd !== '--help');

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
  case 'pick': process.stdout.write(ENGINE_FILE + '\n'); break;
  default: console.log(USAGE);
}
process.exit(okExit ? 0 : 1);
