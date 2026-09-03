// Independent, deliberately naive chess implementation used ONLY to generate
// reference perft values where no published number exists and Stockfish is
// absent. Written from the rules directly, sharing no code with newengine, so
// agreement between the two is real evidence rather than a shared bug.
// 0x88 board, a1 = 0.

const EMPTY = 0;
// piece: {t: type char, c: 'w'|'b'}
function parseFEN(fen) {
  const [pieces, side, castling, ep] = fen.trim().split(/\s+/);
  const bd = new Array(128).fill(null);
  let r = 7, f = 0;
  for (const ch of pieces) {
    if (ch === '/') { r--; f = 0; continue; }
    if (/\d/.test(ch)) { f += +ch; continue; }
    bd[r * 16 + f] = { t: ch.toLowerCase(), c: ch === ch.toUpperCase() ? 'w' : 'b' };
    f++;
  }
  return {
    bd, side: side === 'w' ? 'w' : 'b',
    cast: {
      K: !!(castling && castling.includes('K')), Q: !!(castling && castling.includes('Q')),
      k: !!(castling && castling.includes('k')), q: !!(castling && castling.includes('q')),
    },
    ep: (!ep || ep === '-') ? -1 : ((+ep[1] - 1) * 16 + (ep.charCodeAt(0) - 97)),
  };
}

const onBoard = s => (s & 0x88) === 0;
const DIRS = {
  n: [33, 31, 18, 14, -33, -31, -18, -14],
  b: [17, 15, -17, -15],
  r: [16, -16, 1, -1],
  q: [17, 15, -17, -15, 16, -16, 1, -1],
  k: [17, 15, -17, -15, 16, -16, 1, -1],
};

function attacked(st, sq, byColor) {
  for (let s = 0; s < 128; s++) {
    if (!onBoard(s)) continue;
    const p = st.bd[s];
    if (!p || p.c !== byColor) continue;
    if (p.t === 'p') {
      const dir = p.c === 'w' ? 16 : -16;
      if (s + dir + 1 === sq || s + dir - 1 === sq) return true;
      continue;
    }
    if (p.t === 'n' || p.t === 'k') {
      for (const d of DIRS[p.t === 'n' ? 'n' : 'k']) if (s + d === sq) return true;
      continue;
    }
    for (const d of DIRS[p.t]) {
      let t = s + d;
      while (onBoard(t)) {
        if (t === sq) return true;
        if (st.bd[t]) break;
        t += d;
      }
    }
  }
  return false;
}

function kingSq(st, c) {
  for (let s = 0; s < 128; s++) if (onBoard(s) && st.bd[s] && st.bd[s].t === 'k' && st.bd[s].c === c) return s;
  return -1;
}

function clone(st) {
  return { bd: st.bd.slice(), side: st.side, cast: { ...st.cast }, ep: st.ep };
}

// Pseudo-legal generation, then filter by king safety.
function genMoves(st) {
  const out = [];
  const me = st.side, opp = me === 'w' ? 'b' : 'w';
  for (let s = 0; s < 128; s++) {
    if (!onBoard(s)) continue;
    const p = st.bd[s];
    if (!p || p.c !== me) continue;
    if (p.t === 'p') {
      const dir = me === 'w' ? 16 : -16;
      const startRank = me === 'w' ? 1 : 6;
      const lastRank = me === 'w' ? 7 : 0;
      const one = s + dir;
      if (onBoard(one) && !st.bd[one]) {
        if ((one >> 4) === lastRank) for (const q of ['q', 'r', 'b', 'n']) out.push({ from: s, to: one, promo: q });
        else {
          out.push({ from: s, to: one });
          const two = s + 2 * dir;
          if ((s >> 4) === startRank && !st.bd[two]) out.push({ from: s, to: two, dbl: true });
        }
      }
      for (const dc of [1, -1]) {
        const t = s + dir + dc;
        if (!onBoard(t)) continue;
        if (st.bd[t] && st.bd[t].c === opp) {
          if ((t >> 4) === lastRank) for (const q of ['q', 'r', 'b', 'n']) out.push({ from: s, to: t, promo: q });
          else out.push({ from: s, to: t });
        } else if (t === st.ep && st.ep >= 0) out.push({ from: s, to: t, epCap: true });
      }
      continue;
    }
    if (p.t === 'n' || p.t === 'k') {
      for (const d of DIRS[p.t === 'n' ? 'n' : 'k']) {
        const t = s + d;
        if (!onBoard(t)) continue;
        if (st.bd[t] && st.bd[t].c === me) continue;
        out.push({ from: s, to: t });
      }
      if (p.t === 'k') {
        const rank = me === 'w' ? 0 : 7;
        if (s === rank * 16 + 4) {
          const kSide = me === 'w' ? st.cast.K : st.cast.k;
          const qSide = me === 'w' ? st.cast.Q : st.cast.q;
          const rk = st.bd[rank * 16 + 7], rq = st.bd[rank * 16 + 0];
          if (kSide && rk && rk.t === 'r' && rk.c === me &&
            !st.bd[rank * 16 + 5] && !st.bd[rank * 16 + 6] &&
            !attacked(st, rank * 16 + 4, opp) && !attacked(st, rank * 16 + 5, opp) && !attacked(st, rank * 16 + 6, opp))
            out.push({ from: s, to: rank * 16 + 6, castle: 'K' });
          if (qSide && rq && rq.t === 'r' && rq.c === me &&
            !st.bd[rank * 16 + 1] && !st.bd[rank * 16 + 2] && !st.bd[rank * 16 + 3] &&
            !attacked(st, rank * 16 + 4, opp) && !attacked(st, rank * 16 + 3, opp) && !attacked(st, rank * 16 + 2, opp))
            out.push({ from: s, to: rank * 16 + 2, castle: 'Q' });
        }
      }
      continue;
    }
    for (const d of DIRS[p.t]) {
      let t = s + d;
      while (onBoard(t)) {
        if (st.bd[t]) { if (st.bd[t].c === opp) out.push({ from: s, to: t }); break; }
        out.push({ from: s, to: t });
        t += d;
      }
    }
  }
  // legality filter
  const legal = [];
  for (const m of out) {
    const nx = apply(st, m);
    if (!attacked(nx, kingSq(nx, me), me === 'w' ? 'b' : 'w')) legal.push(m);
  }
  return legal;
}

function apply(st, m) {
  const nx = clone(st);
  const p = nx.bd[m.from];
  const me = p.c;
  nx.bd[m.to] = m.promo ? { t: m.promo, c: me } : p;
  nx.bd[m.from] = null;
  if (m.epCap) nx.bd[m.to + (me === 'w' ? -16 : 16)] = null;
  if (m.castle === 'K') { const rank = (m.from >> 4); nx.bd[rank * 16 + 5] = nx.bd[rank * 16 + 7]; nx.bd[rank * 16 + 7] = null; }
  if (m.castle === 'Q') { const rank = (m.from >> 4); nx.bd[rank * 16 + 3] = nx.bd[rank * 16 + 0]; nx.bd[rank * 16 + 0] = null; }
  nx.ep = m.dbl ? (m.from + (me === 'w' ? 16 : -16)) : -1;
  // castling rights
  if (p.t === 'k') { if (me === 'w') { nx.cast.K = nx.cast.Q = false; } else { nx.cast.k = nx.cast.q = false; } }
  for (const [sq, key] of [[0, 'Q'], [7, 'K'], [112, 'q'], [119, 'k']]) {
    if (m.from === sq || m.to === sq) nx.cast[key] = false;
  }
  nx.side = me === 'w' ? 'b' : 'w';
  return nx;
}

function perft(st, depth) {
  if (depth === 0) return 1;
  const moves = genMoves(st);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(apply(st, m), depth - 1);
  return n;
}

module.exports = { parseFEN, perft, genMoves, apply };

if (require.main === module) {
  const fen = process.argv[2], d = +process.argv[3];
  console.log(perft(parseFEN(fen), d));
}
