# FideLite

**FideLite is a generator for tiny, self-contained chess engines.** A single web page (`index.html`) emits standalone, single-`<script>` HTML files — each one a complete two-player chess game in roughly **0.6–2.7 KB**. Open an emitted file in any browser and you have a working board. At its fullest (the default **L5** rules level) each engine is **100% FIDE-legal**: standard chess **and** Chess960, four clock systems, multi-period time controls, three interfaces, en passant, threefold/fivefold repetition, the 50- and 75-move rules, insufficient-material draws, automatic draw detection, draw offers with an optional per-side offer cooldown, and a choice of **FIDE or USCF** game-result rules (move legality is FIDE in both; only the timeout / resign / auto-draw *adjudication* changes).

A second axis, **Chesseus**, dials the rules *down* from that full set. Levels **L5 → L0** progressively strip rules — resign/draw-offer, insufficient-material, repetition, the clock, the 50-move rule, castling, en passant, promotion choice, and finally check detection itself — each level a strictly smaller, still-playable engine, bottoming out at a ~0.9 KB "capture-the-king" variant with no check at all. **L5 is the FIDE-complete reference; the lower levels are deliberate simplifications.**

Sitting between L5 and L4 on that same axis is **Armageddon**, which is not a simplification but a *format*: Black has draw odds, so a draw is scored as a Black win. That single re-scoring lets the engine stop the moment White can no longer win, which turns out to make it **smaller** than L5 rather than larger.

The generator is itself a small two-tab website: an **Introduction** that explains how the engines work (an annotated, interactive exhibit) and a **Generator** that lets you pick options, preview, and download an engine.

This document describes the architecture, the engine internals, the option axes, and the optimization rules that govern the emitted engine. It is a reference for anyone reading or contributing to the project. It also carries the **player-facing [Number notation](#number-notation--reading-and-playing-an-emitted-engine) reference** — how to read and play an engine built in Number encoding — folded in as its own section rather than a separate file.

---

## At a glance

- **Output:** standalone HTML chess engines, ~0.6–2.7 KB each (a full-rules L5 text UI ~1.65–1.93 KB — Number is the small end, Letter the large, and Number-`prompt` is the smallest of the four at ~1.65 KB; the L5 clickable board ~2.40–2.64 KB; the smallest L0 variant ~0.63 KB).
- **Rules:** complete FIDE legality at **L5** (standard + Chess960, all 960 positions). A **FIDE / USCF rule-set axis** switches only the game-result logic (timeout, resign, and the automatic repetition / move-rule draws). A separate **Chesseus** axis (L5 → **Armageddon** → L4 → L0) dials the *whole* rule set down in fixed steps; Armageddon is the one rung that changes the *scoring* rather than removing a rule.
- **Clocks:** sudden death, Fischer increment, Bronstein delay, simple delay; plus multi-period controls (up to three periods / two boundaries). (Simple delay is not offered on the `prompt` interface at L3 and above — prompt's elapsed model makes it behave identically to Bronstein, so the Generator locks it and falls back there.) Every clock quantity can be set **per side** — starting time, increment/delay, each period's block-add and increment, and the draw-claim limit — each behind its own "same for both" checkbox that is *checked by default*, so a symmetric control emits byte-identical output to before.
- **Interfaces:** typed text field, `prompt()` loop, or a clickable DOM board; each with **Indicators** / strict / blindfold info level, optional board rotation, and a **Letter / Number board encoding** switch (Number stores the position as a bitfield of small integers rather than piece letters, printed one hex digit per square — a pure size win, ~170–220 B, on every interface and info level; see [Number notation](#number-notation--reading-and-playing-an-emitted-engine) for how to read and play one, and the numeric-bitfield section for how it shrinks). (Strict is offered at L3 and above only; L2 and below expose Indicators / blindfold.)
- **Players:** two-player by default, or a Black-playing bot on a **ladder**: **`R`** plays a uniformly-random *legal* move, and **`B1`–`B5`** run one alpha-beta search whose evaluation gains a term per rung (material → centre control → king safety → pawn advancement → doubled pawns). Every rung drives the engine's own generator `G()`, so pins, check evasion, castling, en passant and promotion are correct for free. **Search depth is a separate axis (1–4 plies)**, independent of the rung — the rung decides what the bot values, the depth decides how far it looks. The whole ladder ships on **all three interfaces**, **both notations** and at **every level** (R +79…+93 B; B1 +413…+513 B rising to B5 +536…+636 B; depth costs nothing, it is one digit). A search bot pays for its own thinking time on its own clock. With `bot:"off"` every engine is **byte-identical** to the pre-bot output.
- **Byte budget:** only the *emitted engine* is byte-critical. The generator page itself is not size-constrained.
- **Two download buttons:** the plain **Download** (the human-readable emitted engine) and a **RegPacked** button that runs the same engine through the [RegPack](https://github.com/Siorki/RegPack) self-extracting compressor and saves a smaller, functionally-identical build. The RegPacked path is a pure size win layered *on top of* the engine — it never changes the plain download or the engine's behaviour.

---

## Architecture: two layers

Everything in the project flows from one distinction:

1. **The emitted engine — byte-critical.** Aggressively golfed; every byte is fought for. At a fixed rules level the core (move generation, legality, make-move, draw detection) is byte-identical across all variants — the colour-threshold token is one letter (`u`), so the move-engine functions `I/S/f/L/J/G/M` are the same bytes in every interface, notation mode, **and rule set (FIDE or USCF)**. Variants differ only along a few option axes: the FIDE↔USCF axis changes *only* the game-result fragments (and drops the can't-mate helper `Q`, which is FIDE-only — though **Armageddon-FIDE** uses the same logic *inlined*, since it has exactly one call site); the **Chesseus** rules-level axis is the one that reshapes the core itself — each level down *removes* mechanisms, so "byte-identical core" holds **within** a level, not across levels.

2. **The generator (`index.html`) — not byte-critical.** A readable factory plus the website. Inside the file, a marker comment splits the two worlds:

   ```
   /* ===================== UI wiring ===================== */
   ```

   - **Before** the marker: `build()` and `castle960()` — the code that determines *emitted-engine bytes*. Edit here to change the engines.
   - **After** the marker: the website UI (tabs, controls, FEN editor, exhibit). Editing it never changes an emitted engine.
   - The marker is also **load-bearing for the test harness** (which splits the file on it). Keep it.

### The `mc` → `B` placeholder convention

Inside `build()`, the period-hook fragments are written using a two-letter placeholder **`mc`**. **`mc` never appears in an emitted engine.** Immediately before assembly, a single pass rewrites every `mc` to the one-letter **`B`** (the universal ply counter):

```js
script = script.replace(/\bmc\b/g, "B");   // counted/blind: mc=0 → B=0, mc++ → B++, mc+T → B+T
```

The placeholder exists purely so the generator can distinguish two build-time cases cleanly. In **strict** notation the history already increments `B` (the displayed move number, `++B`) once per ply *before* the hook runs, so the hook must not increment again; strict therefore drops the folded increment (`++mc` → `mc`) so the counter advances exactly once. In **counted/blindfold** there is no history counter, so the hook keeps its own increment (`mc++`/`++mc` → `B++`/`++B`). Writing the fragments in `mc` and resolving to `B` at the end keeps that strict-vs-counted split in one place. Every generated engine uses the single one-letter `B`; `mc` is a generator-internal name only.

---

## How one generator makes the variants

`build(o)` takes an options object and **assembles an engine from string fragments**, picking fragments per option: the shared core + per-axis fragments (interface driver, clock tick, per-move time hook, result handling) + (for 960) the castling clauses. It returns `<script>…</script>` (plus a minimal `<body>` for the text-input UI). Because the core fragments are shared, a single core edit propagates to every variant at once.

| Option (`o.*`) | Values | What it changes |
|---|---|---|
| `ui` | `input` / `prompt` / `dom` | how a move's `(from,to)` is obtained: text field + Enter / a `prompt()` loop / a clickable board. On `dom` + `counted`, selecting a piece paints its legal destinations `#c91` (the list is `G()`, so at L0 — which has no check concept — that includes moves into capture); `strict` omits the paint, since its move list already says the same thing. **All three funnel into the same make-move `M`** — only acquisition differs. |
| `info` | `counted` / `strict` / `blindfold` | **display only** — *Indicators* (`counted`) = the status indicators (on `dom` `D?` and `C!` are independent and can show together; on `input`/`prompt` they share one slot with `D?` winning) + move number + repetition count; *strict* = a FIDE move list (no counters); *blindfold* = no board (input only). The draw **claim/offer logic is identical across all three** — only the presentation differs. **Strict is dropped at L2 and below**: both the UI and `build()` fall back to Indicators. The internal value name stays `counted`; the on-screen label is **Indicators**. |
| `time` | `sudden` / `fischer` / `bronstein` / `simpledelay` | clock model. Lives in the per-move time hook and the 1-second tick. (The **DOM** clock readout is formatted at build time by the larger starting time — `≤60 s` raw seconds (`45s`), `≤3600 s` `M:SS` (`9:03`, padded seconds), else `HH:MM:SS` (`01:01:03`); the text UIs always show raw seconds.) |
| `rules` | `std` / `960` | standard or Chess960. 960 swaps the board, the rook→castle-bit map `R`, and the castling clauses. |
| `rot` | boolean | rotate the board for the side to move. |
| `inc`, `periods` | number / array | increment/delay seconds and multi-period controls (e.g. 40 moves → +time). Up to three periods (two boundaries). **Boundaries are cumulative move numbers and must strictly increase** — period 3 begins at least one move after period 2. The Generator drives period 3's spinner `min` from period 2's current value (and pulls the field up if it is already lower), and `build()` clamps the same invariant for programmatic callers, raising a bad threshold rather than re-sorting so period N stays period N. Without it the two thresholds are independent and both failure modes are silent: **equal** values fire *both* bonuses on the same move (and drop the merge path, which requires distinct boundaries), while an **inverted** value makes "period 3" arrive before "period 2". The emitted engines are not at fault in either case — they faithfully test whatever `mc+T-2*at` they are handed. **`build()` takes every time in SECONDS**, but the Generator's *display* units differ by kind: the base clocks (`wt`/`bt`) and the per-period **block bonus** (`add`) are entered in **minutes** on a shared ladder (`1/4, 1/2, 3/4, 1, 2, … 1666`; the bonus fields also allow **0** — that is how you say *"this period adds no time, only a different increment"*), while the **increment** stays in **seconds** because it is a per-move trickle, typically 2–30 s, where minutes would be the wrong unit. `minToSec()` converts on the way into `build()`; no engine bytes change either way. |
| `arr` | back-rank string | the 960 arrangement, e.g. `"RNBQKBNR"`. |
| `wt`, `bt` (Armageddon) | seconds | **Draw odds are paid for on the clock.** At Armageddon — and only there — the generator enforces **`wt ≥ bt + 60`**: White, who must win, always starts with at least a one-minute edge. Default **5\|4** (300/240) in *both* rule sets; the ordinary symmetric **10\|10** returns the moment you leave the level. It is a **bound, not a clamp** — editing one field never drags the other, it just stops dead at the limit the *other* field currently sets (White's floor = `bt+60`, Black's ceiling = `wt−60`). The gap may open as wide as you like above that (`1666\|1` is legal); only *closing* it is refused. **"Same time for both" is definitionally `wt===bt`, which draw odds forbid** — it is force-unchecked and greyed for the level, and its L5 state is restored on the way out. `opts()` re-checks the invariant as a last line of defence (a hand-edited field would otherwise hand build() an Armageddon engine where Black wins draws *and* has more time). **Engine cost: +4 B** — asymmetric clocks break `build()`'s `U=N=` chain (`U=N=6E2` → `U=3E2,N=240`), which is inherent to the concept, not a leak. |
| `fen`, `drawEvery` | — | start FEN and the **draw-offer cooldown** (in full moves). **`drawEvery = 1` = off** (engine byte-identical to no-cooldown); any other value arms a **per-side** cooldown: after a side makes a draw *offer* it must wait `drawEvery` full moves before offering again. **Claims (50-move / threefold) and *accepting* an offer are never throttled** — only re-offering is. **A slot is spent when the offer is PRESENTED, not when it is typed:** the cooldown is armed in the offer branch under `W^T&&e&2-W`, i.e. only if the offer is still standing *and* the same input carried a legal move that flipped the turn. Opening an offer and toggling it back off, or attaching a `=` to an invalid move, costs nothing — the opponent never saw it. This matters most in Number, where the trigger is `i!=+i` (`isNaN(i)` spelled out) and so every mistyped move would otherwise be an offer toggle that burned a slot. When multi-period is on, the cooldown reuses the period ply-counter `B` instead of its own countdown. **Only meaningful at L5** — draw offers exist only there (Armageddon drops them because a draw is already a Black win; Chesseus drops them at L4), so at Armageddon and below `drawEvery` is inert. The control lives under **Rules**. |
| `fed` | `fide` / `uscf` | **rule set** — `fide` (default) or USCF. Changes **only the game-result logic**; the move engine (`I/S/f/L/J/G/M`) is byte-identical. USCF: (1) the repetition / move-rule counters still increment so `3R`/`50` **claims** work, but the **automatic** `5R`/`75` draws are dropped; (2) **resign always loses** (no can't-mate `RM` gate); (3) flag-fall uses a **material** test (USCF Rule 14E) instead of the FIDE helpmate test, so `Q` is omitted entirely. USCF engines are ~80 B **smaller**. |
| `chesseus` | `L5` … `L0` | **rules-level axis** — how much of the rule set the engine implements. `L5` (default) = full FIDE. Each step down removes a fixed group of rules and yields a strictly smaller engine (L5 ≈ 2.1 KB → L0 ≈ 0.9 KB, text/Indicators). Orthogonal to the other axes, but it *gates* some of them (no strict below L3; no clock axis, and therefore no increment/delay model and no multi-period control, below L3; no federation axis below Armageddon; no draw-offer cooldown below L5; Standard/Chess960 stops mattering to the engine below L2, where there is no castling code at all). |
| `rep` | `1`–`4` | **repetition-count seed** for the opening position — "how many times has this position already occurred". Feeds the `P` map init (`P={[s+T+Y+C]:rep}`) **and** the `R=` readout, so a FEN loaded with `rep:3` shows `R=3` on the very first render. Clamped to `1..4` (L5) / `1..2` (L4); inert at L3 and below (no repetition). Set via the board editor's **Repetition** field. |
| `bot`, `botDepth` | `off` / `R` / `B1`–`B5`, `1`–`4` | **Black AI, on two independent axes.** `bot` picks the **evaluation**: `off` (two-player; output byte-identical to the pre-bot engine), `R` (a random legal move — no evaluation and no search at all), or a search rung `B1`–`B5`, where each rung only *adds* a term to the one below it, so B1 is a strict subset of B2 and so on. `botDepth` picks the **search depth** in plies. It is **clamped** to `1..4` rather than rejected, because depth 0 would evaluate the *current* position and never write `k`/`l` — a bot that costs bytes and never moves, which is the exact failure mode the driver-tail anchoring exists to prevent. The two axes are deliberately orthogonal, and `botDepth` is ignored for `off` and `R` (R does not search), so a stale depth can never change a non-search engine. Any bot forces `rot` off and drops the draw-offer cooldown — see the exclusions below. Costs and internals are in *The bot axis*. |
| `cancelGuard` | boolean | **prompt-only, L2/L1/L0 only.** Wraps the `prompt()` call so a cancelled/closed dialog (`null`) is treated as an empty move and the game continues instead of throwing. Costs +6 B when armed, +0 when off. Surfaced as the *"Cancel keeps playing"* checkbox, shown only for the prompt UI at those levels. **Cancel is handled differently at each end of the level range, and L4/L3 are handled at neither:** at **L5 / Armageddon** the prompt UI always maps a cancelled dialog to a **resignation** (Letter wraps the call, `(prompt(…)??'r')`, +7 B; Number uses the resign test `!i`, since `null` is falsy) because those levels have a resign path for it to mean something. *(Number's `!i` is not prompt-specific — the `input` driver carries the same test, where it is a pure byte win rather than a null guard, since `X.value` is always a string.)* At **L2/L1/L0** there is no resign, so the only options are "keep playing" (this checkbox) or the unguarded throw. At **L4/L3** neither applies: resign is gone but the guard is not offered, so a cancelled prompt still throws. |


### How many distinct engines there are, and where the number comes from

Every combination below emits a **different** engine — the counts are measured by generating
each one and comparing bytes, and there are **zero collisions**: no two reachable option sets
produce the same output.

| Level | Reachable configs | = distinct engines |
|---|---|---|
| L0 | 316 | **260** |
| L1 | 316 | 316 |
| L2 | 316 | 316 |
| L3 | 2364 | 2364 |
| L4 | 2364 | 2364 |
| Armageddon | 4728 | 4728 |
| L5 | 5088 | 5088 |
| **total** | **15492** | **15436** |

**The 56 collisions are all at L0, and they are all `B2` ≡ `B3`.** The only thing B3 adds is the king-safety term `J(w)*(w?32:-32)`, and L0 has no check concept and therefore no `J` — so the term is not emitted and the two rungs produce the same bytes, once per (interface × info × notation × depth) combination. This is a property of the *ladder* meeting a level that removed the rule the rung scores, not a generator bug: every other level, and every other pair of rungs, stays distinct.

The counts factor cleanly. Start with the **presentation block** — the axes every level has:

```
legal (ui x info) pairs        L2 and below (no strict) : 5
                               L3 and above (strict on) : 7

per pair, the bot / rot / depth block:
  bot off      rot on or off  (blindfold: rot is inert -> one row)   2  /  1
  bot R        rot forced off                                        1
  bot B1-B5    x 4 depths, rot forced off                           20
                                                 non-blindfold  =  23
                                                     blindfold  =  22
```

Then multiply by the axes that switch on as the level rises:

```
L0 / L1 / L2   5 pairs -> 113 rows, + 45 prompt rows x cancelGuard  =  158
               x 2 notation                                         =  316
L3 / L4        7 pairs -> 159 rows, split by the prompt clock lock:
               114 rows x 8 clock + 45 prompt rows x 6 clock        = 1182
               x 2 notation                                         = 2364
Armageddon     2364 x 2 federation                                  = 4728
L5             the cooldown doubles the bot-OFF rows only:
               123 rows x 8 + 48 prompt rows x 6                    = 1272
               x 2 notation x 2 federation                          = 5088
```

where **8 clock** = 4 time models (`sudden`, `fischer`, `bronstein`, `simpledelay`) x 2 period
settings (single period / multi-period) — and **prompt gets 6**, not 8, because simple delay is
locked to Bronstein there (see the exclusions). The bot block is what grew these counts by roughly
6.7x: the ladder adds five rungs and each carries the four-ply depth axis, while `R` and every B rung
force `rot` off and so contribute one row rather than two.

### Which options exclude each other

**Every exclusion in the Generator behaves the same way**, so a locked control is never ambiguous:
the label is greyed (`dis`), the input is `disabled`, and if the now-illegal value was selected it
is re-pointed to a legal one. A control that is merely unclickable without looking disabled, or
greyed without actually being locked, is a bug — the two must always move together, and every
lock listed below is written from a **single** condition so that two rules touching the same
control cannot overwrite one another.

Four pairs are mutually exclusive. The first two are enforced in **both** places — the Generator
greys the partner out and re-points the radio, and `build()` has no such branch at all, so a
programmatic call cannot reach them either:

- **`dom` + `blindfold`** — blindfold means "no board"; the clickable board *is* the interface.
- **`prompt` + `strict`** — there is no prompt+strict engine. Strict's whole point is a running move
  list written into the page, and `prompt` has no page to write to: its only surface is the dialog
  title, which is rebuilt from scratch every move. **Note for anyone reading the code rather than the
  Generator:** `build()` has no guard for this pair, so a *direct* call with `{ui:'prompt',
  info:'strict'}` does return something. It is not a supported engine, it is not reachable from the
  UI, and it is not in the count above — do not treat whatever it emits as a reference for how prompt
  behaves. (This is the one exclusion whose two enforcement points disagree, which is exactly why it
  is easy to mis-read; earlier notes in this file described a prompt+strict status line that no user
  can ever see.)

One is an *equivalence* gate rather than an impossibility — the pair works, it just isn't worth
offering:

- **`prompt` + `simpledelay`, at L3 and above** — in the elapsed model Bronstein and simple delay
  charge the identical amount per move, and prompt never shows the mid-turn clock that would
  distinguish them, so the two radios would be two names for one behaviour. The Generator locks
  simple delay whenever the UI is `prompt` **and** the level still has a clock, and re-points to
  **Bronstein** (which on prompt charges exactly what simple delay did). The `!noClock` half of the
  condition keeps this from fighting the L2− lock that already greys the entire time fieldset.
  `build()` is unchanged and still emits a prompt simple-delay engine on a direct call. See
  *Clocks* for the full argument.

The next two are level gates, enforced in the UI and mirrored by a silent fallback in `build()`:

- **`strict` below L3** — the move list annotates counters that do not exist yet, so L2/L1/L0
  fall back to Indicators.
- **`cancelGuard` above L2** — see its row above.

And two more involve the bot. Both are enforced in the Generator; the first is now enforced in
`build()` as well:

- **`bot` forces `rot` off.** Rotation flips the board when it is Black to move, but the bot *is*
  Black and replies inside the same commit, so the board is never rendered on Black's turn — the
  rotated branch cannot execute. Measured with a deterministic bot, `rot:true` and `rot:false`
  render byte-identical boards while the engine carries **25–81 B** (avg 45 B) of unreachable
  code. `build()` therefore normalises `rot` to `false` whenever a bot is on, so a direct call
  cannot emit that dead weight either. This applies to the whole axis — `R` and every `B` rung.
- **`bot` disables the draw-offer cooldown.** Both reasons matter. Logically, writing code to let
  a mover with no notion of agreement *evaluate* an offer is meaningless. Mechanically, the
  cooldown's counter `n` only exists when the cooldown is armed, and the surrounding code is
  emitted differently depending on whether it is there — so having a bot and a cooldown coexist
  would mean carrying a variable that one half of the pair never reads. With the search ladder the
  clash is sharper still: `n` is the *search function itself* (see *The bot axis*), so an engine
  carrying both would overwrite the slot array with an arrow and the next `n[+T]` read would throw.
- **`botDepth` is meaningless for `off` and `R`, so the Generator hides the whole depth group**
  rather than greying one value inside it. R does not search; offering it a ply count would be a
  control that changes nothing, which is the same "looks live, is inert" failure every other rule
  here exists to prevent. `build()` ignores `botDepth` on those two settings, so a stale value
  cannot leak into a non-search engine either.

Two further axes are simply inert rather than excluded:

- **`rot` under `blindfold`** — no board to rotate. (Dead on `input` and `prompt`. `dom` cannot
  be blindfold at all, so the combination never arises.) Rotation therefore has *two* independent
  suppressors, blindfold and bot, and the Generator applies them from **one** combined condition.
  They used to be two separate blocks, and the later assignment silently undid the earlier one:
  blindfold with no bot re-enabled the control.
- **`rep` below L4** — nothing counts repetitions yet.

### What each level switches on

| From | Axis that goes live | Why |
|---|---|---|
| L1 | check detection (`J`) | — |
| L2 | castling, so **Chess960 becomes meaningful** | Below L2 there is no castling code and no `R={…}` rights map, so a 960 arrangement is *exactly* a custom FEN — the same 0-byte difference. From L2 up, each of the 56 king-rook skeletons emits its own castling clauses. |
| L3 | the **clock**, and with it the whole time axis: 4 increment/delay models and multi-period controls. Also the 50-move rule, and therefore **strict** | Strict is a move list without counters, which is only a meaningful *alternative* once counters exist. Its notation is UCI, not SAN — harder to read, but SAN may come later. |
| L4 | threefold repetition and insufficient material | Repetition has a side effect on **en passant**: the repetition key includes the ep square, so `Y` must be set exactly as the rules require, not merely whenever a pawn double-steps. At L2/L3 the engine emits `Y=Z&D>9?f+8-16*W:_` — set it on any double push. From L4 it emits the guarded form, which additionally requires a real enemy pawn beside the target *and* that its ep capture is legal. Getting this wrong would not lose a move; it would silently corrupt the repetition hash. |
| Armageddon, L5 | **federation** (`fide` / `uscf`) | It changes the insufficient-material condition. At L5 the split is much wider — automatic draws, flag-fall adjudication and the material tests that decide a finished game all differ. Measured: `uscf` is 56 B smaller at Armageddon and 89 B smaller at L5. |
| L5 | the **draw-offer cooldown** | Caps how often a side may *offer*, so neither player can spam offers. Claims (50-move, threefold) are never throttled — that is what the federations require. |

---

## The engine core

**Board.** A flat 64-element array `s`. `index 0 = a8` (top-left), `index 63 = h1`; `file = i%8`, `rank = i>>3`. **Black's back rank = 0–7, White's = 56–63.** UPPERCASE = White, lowercase = Black, `_` (which equals `'-'`) = empty. The colour test idiom is `s[i]>_ & s[i]<u == T`: `u` is a one-character boundary token set to `'a'` at startup (uppercase/White sorts below it). **`u` is universal — the same letter in every variant.** It is the letter that is free in all three UIs: in `dom`, `x` is the draw checkbox's element id; in `prompt`, `x` is the elapsed-time delta; and the text-input box is `id=X` — so `u` collides with nothing. **Always reuse the build's `u` token; never hardcode `'a'`.**

**Board initialiser (and the fold).** A small DP run-length encoder emits the start position as quoted literals plus padded empty runs — for any standard-shaped start that comes out as `s=[...'<back rank, lower>pppppppp'.padEnd(48,Y=_='-')+'PPPPPPPP<BACK RANK>']`, and for a FEN position as whatever mix of literals and runs is cheapest (a crowded middlegame can be one long literal with **no runs at all**).

On top of that a **board-literal fold** hooks the `_='-'` assignment into the **first** empty run and rewrites the whole initialiser using `padEnd` — `s=[...'…'.padEnd(48,Y=_='-')+'…']` — so the leading `_='-',` statement disappears, and `Y=_,` with it whenever `Y` still defaults to `_` (i.e. no FEN en-passant target). Every literal sheds its two quotes; every expression gains a `${}`.

**Whether that nets a win depends on the shape of the position**, so the fold is a **min-select**: both forms are built, the smaller is kept, and it can therefore never lose. Two independent levers decide it, and the min-select weighs them together rather than trying to state a rule:

- **Is there an empty run to hook into at all?** The DP only emits a run when it beats a plain literal: a run costs a flat ~11–12 B (either `_.repeat(N)`, or the shorter `padEnd` form that the standard start position takes), a literal of N dashes is N+2, so the break-even is **N ≈ 11**. What matters is the **longest single run of empty squares, not how many empties the board has.** A crowded middlegame can have the *same 32 empty squares as the start position* but scattered in runs of 5–8 — no run reaches the break-even, the DP emits one long literal, and there is nothing to hook the assignment onto.
- **Does the template pay for itself?** Converting the concat to a template literal makes every literal shed its two quotes (**−2 B each**) but wraps every expression in `${}` (**+3 B each**), against the deleted statements (`_='-',` = −6 B, and `Y=_,` = −4 B when `Y` still defaults to `_`). With **two** literals flanking one hole — the standard/960 shape — that clears easily (**−3 B**). With only **one** literal (a near-empty board whose initialiser is just one run followed by `'K------k'`) it exactly breaks even, so the fold is declined even though a perfectly good 56-long run is sitting right there.

In practice it fires nearly everywhere: **−3 B** with `Y` (L2 and up), **−1 B** without it (L1/L0, where the hook is just `(_='-')`), and **−1 to −3 B** on most FEN positions.

Two traps, both of which this code has already fallen into once:

- **Match the *shape*, not the text.** An earlier version compared the initialiser against the hard-coded standard back-rank string, so it silently skipped **every Chess960 arrangement and every FEN position** — 3 B left on the table in more than half the emitted engines, with nothing to indicate it.
- **Measure the edge cases; don't reason about them.** Two plausible-sounding rules are both *wrong*: "without `Y` the template's extra punctuation must cancel the one statement it saves" (it doesn't — it still wins 1 B), and "a long empty run means the fold fires" (it doesn't — the near-empty board above has a 56-run and still declines). The min-select settles both without an argument, which is exactly why it is built that way.

**State globals.**

| Var | Meaning |
|---|---|
| `T` | side to move, `true` = White |
| `C` | castle mask — White-short `1`, White-long `2`, Black-short `4`, Black-long `8` (`15` = all) |
| `U` / `N` | White / Black clock (seconds) |
| `Y` | en-passant target square, else `_` |
| `z` | game-over code (`0` while playing) |
| `o` | halfmove clock (for the 50/75-move rules) |
| `b` / `P` | repetition key / repetition-count map. `P` is **seeded** at startup with the opening position at count `o.rep` (`P={[s+T+Y+C]:rep}`). The `R=` readout renders `P[b]||rep` |
| `e` | draw-offer **bitmask** — one bit per side (`e^=2-W` text / `e^=2-T` DOM toggles the offerer's); `e>2` (both set) = agreed → `DA`. It is the OFFER only: the DOM claim reads `x.checked`, not `e`, and the cooldown arms off `e` **plus** a turn flip. |
| `c` / `g` | Bronstein tick accumulator / simple-delay counter — **only in the `setInterval` UIs (input/dom)**; the `prompt` UI has neither (see *Clocks*) |
| `ic` / `m` | per-move clock-credit accumulators in the time hook (Fischer `ic`, Bronstein/merged `m`) — present only when a period engine folds its add-values into one credit; the hook ends `T?U+=ic:N+=ic` / `…+=m` |
| `R` | rook-square → castle-bit map |
| `B` | **universal ply counter** — `B++`/`++B` each move (multi-period hook); in strict `++B` also is the displayed move number. Drives the multi-period boundaries and, when periods are on, the draw-offer cooldown. Present only when needed (strict, multi-period, or the cooldown). *(Written `mc` in `build()` before the `mc`→`B` pass — see above.)* |
| `n` | **three mutually-exclusive roles, never two in one engine.** (a) per-side draw-offer **cooldown** slots `[White, Black]` (`drawEvery ≠ 1`, L5 only); `n=[0,0]` at start. The slot is **decremented** every move of its owner (`n[+T]--`) and **stamped** only when that side presents an offer — `W^T&&e&2-W&&(n[+W]=…)` in the text UIs, after `e^=`, so a toggled-off offer or a `=` on an illegal move costs nothing. (b) with the **`R` bot** on, the reservoir **counter** in the move picker (`n=0,s.map(…)`) — a plain integer, reset on every reply. They are the same binding, so an engine carrying both would be broken: the bot's `n=0` overwrites the array with a number and the next `n[+T]` read yields `undefined`. (c) with a **`B1`–`B5` search bot** on, the **search function itself** — `n=(D,a,b,w,m,…)=>{…}`, the alpha-beta recursion. It is the only global the ladder spends, and it is free in every reachable config precisely because roles (a) and (b) are excluded alongside it. **`build()` enforces the invariant** (`dk` requires `o.bot==="off"`), so a bot build silently drops the cooldown — correct on the merits, since a bot never offers or accepts a draw and there is nothing to throttle. The Generator's `sync()` also greys the control out, but that guards the *form*; `build()` is the gate that actually holds, because it is also driven directly (the exhibit, the Node harness, a restored form). |
| `u` | **colour threshold** token (`'a'`) — the same letter in every variant |
| `w` | *(L0 only)* two-king-draw **pending** flag. When only the two kings remain, the first RESULT sets `w=1` (giving the side to move one more half-move); the next RESULT with two kings still on the board reads `w` and returns `D!`. Initialised in the `z=…0` chain |
| `k` / `l` | move **from** / **to** squares; in `dom`, `k` also holds the currently-selected square |
| `A`, `V`, `_` | `Math.abs`, "uppercase", `'-'` |

**Functions** (read in this order):

- `f(P,D,H,c,a,b,k,S)` — *move shape*: pure geometry (knight, king one-step, pawn push/capture, sliders). The slider scan `S` is **folded into `f`'s parameter list** rather than declared separately — `S`'s only external caller was `f` (its other occurrence is its own recursion), so as a parameter it captures `f`'s own `a`/`b` and needs neither a `S=` binding nor an argument list (−9 B per engine). The **step vector `k` is `f`'s own parameter too**, computed once as `k=(b-a)/(D|H)`: for any collinear pair one of `D`/`H` is zero or the two are equal, so `D|H` *is* the step count, and the old `A(a%8-b%8||a-b>>3)` form was doing the same arithmetic the long way (−13 B). `S` then takes a **dummy parameter** (`S=q=>…`, one byte cheaper than `S=()=>…`) and recurses as `S()`, reading `k` from the enclosing call. Note `k` is *f's parameter*, not a global assignment, so it does not touch the DOM interface's global `k` (the selected square) — that separation is load-bearing, since the driver uses `k` for the move's origin square while `G(k)` is running.
- `S()` — *slider path clear* (inside `f`): steps one index at a time from `a` toward `b`. Used only for collinear pairs (the step divides evenly and lands exactly on `b`); keep that invariant. **Its empty-test must stay `==_`, never `>_`** — see the warnings below.
- `L(i,b)` — is square `i` *attacked* by side `b`? (check detection + castling transit safety).
- `J(W)` — *in check*: `L` on side `W`'s king square.
- `G(d)` — *legal moves* for the piece on `d`: generates candidates, makes each on a scratch copy, rejects any that leave its own king in check, and **appends castling**. It already yields every legal move (including castling, en passant, and promotion destinations) — reuse it rather than re-deriving legality. In **Number** the pawn's shape test is a two-entry lookup indexed by the file distance, `[!g,g>0|i==Y][D]` (−5 B against the `!D&!g|D==1&(g>0|i==Y)` chain it replaced): index `0` (straight) demands an empty target, index `1` (diagonal) demands an occupied one or the ep square, and `D>1` indexes past the end to `undefined`, which the surrounding `&` coerces to `0` and rejects — the same verdict the old form reached through `!D`. Letter keeps the chain (its emptiness test is `g==_`, not `!g`).
- `M(f,l,p)` — *make move* in place: en passant, castling rook relocation, promotion to `p`, castle-right updates, and the new en-passant target (set with full FIDE legality — only when a pawn could actually capture next move). The ep capture and the origin clear are **one chained assignment**, `s[f]=s[Z&Q==Y?Q^8:f]=_` (−2 B against a separate `Z&Q==Y?s[Q^8]=_:0,` statement): on an ep capture the inner index is the captured pawn's square, otherwise it is `f` itself, making the whole thing a harmless `s[f]=s[f]=_`. Two facts keep this safe — `Q^8` is always eight squares from `Q`, so clearing it can never undo the piece just written to `s[Q]` (which is why the ep clear may run *after* the landing write); and in a real ep capture `f` and `Q^8` sit on the same rank but different files, so they are always two distinct squares.
- `I(v)` — *insufficient material*. `v` selects the side: `1` White, `0` Black, `>1` both. A single colour-mask (`a`: light-bishop `1`, dark-bishop `2`, both `3`) covers K-v-K, K+B, and any same-colour-bishop pile in one `a<3` test; knights use a count test (`F<2`). *(Dropped at L3 and below.)*
- `Q(W)` — *(FIDE rule set, L4-and-up only)* can side `W` still mate? A **helpmate** test (FIDE Art. 6.9: mate reachable by *any* legal sequence). Decides FIDE win-on-time vs draw-on-time and resign-vs-draw. **USCF omits `Q` entirely** (material test instead); **Chesseus L4 and below drop `Q`** with the can't-mate draw.
- `K` — the notation parser (text UIs) or, in `dom`, the move-commit function that applies the move with the chosen promotion piece `w` (the name is reused per UI).
- `D` — render.

**There is no standalone `move()`.** Each driver **inlines** `M(k,l,p)` → time hook → `T=!T` → the *RESULT* expression (the big `z=…` that detects mate / stalemate / insufficient material / repetition / move-rule / draw / timeout). If post-move logic is ever needed, factor a shared helper or loop the inline — never duplicate RESULT.

**`z` codes:** `W#`/`B#` mate, `SM` stalemate, `IM` insufficient material, `5R`/`3R` five/threefold, `75`/`50` move-rule, `DA` draw agreed, `WT`/`BT` win on time, `TM` flag-fall but neither side can mate (draw), `WR`/`BR` resign, `RM` resign-but-can't-mate (draw). **Under the USCF rule set, `5R`, `75`, and `RM` never occur**, and `TM` is decided by material rather than `Q`. `3R`/`50` stay as *claims* in both rule sets. **Under Chesseus the lower levels emit fewer codes** — L2/L1 are just `W#`/`B#`/`SM`, and **L0 replaces the whole set with `WK` / `BK` / `D!`** (capture-the-king). *(These two-letter codes are the **Letter**-notation form. In **Number** notation the `toNumeric*` pass rewrites each to a bare integer on a single universal table — `1=W#, 2=B#, 3=SM, 4=C!, 5=50, 6=WT, 7=BT, 8=IM, 9=3R, 10=5R, 11=75, 12=DA, 13=D?, 14=TM, 15=RM, 16=WR, 17=BR`, with `WK=1, BK=2, D!=3` reusing the mate/stalemate slots at L0. `0` means "no result yet". The table is chosen so the two mates (`1`,`2`) and the two win-on-time / resign pairs are consecutive — each folds to one arithmetic branch — and so White's Armageddon wins `{1,6,16}` are exactly the residue-1 class mod 5, letting Armageddon's `z>'W'` become `z%5==1`. See [Number notation — reading and playing an emitted engine](#number-notation--reading-and-playing-an-emitted-engine) for the player-facing legend.)*

---

## Clocks

The four clock models live in the per-move time hook and the 1-second tick. The **input** and **dom** UIs share one real-time model (a `setInterval` ticks the mover's clock down once a second); the **prompt** UI uses a different, self-contained model.

**input / dom — real-time (`setInterval`).**

| Model | Per-second tick | Per-move hook (single period) |
|---|---|---|
| sudden | `T?U--:N--` | — |
| fischer | `T?U--:N--` | `T?U+=inc:N+=inc` (add the increment) |
| bronstein | `T?U--:N--,c++` | `m=c>(inc-1)?inc:c,T?U+=m:N+=m,c=0` (refund `min(elapsed,inc)`) |
| simpledelay | `g?g--:T?U--:N--` | `g=inc` (re-arm the delay counter each move) |

Here `c` counts the seconds the mover actually used (Bronstein), and `g` is the delay countdown that must expire before the clock starts falling (simple delay). Both are genuine state of the real-time model.

**prompt — elapsed / `Date` model.** The `prompt()` loop has no `setInterval`; instead it measures the real time spent on each move (`x = (new Date - d)/1e3` in Letter; see the millisecond note below for Number) and deducts it. **In this elapsed model Bronstein and simple delay are mathematically identical** — both net out to `clock -= max(0, elapsed - delay)`:

**In Number the prompt clock is held in milliseconds** (`U=N=6E5` for ten minutes, not `6E2`), which lets the elapsed line drop its conversion entirely: `x=(new Date-d)/1e3|0||1` becomes `x=new Date-d||1`, **-8 B**. The raw `Date` difference *is* the deduction, `||1` still charges a non-zero amount for an instant reply, and the `|0` floor is redundant because a `Date` difference is already an integer. **This is a deliberate display change, not a transparent golf:** the status line reads `W600000 B599997` instead of `W600 B600` -- a six-digit clock moving in thousands. FIDE requires the time to be *kept*, not displayed in seconds, so the substitution is legal, but it belongs in the behaviour-change column rather than the equivalence column.

**Where it applies: Number + prompt, at clocked levels (L3+).** `input`/`dom` tick a `setInterval` and never compute a `Date` difference, so there is nothing to remove there -- and converting them would mean ticking 1000x more often for no byte gain. Letter is excluded because its status line is character-budgeted and a six-digit clock breaks the column alignment. L2 and below carry no clock at all (`noClock`), so the switch is inert there. Info level does not matter: counted, strict and blindfold all take it.

**Every downstream clock constant scales with it.** The elapsed value is compared against and subtracted from the Bronstein / simple-delay discount, the Fischer credit, and the per-period increments -- so a "3 second" delay emitted as a bare `3` would silently become 3 **milliseconds** and the increment would effectively vanish. Those constants are built by helpers that live outside `build()`, so the scale travels through a module-level `MSCLK` flag: `build()` sets it to 1000 when it is emitting a Number+prompt engine, every seconds constant passes through `msNum()` on its way to becoming an engine literal, and `build()` resets it to 1 on the way out so it cannot leak into the next call. Emitted forms: `i&&(x=x>3E3?x-3E3:0)`, `T?U+=5E3:N+=5E3`. **Any new clock constant must go through `msNum()`** -- the failure mode is silent, showing up only as an increment that does nothing. The same applies to anything that *subtracts* from the clock rather than adding to it: the search bot's think-time charge was written in seconds and left out of this scaling, so on a Number+prompt engine it took 3 units off a 600000 ms clock for a 3-second search. It now branches on the same `msClock` flag.

- sudden: `T?U-=x:N-=x`
- fischer: `T?U+=inc:N+=inc,` then `T?U-=x:N-=x`
- **bronstein:** `i&&(x=x>inc?x-inc:0),T?U-=x:N-=x` — trim the delay off the elapsed time *before* deducting.
- **simpledelay:** `x=x>inc?x-inc:0,T?U-=x:N-=x` — the same trim, but **unguarded**.

**Why the two differ by exactly `i&&`.** The guard applies the delay only when the player typed something, so a blank or cancelled prompt is charged the full elapsed time. That is right for Bronstein, whose refund is a bonus *for having moved* — no move, no bonus. It is wrong for simple delay, where the first `inc` seconds of the turn **simply do not count**: the clock is not running during the delay window, so those seconds are not the player's to lose whether they move, mistype, or hit Cancel. Measured with a 5 s delay and 2 s turns on blank input, the guarded form took the clock from 600 to 598 — time charged *inside* the free window. Dropping the guard for simple delay fixes it and is 5 B **shorter**.

#### Simple delay is not offered on `prompt` (L3 and above)

The four shapes above are what `build()` *can* emit; the Generator no longer lets you reach one of
them. **`prompt` + `simpledelay` is locked at every level that has a clock** — L5, Armageddon, L4
and L3 — and the radio falls back to **Bronstein**.

The reason is the equivalence stated above: in the elapsed model both delay models net out to
`clock -= max(0, elapsed - delay)` per move, and the *only* thing that distinguishes them on a
real clock — Bronstein dips and then refunds, simple delay never dips — is a mid-turn state that
prompt never renders. Offering both is offering the same behaviour under two names, and the
difference a user *would* notice is not the one the labels promise. The one genuine divergence is
`i&&` on blank input, which is a correctness detail rather than a choice anyone would make
deliberately, and it survives on `input`/`dom` where the models really do differ.

Bronstein is the fallback rather than Fischer because it preserves what the user asked for: on
prompt it charges exactly what simple delay charged. Nothing about the emitted engine changed —
this is a UI restriction only, and `build({ui:'prompt',time:'simpledelay'})` still returns the same
bytes it always did for anyone calling it directly.

Two implementation points, both of which are the general rule for this generator rather than
anything specific to the clock:

- **The fallback is mandatory, not cosmetic.** `opts()` reads the radio raw
  (`$('input[name=time]:checked').value`). Setting `disabled` does not change which radio is
  *checked*, so a lock without a re-point would grey the control while still handing `build()` a
  stale `'simpledelay'` — the user sees a locked option and downloads a simple-delay engine anyway.
  Every lock in `sync()` therefore greys, disables, **and** re-points; see *Mutually exclusive
  options* for why all three must move together.
- **The condition is `ui==="prompt" && !noClock`, and the `!noClock` half matters.** At L2 and
  below the whole `#timefs` fieldset is already inert, and the time axis never reaches `build()`.
  Adding a second writer for the same radio there would put two rules in conflict over one control
  — exactly the failure this file documents twice already (the rotation double-assignment, the
  draw-cooldown one). One control, one condition.

*Verified:* over the level × UI × time matrix the lock changes exactly **four** cells (prompt ×
{L5, Armageddon, L4, L3} × simpledelay → bronstein) and leaks nothing; the emitted engines are
**byte-identical to the pre-lock output on all 1008 build configs**.

**The delay must be applied upstream of the clock, never as a credit after it.** The driver's order is fixed — `x=elapsed , [charge] , FLAG CHECK , resign? , legal? , [credit]` — so a credit placed after the charge arrives too late: the flag check sees a clock charged the full elapsed time. A player with 2 s left who takes 6 s under a 5 s delay owes 1 s and must survive; the old credit form drove the clock to −4 and the flag fired, and `z` cannot be un-set by a later credit. Discounting `x` upstream also fixes the resign and illegal-input branches, which the old credit (living inside the legal-move branch) never reached.

Because prompt never runs a `setInterval`, it has **no `c` and no `g`**: those counters exist only to drive the real-time tick, which prompt does not have. The state line of a prompt Bronstein or simple-delay engine therefore omits them entirely. (`input`/`dom` keep them, because their tick reads them every second.)

**Multi-period.** `o.periods` adds up to two boundaries (three periods). At each boundary the mover's clock gets a block time-add, and each period may set a different increment/delay. The boundary is a ply test `B+T-<2·moves>`; the ply counter `B` (written `mc` in `build()`) advances once per half-move. See *Multi-period time controls* for how the hook is shaped.

### Per-side increment / delay (`o.binc`)

Every clock model can give White and Black **different** increments/delays. `o.binc` is Black's value; omit it (or set it equal to `o.inc`) and the generator takes the old symmetric path, so **symmetric output stays byte-identical** — verified across the full matrix. `bincOf(o)` returns `null` for the symmetric case and is the single gate.

This is cheap because the commit hook **already** splits by side — `T?U+=n:N+=n` — and merely happened to carry the same constant in both arms. Asymmetry only differentiates the constants:

| Model | Symmetric | Asymmetric (White 5 / Black 3) | Cost |
|---|---|---|---|
| fischer | `T?U+=5:N+=5` | `T?U+=5:N+=3` | **+0 B** (single digits) |
| bronstein | `m=c>4?5:c,T?U+=m:N+=m,c=0` | `m=c>(T?4:2)?(T?5:3):c,…` | +12 B |
| simpledelay | `g=5` | `g=T?3:5` | +4 B |
| prompt fischer | `T?U+=5:N+=5` | `T?U+=5:N+=3` | +0 B |
| prompt simpledelay | `x=x>5?x-5:0,…` | `x=x>(T?5:3)?x-(T?5:3):0,…` | +10 B |
| prompt bronstein | `i&&(x=x>5?x-5:0),…` | `i&&(x=x>(T?5:3)?x-(T?5:3):0),…` | +10 B |

*Both delay models now take their asymmetry the same way — the delay value becomes a `T?w:b` ternary inside the same upstream trim — so neither loses a merge and both pay the same +10 B. Per move the two charge the identical amount (`x - min(x,D)` and `max(0, x-D)` are the same function for all `x >= 0`), and prompt never displays a mid-turn clock, so the dip-then-refund that visibly separates them on a tick interface has nothing to show here. They are not byte-identical, however: the `i&&` guard above is a real semantic difference on blank input, and it is the only one.*

**simple delay's reversed polarity — the one real trap.** `g` is the *next* player's countdown, and the commit hook runs **before** `T^=1`, so the `T` visible there is the side that just **moved**. The value order is therefore inverted relative to the other models: White-moves → Black is next → `g=T?<black>:<white>`. Get this backwards and the engine still parses, still runs, and silently gives each side the other's delay. The *initial* `g` (`timeInitOf`) is **not** flipped — the opening `g` is White's, since White moves first. In the **prompt** (elapsed) model the polarity is forward for every model, because there the credit goes to the mover, not to the next player.

**Zero on one side is not a ternary.** Writing `+=0` is dead weight, so `addPair(w,b)` short-circuits: `T?U+=0:N+=5` becomes `T||(N+=5)`, and `T?U+=5:N+=0` becomes `T&&(U+=5)` — **−2 B** each. When *both* sides are 0 the usual sudden-death collapse applies instead (see below).

**The sudden-death collapse counts `binc`.** "All increments 0 ⇒ sudden template" is a deliberate byte optimisation (a +0 Fischer *is* sudden death), and it still fires for `inc=0,binc=0`. But `inc=0,binc=5` is a **real mechanism** — only Black gets an increment — so the collapse test excludes it; otherwise that control would silently lose its increment.

---

## Multi-period time controls

A period control is a list of boundaries (`o.periods`), each `{at, add, inc}` — optionally `{at, add, badd, inc, binc}` for per-side values (see *Per-side periods* below): after move `at`, add `add` seconds to the mover's clock, and from then on use increment/delay `inc`. The generator emits the smallest hook that reproduces the requested schedule. Three independent pieces make it up:

**Block time-adds at each boundary.** When every boundary adds the **same** number of seconds, the boundaries collapse into one test via a product: `(B+T-80)*(B+T-120)?0:T?U+=v:N+=v` fires the single add whenever `B+T` equals either boundary. When the add-values **differ**, each boundary gets its own ternary. Round values print in exponential form (`5400` → `54E2`, `6000` → `6E3`) when that is no longer than the decimal.

**Per-period increment / delay values.** The increment (Fischer), delay (simple delay), or refund cap (Bronstein) for each period is emitted as a threshold ladder that **collapses consecutive equal values**:

| Pattern (periods 1·2·3) | Emitted value expression |
|---|---|
| all equal (e.g. 5·5·5) | `5` (one constant, no threshold) |
| 1=2 ≠ 3 (5·5·30) | `B+T<121?5:30` (one threshold) |
| 1 ≠ 2=3 (0·30·30) | `B+T<81?0:30` (one threshold) |
| all distinct (0·15·30) | `B+T<81?0:B+T<121?15:30` (two thresholds) |

So a typical control — a fixed increment throughout, or an increment that switches on once at a single boundary — needs at most one threshold. This ladder is shared by simple delay, Bronstein, and Fischer.

**Folding the block-add into the accumulator.** Fischer and Bronstein already carry a clock-credit accumulator (`ic` / `m`). When the per-period increments are equal and the boundaries share one add-value, the add folds into that accumulator so there is a single `T?U+=…:N+=…` at the end instead of a separate add ternary — e.g. Fischer `ic=B+T-80?5:5405` (the boundary move credits `inc+add` in one shot). Sudden death and simple delay have no such accumulator, so their block-adds stay as their own ternaries.

**Collapse to sudden death.** If **every** period's increment/delay is 0, the whole mechanism (Fischer's `ic`, Bronstein's `c`/`m`, simple delay's `g`) contributes nothing, so `build()` substitutes the sudden-death template outright — a Fischer/Bronstein/simple-delay control with all-zero increments emits an engine byte-identical to the sudden-death one. This holds at 1, 2, or 3 periods.

### Per-side periods (`p.badd`, `p.binc`)

Each boundary may carry Black's own block-add (`p.badd`) and Black's own increment (`p.binc`). Omit them and everything falls back to the symmetric path — **byte-identical output**, verified across the matrix. All four clock models support this.

The shape that makes it cheap: `perPeriodFold` already folds the block-add into the increment accumulator and writes both with **one** `T?U+=ic:N+=ic`. Asymmetry does **not** break that fold — only the values entering the accumulator become ternaries, and the single write survives:

```
symmetric : ic=++B+T<81?5:10          , B+T-80?0:ic+=30          , T?U+=ic:N+=ic
asymmetric: ic=++B+T<81?(T?5:3):(T?10:8), B+T-80?0:ic+=(T?30:20) , T?U+=ic:N+=ic
```

Consequences worth knowing:

- **Bronstein's cap is asymmetric for free.** `m=c<ic?c:ic` reads `ic`, so an asymmetric `ic` yields an asymmetric refund cap with no extra code at all.
- **simple delay flips.** `perPeriodIncBlock` passes `flip=1` into `incTernary`, for the same next-player reason as the single-period case. The two paths must agree — they read the same `g`.
- **Comparisons move to pairs.** `perPeriod`, `mergeable`, `bulkAdds`'s grouping key and `incTernary`'s ladder all used to ask "are these period values equal?". They now ask it of the **(White, Black) pair**. Miss one and two periods that share a White value but differ on Black get merged, silently handing one period the other's Black value.
- **`mergedHook` splits the sum.** The merge path emits `inc+add` as one constant at the boundary; asymmetric input needs both the base and the sum per side: `ic=BE?(T?5:3):(T?35:23)`.

**Costs** (L5 / input, against the 1916 B sudden-death baseline):

| Control | Bytes | vs baseline |
|---|---|---|
| fischer, symmetric period (add 30 + inc 5→10) | 1965 | +49 |
|   add asymmetric | 1972 | +56 |
|   inc asymmetric | 1977 | +61 |
|   both asymmetric | 1984 | +68 |
| sudden death, period add — symmetric **or** asymmetric | 1943 | +27 |

Sudden death shows no delta because its block-add already carried its own `T?U+=v:N+=v` ternary (it has no accumulator to fold into), so per-side values only change the two constants — and 30/20 are both two digits.

**Threshold-move semantics are unchanged.** At the boundary `ic` still holds the **old** period's increment (`B+T` equals the threshold, so the `<` test is still true). White gets `5+30=35`, not `10+30=40` — exactly as in the symmetric case.

**Levels.** The clock — and therefore the whole period mechanism — exists only at **L3, L4, L5**. At L2 and below `noClock` removes the `setInterval`, the tick, the hook, and all period state, so a period control has no effect on the emitted engine.

---

## Draw claims and the claim cooldown

A draw has two halves, wired differently:

- **Claim** — 50-move / 75-move / threefold / fivefold are detected automatically in *RESULT* every move and are **always available**, never throttled.
- **Offer** — a player proposes a draw; the opponent agrees (`DA`) by offering back. The optional **cooldown** (`drawEvery`) rate-limits only *new offers*, **per side**. A blocked offer does not consume the move.

The claim/offer logic is **identical across the three info modes**; only the on-screen presentation differs. **Where the offer enters differs by UI** — the only real per-UI difference in the draw path:

- **Text UIs (input / prompt)** — a move typed with a trailing `=` is the offer; a bare `=` is a claim/accept. It lives in the driver's `EXTRACT` expression, which runs *after* the move. The offerer is the **typer** `W` (`W=T` captured *before* the move, **not** the post-move side); each `=` toggles that side's bit (`e^=2-W`), and `DA` fires once **both** bits are set (`e>2`). A non-`=` input takes the else-branch `e*=W==T`: a real move flips `W` (`W!=T`) → clears both bits; an invalid input keeps `W==T` → preserves a pending offer.
- **DOM** — the offer is the ½ control (`<input type=radio id=x onclick=X()>`); `X` toggles the per-side bit `e^=2-T` (the control is toggled *before* the move, so the offerer is `T`). **`X` also carries the resign branch**: it takes a flag argument, so the ½ control calls `X()` (no arg → draw branch) and the ⚐ button calls `X(1)` (truthy → resign branch). There is no separate `E`. See the byte notes below for why the control is a `radio` and not a `checkbox`.

  **The radio's `checked` is re-synced in `X()`, and this is subtler than it looks.** A radio does not untoggle on a second click — only a sibling in its group turning on can clear it — so after a retract the browser leaves the dot filled while `e` is back to 0. Something has to write it back. But the control carries **two different states, and only one of them lives in `e`**:

  | State | Where it lives | Read by |
  |---|---|---|
  | **offer** — "I propose a draw" | the `e` bitmask (`e^=2-T`) | `Cl(e>2?'DA':z)` — both bits set = agreed |
  | **claim** — "if I play this move it is 50/3-fold" | **the checkbox itself, nowhere else** | the result chain, `x.checked?Cl(z):z` |

  `Cl` tests `o` and `P[b]`; it never reads `e`. So a ticked *claim* is invisible to `e`, and the re-sync **cannot** live in `D()`: `D()` runs on every render — including `H()`'s square-**select**, which happens between ticking the box and committing the move — and `e&2-T` is 0 for a claim, so `D()` would erase the claim before `K()` could read it. That regression is easy to miss because the offer half keeps working perfectly: tick the box, click your piece, and the 50-move claim silently evaporates.

  `X()` is the correct home. It is the only place the offer changes, and it never runs on a select, so `,x.checked=e&2-T` rides X's own tail just before its `D()`. **`K`'s `x.checked=0` stays** — it clears the box *after* the result chain has consumed the claim, and since nothing derives that state back, dropping it leaves a spent claim ticked and the next move re-claims. Order matters: result chain reads, `K` clears, `D()` repaints.

  One trap worth naming: `X`'s parameter is the resign flag, so inside `X=x=>…` the name `x` **shadows the radio element**. The parameter is renamed to `w` (`X=w=>`) — free, since `X`'s body only touches `z, Q, T, e, n, B, Cl, D`. Writing `x.checked` under the old parameter name throws `Cannot set properties of undefined`.

**Cooldown forms.** The gate is keyed to the **actor's own slot** (`n[+W]` in the text UIs, `n[+T]` in DOM `X()`): an offer registers when `e` is already set (i.e. this input **accepts** a pending offer — never gated) **or** the actor's cooldown is open. When periods are on, `B` already counts plies, so the cooldown **reuses `B`** — a timestamp form, no extra tick. When periods are off it uses its own countdown in `n`, with a per-move `n[+T]--` tick. Either way the limit is exactly `drawEvery` full moves; `n=[0,0]` is the two-slot store. The cooldown exists only at **L5**.

**Testing and arming are two separate steps, and fusing them is a bug.** The slot is spent when the offer is *presented to the opponent* — never when it is merely toggled on. That means the guard may only **read** the slot; the **write** has to wait until a move actually commits:

| | test (in the offer toggle) | arm (after the move) |
|---|---|---|
| countdown | `e^=(e||n[+W]<1)&&2-W` | `W^T&&e&2-W&&(n[+W]=drawEvery)` |
| periods | `e^=(e||B>=n[+W])&&2-W` | `W^T&&e&2-W&&(n[+W]=B+2*drawEvery)` |

DOM used to fuse the two into one expression — `e^=(e||n[+T]<1&&(n[+T]=3))&&2-T` — so the assignment fired the moment the guard was *evaluated*, i.e. on the click. The consequence was invisible until you tried it: click ½ to offer (slot armed), click again to retract (`e` back to 0, but on this pass `e` was truthy so `e||…` short-circuited and never refunded `n`), and from then on every click found the slot closed and did nothing at all. **The right vanished without a single move having been played** — and the player had no way to see it, because the offer bit and the slot are different variables and only the offer bit is rendered.

DOM now splits them the same way. The arm rides `K` next to the existing `e&=2-T`, which makes the condition nearly free: `K` runs `e&=2-T` **before** `T^=1`, so `T` is still the mover and `e` has already been reduced to either 0 or the mover's own bit — the text UI's `W^T&&e&2-W` collapses to a bare `e`, giving `e&&(n[+T]=…)`. It is placed **after** the `n[+T]--` tick, mirroring the text UIs, so the freshly-stamped slot is not immediately decremented by the same move that set it. Claims never enter this path, and accepting is still ungated. Cost: **+14 B** (Number) / **+18 B** (Letter), and only on engines that actually carry a cooldown — `drawEvery = 1` builds are byte-identical, since `dk` is false and the arm collapses to an empty string.

**The text UIs were audited against the same standard and are correct.** `input` and `prompt` already split test from arm, in both the countdown and periods forms, across all three info levels and both notations — verified structurally over 240 cooldown configs and behaviourally by driving real input: a bare `=` toggles the offer without touching `n`, a retract leaves `n` untouched, a further `=` can still offer, an offer riding a legal move arms the slot, a `=` on an *illegal* move arms nothing, and accepting is never gated. The asymmetric case (`bdrawEvery`, e.g. White 1 / Black 3) keeps its per-side ternary `n[+W]=(W?1:3)` on both interfaces. The behavioural test was **mutation-checked**: deliberately fusing the text UI's guard back into the DOM's old shape makes it fail on 14 assertions, so it is testing the property and not merely passing.

*(UI naming: the Generator labels this **draw-claim limit**, since the same `=` input covers both proposing a draw and claiming one.)*

### Per-side cooldown (`o.bdrawEvery`)

The cheapest of the per-side axes, because the **data structure was already per-side**: `n` is a two-slot array indexed by the actor (`n[+W]`, DOM `n[+T]`). The only symmetric thing was the constant reloaded into the slot, and `W`/`T` is already in hand:

| Form | Symmetric | Asymmetric | Cost |
|---|---|---|---|
| countdown (counted, no periods) | `n[+W]=3` | `n[+W]=(W?3:5)` | +6 B |
| timestamp (strict / periods on) | `n[+W]=B+6` | `n[+W]=B+(W?6:10)` | +7 B |
| DOM | `n[+T]=3` | `n[+T]=(T?3:5)` | +6 B |

Two gates matter. `dk` used to test `drawEvery != 1` alone; with asymmetry, *White 1 (unlimited) / Black 3* is a legitimate control, so `dk` now also fires when the two values differ — otherwise no cooldown is emitted at all and Black's limit vanishes. And `Kx`/`KxT` exist separately because the text UIs index by `W` while DOM indexes by `T`.

### Seeding a pending claim from the board editor (`o.drawState`)

The board editor can start a game with a claim already on the table — `0` none, `1` White has claimed, `2` Black has claimed. `3` is not offered: both bits set *is* agreement, so the game would already be over. `0` writes nothing and the engine is **byte-identical** to before.

`e` normally rides the shared zero-chain (`z=o=e=0`). A non-zero seed pulls it out and assigns it separately — **+2 B**:

```
drawState 0 : z=o=e=0
drawState 1 : z=o=0,e=1
```

**The intersection with the cooldown is not automatic.** `e` and `n` are separate variables: seeding `e=1` does **not** fill the claimer's cooldown slot. Left alone, a game that starts with "White has claimed" lets White claim again on the very next move — the limit is punctured for the first turn. Verified by running it. So a seed also **seeds the slot**, as if that claim had just been made:

```
counted, limit 5, White : n=[z=o=0,5],e=1
counted, limit 5, Black : n=[5,z=o=0],e=2
strict,  limit 5, White : n=[z=o=B=0,10],e=1
asymmetric W3/B7, Black : n=[7,z=o=0],e=2
```

Black's slot is index 0 — where the zero-chain sits — but that costs nothing: the chain simply moves to the *other* slot (both are 0-based), so `n=[5,z=o=0]` is the same length as the untouched form. Cost is +2 B (counted) / +3 B (strict, two-digit constant).

**Side-to-move matters.** `EXTRACT`'s else-branch is `e*=W==T`: a real move by the claimer withdraws the claim (FIDE). So a seeded claim is only meaningful if the FEN puts the **opponent** on move — otherwise the claimer's first move clears it immediately.

**Levels.** The claim bitmask exists only at **L5**; L4 and below are `noDraw`, and the editor's selector is disabled there (and reset to `0`). A bot on also kills the cooldown — `n` is the bot's reservoir counter, and the two cannot coexist.

---

## The `R=` readout (repetition count)

In **Indicators** notation the display shows `M=<halfmove>  R=<repetition count>` for the current position. The repetition figure renders as **`P[b]||rep`**, universal across all three UIs.

On the very first render `b` (the position key `s+T+Y+C`) is still undefined — it is only written when RESULT runs, i.e. after the first move — so `P[b]` is undefined and the display falls through to the seed. Using `||rep` (the `o.rep` seed) instead of a bare `||1` means a position **loaded from a FEN as "already seen N times"** shows the correct `R=N` immediately, matching the seeded `P` map (`P={[s+T+Y+C]:rep}`). `build()` normalises `o.rep` to `1..4` up front, so the fallback is always a valid literal. The `R=` readout exists only where repetition does — **L5/L4**.

---

## The FIDE / USCF rule set

`o.fed` (`fide` default, `uscf`) selects how a finished game is **adjudicated**. It is orthogonal to every other axis and touches **only the game-result fragments** — move generation, legality, make-move, repetition counting, and the clocks are byte-identical between the two. USCF engines come out ~80 B smaller, purely because the dropped logic is gone.

Three things change under USCF, all in the result expressions:

| | FIDE fragment | USCF fragment |
|---|---|---|
| repetition / move-rule | `(P[b=s+T+Y+C]=-~P[b])>4?'5R':o>149?'75':`*…draw…* | `(P[b=s+T+Y+C]=-~P[b],`*…draw…*`)` |
| resign | `z=Q(T)?'RM':T?'BR':'WR'` | `z=T?'BR':'WR'` |
| flag-fall | `z=Q(!U)?'TM':U?'WT':'BT'` | `z=I(!!U)\|!m&!a&F<3&!s.includes('pP'[+!U])?'TM':U?'WT':'BT'` |

- **No automatic five-fold / 75-move draw.** The repetition counter `P[b]` and the halfmove clock `o` *still increment* (so the `3R` and `50` **claims** keep working in both rule sets) — USCF only drops the *automatic* `5R`/`75` results, by wrapping the increment as `(P[b…]=-~P[b],…)` instead of testing it.
- **Resign always loses.** FIDE gates resignation through `Q` (a resign in a dead position is a draw, `RM`); USCF has no such gate, so `RM` never occurs.
- **Flag-fall is material, not helpmate**, so the can't-mate helper `Q` is dropped entirely.

### Why flag-fall differs — FIDE 6.9 vs USCF 14E

When a flag falls for side `W`, the opponent `!W` (the side with time) wins **unless** the position is a draw. The two federations define that "unless" differently:

- **FIDE Art. 6.9 — helpmate.** Draw iff the opponent **cannot checkmate by *any* possible series of legal moves** — no mate exists even with the flag-faller *cooperating*. This is what `Q(W)` computes. Consequence: `K+2N` vs a lone king **wins** on a FIDE flag (a helpmate exists), even though mate can't be forced.
- **USCF Rule 14E — no forced win.** Draw iff the opponent **cannot *force* mate** — applied as a material bright line: lone `K`, `K+B`, `K+N`, or `K+2N` (the last only when the flag-faller is **pawnless**). The single discriminator for two knights is **pawn presence on the flag-faller's side**, because two knights can force mate *only* against a king jammed by its own pawn (the Troitsky line); against a bare king `K+2N` is a draw.

The USCF expression reads directly off that:

```
I(!W) | !m & !a & F<3 & !s.includes('pP'[+W])
└──┬──┘   └──────────┬──────────┘ └──────┬──────┘
 claimant is        claimant is         flag-faller W
 insufficient       exactly K+2N         has no pawn
 (lone K, K+minor,  (I(!W) also sets     ('pP'[+W] is W's
  same-col bishops)  a / F / m)           own pawn char)
```

`F<3` (not `F==2`) is deliberate: in the `I(!W)|…` form the `F∈{0,1}` cases are already covered by `I(!W)`, while `F<3` still excludes `F≥3`, so `K+3N` (reachable via underpromotion) correctly **wins**. The leading `|` is engine-style bit-or of 0/1 — `I(!W)` is evaluated first so its `a`/`F`/`m` side effects are set before the right operand reads them.

### `Q(W)` — the helpmate test, and the bishop-colour trap

`Q(W)` = *"`W`'s **opponent** cannot mate"* → the draw signal (`TM` on a flag-fall, `RM` on a resign). The side being **asked about** is `!W`; `I(!W)` tallies **its** material into `a` (bishop **colour mask**: 1 = light, 2 = dark, 3 = both), `F` (knights) and `m` (Q, R **or P** — `'P' > 'K'`, so a pawn already sets `m` and needs no separate test).

```js
Q=W=>(j=c=>!s.includes(c[+W]),I(W),E=a,I(!W)&(!a&!F|j('nN')&j('pP')&((F&j('rR')|a)&&!(E&~a))))
```

| clause | meaning |
|---|---|
| `!a & !F` | a **bare king** — can never mate, whatever the opponent holds |
| `j('nN') & j('pP')` | the **opponent** has no knight and no pawn (either could box in its own king, so a helpmate would exist) |
| `F & j('rR')` | **knight branch**: this side has a knight *and* the opponent has no rook (a rook can block its own king's escape, which a lone knight then mates) |
| `\| a` | **bishop branch**: this side has a bishop |
| `&& !(E&~a)` | **the colour test** — shared by both branches |

`E` is the **opponent's** bishop mask, taken by the extra `I(W)` call. `E&~a` reads *"the opponent has a bishop on a colour this side does not cover"* — an **opposite-coloured bishop**. That bishop can block its own king on a square the mating bishop attacks, so a helpmate **does** exist and the position is **not** a draw.

**This was a real bug, and it was never right.** Every version of `Q` back through the project's history had `| !!a` as the bishop branch — it asked only *"do I have a bishop?"* and never looked at the opponent's. So `K+B` vs `K+B` on **opposite** colours was scored `TM` (draw) on a flag-fall, when in fact mate is available:

```
8  k b - - - - - -     Black Ka8, Bb8 (dark)
7  - - - - - - - -     White Kb6, Bc6 (light)
6  - K B - - - - -
   Bc6 checks a8 along c6–b7–a8; a7/b7 are held by Kb6;
   b8 is blocked by Black's OWN bishop.  Mate.
```

Structurally the old shape *could not* be right: `Q` called `I` **once**, so it only ever had one side's colour mask. `j('bB')` says "the opponent has a bishop" but cannot say **which colour**. The fix is the second `I` call (`I(W),E=a,` — order is load-bearing: `I(!W)` must run **last** so `a`/`F`/`m` end up holding the *queried* side's material).

Same-coloured bishops stay a draw, correctly: a brute force over **3,037,152** four-piece positions found **no** mate with both bishops on one colour — they can never attack the square the king flees to.

**Cost: +10 B.** Adding the second `I` call costs 9 B, but the knight branch's `j('bB')` then becomes **free to delete**: whenever `F` is set, `I`'s own threshold (`!m & F*2+a<3`) forces `a==0`, so `~a` is `~0 = -1` and `!(E&~a)` collapses to `!E` — *exactly* "the opponent has no bishop", which is what `j('bB')` said. Factoring the colour test out as a shared `&&` therefore pays for most of the new call.

Verified: **0 deviations over 760 tests** (both `Q` directions × a 20 × 19 material matrix). The old `Q` deviated on 34.

### The bright-line is an approximation (no search)

USCF's real standard is "no *forced* win," which in rare positions needs lookahead the engine doesn't have: a lone `K+N` (or same-colour `K+B`) **can** force mate when the enemy king is trapped by its **own pawn**, and `K+2N` wins only inside the Troitsky zone for the exact pawn placement. With no search, the engine uses the material bright line — it calls a lone minor a draw even in those jammed-pawn forced-mate positions, and calls `K+2N` a win whenever the flag-faller has *any* pawn. This matches chess.com and most automatic implementations; only an over-the-board USCF director awards the true forced-win cases. (The FIDE side, by contrast, is exact: `Q` is a real helpmate test.)

---

## Chesseus — the rules-level axis

`o.chesseus` (`L5` default, down to `L0`) selects **how much of the rule set the engine implements**. Where the FIDE/USCF axis changes only *adjudication*, Chesseus removes whole **mechanisms** — each level down drops a fixed group of rules and produces a strictly smaller, still-playable engine. It is orthogonal to the other axes but *gates* some of them. Approximate sizes (text UI, Indicators notation):

| Level | Drops (on top of the level above) | Result codes | ~Size |
|---|---|---|---|
| **L5** | — (full FIDE; the golf-minimum reference) | `W#`/`B#` `SM` `IM` `5R`/`3R` `75`/`50` `DA` `WT`/`BT` `RM`/`WR`/`BR` | ~1.75 KB (Number) / ~1.92 KB (Letter) |
| **Armageddon** | draw offer (`DA`) and the whole claim mechanism — `3R`/`50` become automatic; the `TM` and `RM` can't-mate gates go **unreachable** (see below). Resign stays. **Not a simplification — a re-scoring.** | same codes as L5 minus `DA`/`5R`/`75`/`TM`/`RM`, each rendered with its score: `50 ⟹ BA` | ~1.79 KB (FIDE) / ~1.74 KB (USCF) |
| **L4** | resign, draw offer/agreement (`DA`), and the flag-fall can't-mate draw (a fallen flag always loses); the automatic **5-fold/75-move** draws drop to automatic **3-fold/50-move** | `W#`/`B#` `SM` `IM` `3R` `50` `WT`/`BT` | ~1.67 KB |
| **L3** | insufficient-material (`IM`, the `I` fn) and **all** repetition (the `b` key + `P` map) — only the **50-move** rule survives | `W#`/`B#` `SM` `50` `WT`/`BT` | ~1.45 KB |
| **L2** | the **clock entirely** (no time control, tick, flag-fall or clock display — the whole Time-mode axis is inert) and the **50-move** rule | `W#`/`B#` `SM` | ~1.32 KB |
| **L1** | **castling**, **en passant**, and the **two-square pawn push** — pawns move exactly one square (promotion still works) | `W#`/`B#` `SM` | ~1.00 KB |
| **L0** | **check detection itself** — every piece incl. the king is a pure geometric mover; self-check is legal, there is no mate/stalemate. Promotion is **always to a queen** (no choice). The game ends when a king is captured | **`WK` / `BK` / `D!`** | ~0.84 KB |

**How it is built.** `build()` sets a cascade of boolean flags from the level (`noRes`, `noDraw`, `noTM`, `noIM`, `noRep`, `noClock`, `no50`, `noCastle`, `noEP`, `noCheck`, `noPromo`, plus composites like `L01234`), and the same fragment-assembly that handles every other axis simply omits the gated pieces. Because the pieces removed are exactly the ones a lower level doesn't reference, each level's residue is clean.

Notes and interactions:

- **The `WK`/`BK`/`D!` result (L0).** With no check detection there is no mate; the game ends only when a king is **removed from the board**. `s.indexOf('K')<0 ? 'BK' : s.indexOf('k')<0 ? 'WK'` awards the win to whoever captured the enemy king. The draw `D!` uses a one-shot pending flag `w`: once only the two kings remain, the side to move gets **one more half-move**; if it doesn't capture the enemy king (the kings weren't adjacent), it's a draw. No adjacency geometry is computed — the follow-up move itself decides.
- **Armageddon keeps everything L5 has except the draw offer.** Strict notation, the clock, repetition and the 50-move rule all stay live; only `DA` and the claim mechanism go. It is the one rung on this axis where the **FIDE/USCF radio stays live** (`fedInert` is false there) — see the Armageddon section for why.
- **Strict notation stops at L3.** L2 and below have no clock / 50-move / repetition to annotate, so only Indicators / blindfold remain meaningful. The UI disables the Strict radio there and `build()` forces `strict → counted`.
- **The clock axis goes inert at L2.** With `noClock` there is no `setInterval`, no `U`/`N` decrement, no flag-fall — the entire Time-mode option stops affecting the emitted engine.
- **Standard vs Chess960 stops mattering at L1.** Castling was the *only* thing that differed between the two in the move engine; with `noCastle`, `std` and `960` builds are byte-identical — only the starting arrangement differs.
- **Promotion.** Kept through L1 (full under-promotion choice). At **L0** it is always a queen (`noPromo`) — the promotion-piece parse/parameter is dropped, and move text shows the bare `a7a8`.
- **`cancelGuard`** applies only to the prompt UI at **L2/L1/L0**.

Move-generation baselines: L2–L5 perft 20/400/8902 from the start; L1/L0 (pawns move one square) 12/144/2124.

---

## Armageddon

`o.chesseus === "Armageddon"` sits between L5 and L4 on the same radio, but it is a different *kind* of thing: the other levels **remove rules**, Armageddon **re-scores results**. Black has **draw odds** — every draw counts as a Black win — which is exactly the real tie-break format.

The ordinary result codes all still fire and are still stored in `z` (`W#`/`B#`, `SM`, `IM`, `3R`, `50`, `WT`/`BT`, `WR`/`BR`), so the engine still reports **how** the game ended. Only the *score* is read back, in the renderers:

```js
z + (z>'W' ? '->WA' : '->BA')      // text UIs, Letter
z + ' ⟹ ' + (z>'W' ? 'WA' : 'BA')  // DOM, Letter
z + ' ' + (z%5==1)                 // both, Number  — "6 true" / "17 false"
```

In **Number** the letter comparison is dead (`z` is an integer, and `6 > 'W'` is `false`), so the verdict rides a residue test instead: the three White codes reachable here are `W#`=1, `WT`=6, `WR`=16, all ≡ 1 (mod 5). That equivalence holds for the *reachable* set only — see the testing note on it before changing the numbering table or this level's rule set.

White's wins are exactly the three codes beginning with `W` — `W#`, `WT`, `WR` — and **every** other code (Black's three, plus every draw) is a Black win. The display shows both: `50 ⟹ BA`, `W# ⟹ WA`.

`z>'W'` rather than `z[0]=='W'` (−5 B): every W-code is two characters that *start* with `'W'`, so it shares the whole of the one-character `'W'` and then has more — greater. Every other code's first character sorts below `'W'` (87): `T`(84) `S`(83) `R`(82) `I`(73) `B`(66) `5`(53) `3`(51). The two tests agree across the entire code set.

### What follows from draw odds

**Draw offers are meaningless** — a draw is *already* a Black win, so there is nothing to offer and nothing to agree. `DA`, the `e` bitmask, the offer cooldown `n`, the `=` suffix syntax and the DOM `½` control all go. And with no claim mechanism, `3R`/`50` become **automatic** (as at L4): if Black could claim at any moment, the claim is assumed always made.

**The clock carries the compensation.** Draw odds are a large gift; in real Armageddon play White is paid for the must-win burden in *time*, and the generator now bakes that in. At this level — and no other — the two clock fields are bound by **`wt ≥ bt + 60`**, seeded at **5\|4**. This is a **generator-side rule only**: `build()` never sees it (it just receives two numbers), which is why the engine core stays byte-identical and the whole mechanism costs **+4 B** — the price of `U=N=6E2` becoming `U=3E2,N=240` once the clocks stop being equal. Note the bound is *one-sided*: it stops the gap from **closing**, never from widening, so 5\|1 or 60\|1 are as legal as 5\|4 — the engine has no opinion on how steep the odds are, only that they point the right way.

**Resign stays** — it is one of White's three wins, and a Black resign is just another Black loss.

**The game can end early.** The only question the engine has to track is *"can White still win?"*. The moment the answer is no, Black has already won and playing on is pointless. So the one-sided test `armIM` runs as a **terminal condition inside RESULT**, next to the other automatic draws — the engine does not wait for mate, stalemate, a flag-fall or a resign.

That early stop makes two L5 mechanisms **unreachable**, and they are dropped:

- **`TM`** (flag-fall can't-mate gate) — White cannot reach a flag-fall without winning material, because `armIM` would have ended the game first.
- **`RM`** (resign can't-mate gate) — same reason.

It also kills the symmetric `I(2)` insufficient-material test, which `armIM` **strictly subsumes**: if *neither* side can mate then White certainly cannot. Verified over a 400-position material matrix — *"`I(2)` fires but `armIM` does not"* happens **zero** times, while `armIM` fires on 41 positions `I(2)` misses. And with `I(2)` gone, the `v>1` both-sides branch inside `I` goes dead too (`v` is only ever 0 or 1), so `p>_ && v>1|p<u==v` collapses to `p>_ & p<u==v`.

**Net effect: adding a test made the engine smaller.** Armageddon lands *below* L5 in every interface.

### `armIM` — "can White still win?"

The two rule sets answer that question the same way they answer it at L5, so the `fed` axis stays live here (it is inert at L4 and below).

**FIDE** — Art. 6.9, a **helpmate** test, and that is exactly what `Q` computes. `Q(W)` = *"W's opponent cannot mate"*, and the opponent of side 0 (Black) is White, so `armIM` **is** `Q(0)` — not a second, parallel test, but the same expression with the one fixed argument folded in. It therefore inherits `Q`'s corrected bishop branch for free. With `W` constant and exactly one call site, the `Q=` binding and the `W=>` arrow are dead weight, and `c[+W]` always selects the lower-case letter:

```js
(j=c=>!s.includes(c),I(0),E=a,I(1)&(!a&!F|j('n')&j('p')&((F&j('r')|a)&&!(E&~a))))   // 81 B inline
```

**USCF** — Rule 14E, a **forced-win** test, applied as the same material bright line the L5-USCF flag-fall uses. There the claimant is `!U`; here it is always White, so `I(!!U)` folds to `I(1)` and `'pP'[+!U]` folds to `'p'`:

```js
(I(),!m&(F*2+a<3|!a&F<3&!/p/.test(s)))                                              // 38 B
```

- `F*2+a<3` → **14E1/14E2**: White is a bare king, a lone knight, or same-coloured bishops. This *is* `I`'s own verdict — so `I` need not return it (see below).
- `!a&F<3&!/p/.test(s)` → **14E3**: White has **two knights** *and* Black has **no pawn**. `K+2N` cannot force mate — every attempt stalemates — but a single Black **pawn** unfreezes it: the pawn always has a move, so stalemate is off and the knights can mate. Hence one pawn cancels the draw. `F<3` keeps `K+3N` out; three knights *do* force mate.
- `!m & (…)` → no queen, rook or pawn on White's side. Common to both arms, so factored out.

Both arms read the `a`/`F`/`m` that `I()` just filled, so **`I` is called for its side effects only** — and because its verdict is folded into the first arm, `I` here drops *three* things at once: the `v` parameter (armIM is its only caller, always `I(1)`), the colour test `p<u==v` with `v=1` folded in (→ plain `p<u`, count White only), and the verdict tail. −8 B against carrying parameter and verdict separately.

The two disagree a lot, and always the same way — **USCF draws where FIDE plays on**:

| White | Black | FIDE | USCF |
|---|---|---|---|
| bare `K` | anything | `IM` | `IM` |
| `K+N` | `K+R` | plays on (rook blocks its own king → helpmate) | **`IM`** (14E2) |
| `K+B` | `K+N` | plays on | **`IM`** (14E2) |
| `K+B` | `K+B` (opposite) | plays on (helpmate exists) | **`IM`** (14E2) |
| `K+2N` | bare `K` | plays on (helpmate exists) | **`IM`** (14E3) |
| `K+2N` | `K+P` | plays on | plays on (14E3's pawn exception) |
| `K+3N`, `K+Q/R/P`, opposite bishops, `B+N` | — | plays on | plays on |

That asymmetry is inherited wholesale from L5 and is the *point* of the `fed` axis, not an artefact of Armageddon. FIDE's helpmate test is exact and decidable with no search, so the engine may safely adjudicate on it; USCF's *"unless he has a forced win"* clause is not, and the bright line is the same approximation documented above — a lone minor is called a draw even in the rare jammed-pawn forced-mate positions. Adding search would make the USCF side exact too.

### Sizes

| Interface | L5 FIDE | **Armageddon FIDE** | L4 | Δ vs L5 | Δ vs L4 |
|---|---|---|---|---|---|
| input / Indicators | 1937 | **1836** | 1713 | −101 | +123 |
| input / strict | 1970 | **1866** | 1742 | −104 | +124 |
| input / blindfold | 1874 | **1770** | 1646 | −104 | +124 |
| prompt / Indicators | 1925 | **1816** | 1696 | −109 | +120 |
| dom / Indicators | 2553 | **2363** | 2172 | −190 | +191 |
| dom / strict | 2583 | **2391** | 2204 | −192 | +187 |

Armageddon lands almost exactly midway. The DOM saving is double the text UIs' because the draw offer costs twice there — once in the engine (`e`, `DA`, `Cl`, the `5R`/`75` thresholds, the `TM`/`RM` gates) and again in the markup (the `½` radio, `X`'s draw arm, the `x.checked` / `x.style` render lines).

USCF Armageddon is a further ~56 B smaller than FIDE's: the bright line (38 B, and it lets `I` shed its parameter and verdict) is cheaper than the helpmate test (81 B, which needs `I` twice) — but less correct.

### The DOM arrow, and why it is DOM-only

The score separator is `⟹` (U+27F9) on the clickable board and a plain ASCII `->` in the text UIs. This is not a style choice. The DOM board is **already** non-ASCII (`♚♛♜♝♞♟`, `⏱`, `⚐`, `♕♖♗♘`), so it already takes the download's UTF-8 BOM and already passes its glyphs through RegPack — one more multi-byte glyph rides along for free with the same protection. The text UIs are pure ASCII: they build their board at run time from char codes and carry no glyph at all, so they skip the BOM entirely (see the download's `/[^\x00-\x7F]/` test). Putting a `⟹` there would flip them to non-ASCII and cost **3 B of BOM** for one cosmetic character.

Where the arrow *sits* is then a byte question whose answer flips with the arrow's length, so `build()` doesn't state a rule — it builds both and keeps the smaller (a **min-select**, as with the board-literal fold):

- arrow **outside** the ternary: `z+'<arrow>'+(z>'W'?'WA':'BA')` — one copy of the arrow, two of the quotes
- arrow **inside**: `z+(z>'W'?'<arrow>WA':'<arrow>BA')` — two copies of the arrow, but two quotes and a `+` fewer

A 2-byte `->` is cheap to duplicate, so inside wins (−1 B). A 5-byte `' ⟹ '` is not, so outside wins (−2 B). Verified through a real RegPack run: the packed DOM engine still contains the glyph, still executes, and compresses to the same ratio as an L5 board (RegPack's token pool is ASCII 1–126, so a multi-byte glyph is never chosen as a dictionary key, and its `getByteLength` uses `encodeURI`, so it is measured correctly).

---

## Castling

Both standard and Chess960 finish in the **same FIDE squares**: king on g/c, rook on f/d. They differ only in the **input square** you give for the king.

**Standard — king to g/c (e1g1 / e1c1).** You castle by moving the king two squares toward the rook. The make-move clause is fixed-geometry:

```js
mCastle = "P=='K'&&A(Q-f)==2&&(s[f+Q>>1]=s[r=Q>f?f+3:f-4],s[r]=_)"
```

- `P=='K' && A(Q-f)==2` — a king whose move spans exactly two board indices = a castle. In standard chess castling is a same-rank move, so index distance and file distance coincide; `A(Q-f)==2` holds for both O-O (e1→g1) and O-O-O (e1→c1) and for no normal king move (adjacent squares differ by 1/7/8/9, never 2). Standard-only: Chess960 uses a different clause keyed on the rook square.
- `s[f+Q>>1]` — the square the king passes through (the midpoint of `f` and `Q`); the rook lands there. `f+Q>>1` is exact because `f+Q` is always even for a castle, and `+` binds tighter than `>>`.
- `r = Q>f ? f+3 : f-4` — the rook's home (h-side for short, a-side for long); it is then cleared.

(Standard is **not** king-takes-rook. Typing `e1h1` would land the king on h1, which is wrong.)

**Chess960 — king takes rook.** Because a 960 king can start right next to its castling destination, the unambiguous input is to move the king **onto its own rook's square**. The make-move clause is *position-independent* (it reads everything from the target `Q`, the rook's home):

```js
if(P=='K') C&R[Q] && y==e && (s[Q]=_, s[j+(Q>f?6:2)]=q, s[j+(Q>f?5:3)]='rR'[+W])
```

- `C&R[Q]` — the right is held **and** `Q` is a rook square (`R[Q]` is its bit; a non-rook `Q` gives `undefined` → 0).
- `y==e` — **mandatory.** It pins `Q` to the king's rank; without it, a king capturing an *enemy* back-rank rook would borrow that rook's bit and mis-castle.
- `j+(Q>f?6:2)` / `j+(Q>f?5:3)` — king to g/c, rook to f/d, computed rank-relative (`j` = the rank's first square).

The king ends on g/c, the rook on f/d, exactly as in standard play — only the way you *enter* the move differs. The 960 `R` map also carries the king home squares, so the generic `C&=~R[f]&~R[Q]` clears castle rights on departure (no separate clause needed).

---

## Chess960 details (`castle960(arr)`)

`castle960(arr)` produces the 960-specific fragments: the start `board`, the `R` map, the `G` castling clauses (`gShort`/`gLong`), the `M` line, and the king/rook file positions.

- **Long-castle bit test:** it must be `C&R[r+rlf]` (or `C&8>>W*2`), **never** `C&R[r]` unless the long rook is on the a-file.
- **Combinatorics:** 960 = **56 king-rook skeletons** (choose 3 of 8 files, king between the rooks) × the fillings (two knights, two opposite-colour bishops, one queen). A horizontal mirror pairs the skeletons into **28 mirror-pairs**. The generic engine covers all 56.
- The Generator's 960 ID picker accepts **0–959** (Scharnagl numbering) and defaults to **518 = the standard starting position**.

### The queenside discovered-check guard (b-file long rook)

Every *normal* move is made on a scratch copy and then filtered by `J(W)` (own king not left in check) — but the **castling clauses bypass that filter**. Each clause pushes the castle directly after its own static `!O`/`!L` transit tests, which are computed **while the castling rook still stands on its home square**, so they cannot see a check that only opens *after* the rook vacates.

This bites on exactly the arrangements where the **long rook sits on the b-file** (`rlf===1`). There, queenside castling sends the king to c1 and vacates **b1**, which lies on the first rank *between* the king's destination (c1) and the corner (a1). An enemy rook or queen on a1 is blocked by the friendly rook on b1 at test time, so `!O(2)` passes; once the castle executes and the rook leaves b1, the a1→c1 rank opens and the king would land **in check**.

**The fix** (in `castle960`, applied to `gLong` only, when `rlf===1`):

```js
if(rlf===1) gLong = gLong.replace("&&m.push(r+1)",
                                  "&&(s[r]<u==W|V(s[r])<'Q')&&m.push(r+1)");
```

The inserted guard `(s[r]<u==W | V(s[r])<'Q')` **allows** the castle unless a1 (`r+0`) holds an enemy
straight-slider. It is the De Morgan of `!(enemy & R/Q)`, which spells the same test more cheaply
than the negation does — **both** arms have to fail for the castle to be refused:

- `s[r]<u==W` — a1's piece is the **same colour** as the mover (`<u` = uppercase/White; `==W` = the mover's colour). A friendly piece there can never give the discovered check, so this arm alone lets the castle through. Empty `-` (45) also reads as "White" here; that is harmless, because empty cannot attack and the second arm passes it regardless of `W`.
- `V(s[r])<'Q'` — uppercasing folds colour away, and only **Q (81) and R (82)** reach `'Q'`; K/N/B/P and `-` are all below it. So the castle also passes whenever a1 is *not* a straight slider — the only piece type that attacks c1 **along the rank** through the vacated b1. A bishop on a1 attacks diagonally, not through b1, so it is correctly ignored (and any such non-rank attack on c1 is already covered by the untouched `!O(2)`).

**In Number notation the guard is rewritten, not translated.** `<u` and `V()` are both char-only and
step 2 of the numeric conversion deletes their bindings, so the char form cannot survive — and
because `|` does **not** short-circuit, the dead `V()` call is evaluated on every pass, throwing
`V is not defined` the moment queenside castling is generated. (Not `u is not defined`: `inclHoist`
runs *after* the converter and rebinds the freed `u` to `'includes'`, so `u` is live and
`s[r]<'includes'` merely reads false.) Both converters carry the rewrite:

```js
s = s.replace("(s[r]<"+T_+"==W|V(s[r])<'Q')", "(s[r]^W|2)!=7");
```

Raw codes are `folded*2 + colour` with colour 1 = White, so the four straight sliders are exactly
`r=4, R=5, q=6, Q=7`. `^W` folds the mover's colour away and maps **both** enemy sliders onto the
same pair (`r`/`q` at `W=1` → 5/7; `R`/`Q` at `W=0` → 5/7); `|2` merges that pair
(`5|2 == 7|2 == 7`); and a single `!=7` then reads "a1 does not hold an enemy rook or queen".
Nothing else collides — empty 0, bishops 2/3, the *friendly* rook/queen, pawns 8/9, kings 10/11 and
knights 12/13 all land off 7 for either `W`. **−10 B** against the char form, verified truth-table
identical to it over all 13 piece codes × both colours.

**Keep the parentheses.** `!=` binds tighter than `&&`, so `&&(s[r]^W|2)!=7&&` is correct — but `|`
is *looser* than `!=`, so dropping them yields `s[r]^W|2!=7`, i.e. `s[r]^W|1`: the low bit is forced
on, the guard is always truthy, and it vanishes silently on every square. It is the `1` that does
the damage, not the OR itself — `s[r]^W|0` still reads 0 when `s[r]==W`, so that form would at least
fail loudly somewhere.

Testing a1 alone suffices: b1 is the only square that vacates, and the only rank-1 square left of c1 besides a1 is b1 itself — so the discovered attacker can only be exactly on a1. **This is not an emptiness test and never scans**, so the off-board hazard below does not apply: `s[r]` is a fixed on-board index, and an empty a1 is safe in both encodings — `V('-')<'Q'` is `true` in Letter, and `(0^W|2)!=7` is `true` in Number, for either colour. It is emitted for `rlf===1` only; the mirror geometry does not occur on the kingside (there the short rook lands *on* f1, filling not vacating, and any h1 attacker on g1 is a direct threat already caught by `!O(6)`).

### The rook-path emptiness rewrite must not hardcode an offset (fixed)

`clause()` derives its rook-path emptiness tests from the **arrangement**, so the offset it emits
varies by skeleton:

```js
const emptChecks = es.map(n => n===0 ? "s[r]==_" : "s[r+"+n+"]==_");
```

Standard chess only ever needs **b1**, so the emitted string is always `s[r+1]==_`. Both numeric
converters translated it with a rule pinned to that one offset:

```js
s = s.replace(/s\[r\+1\]==_/, "!s[r+1]");        // WRONG — offset 1 only
```

In Chess960 the same clause emits `s[r+3]==_` (**276** arrangements) and `s[r+5]==_` (**108**).
Neither matched, so a raw `_` survived into a Number engine — where `_` is **never bound**, because
step 2 of the conversion deletes the `_='-'` char marker. The engine loaded and rendered fine, then
threw `ReferenceError: _ is not defined` on the first move that reached the castling generator.

**Scope: 384 of the 960 arrangements**, on `notation:number` + `rules:960`, at every level that has
castling (**L5, Armageddon, L4, L3, L2** — L1/L0 emit no castling at all), on `input` and `dom`
alike. Letter was never affected; it keeps `_`. Federation, clock model, rotation, info level and
the bot axis are all irrelevant — the bot merely reaches the castling generator sooner, which is why
the failure first surfaced on `bot:"R"` and looked like a bot bug.

**The fix** — match any offset, including the bare `s[r]==_` that `rlf===0` produces:

```js
s = s.replace(/s\[r(\+\d+)?\]==_/g, (m,off) => "!s[r"+(off||"")+"]");
```

Anchoring on `==_` keeps it off the `>_` occupancy tests rewritten immediately above. Applied to
**both** converters (`toNumericText` and `toNumericDom`) — they carry the rule independently, and
patching one would have left the other interface broken. Cost: **−2 B** on affected engines
(`!s[r+3]` is shorter than `s[r+3]==_`), ±0 everywhere else.

**The general lesson, which is the reason this is written down.** A numeric rewrite rule keyed on a
*literal board offset* is a rule that silently only covers standard chess. The converters are
string-to-string passes over generated code, so a rule that fails to match does not error — it
leaves the char form in place, and char forms reference `_`, `u`, `V()` and other bindings that
numeric mode has removed. **Every such rule must be written against the shape `clause()` can emit,
not against the shape the standard start position happens to produce.** The same hazard applies to
any future rule touching `s[r+…]`, `s[f+…]` or `s[j+…]`.

**How it escaped.** Parse-checking cannot catch it: `s[r+3]==_` is syntactically valid, so
`new Function(src)` passes and the engine ships. It needs **execution**, and specifically execution
that reaches the castling clause — a bare load is not enough, because the throw happens on the first
move generation, not at init. This is the same failure mode the testing notes record for the
`prompt`+`strict` `Z` bug, and the same remedy: *run* the matrix, don't just parse it.

---

## The website (three tabs)

**Introduction** — an interactive exhibit built as **three stacked panels**, each an annotated engine-source block with its own byte/title badge, presented **bare-core first**, then rules, then interface:

1. **Bare-core panel** — an interactive **per-concept explorer** of the pure move generator + state (no interface, no clock UI). A radio-style button group lights up each concept's trace through the source. **23 concepts**: the six pieces, en passant, promotion, castling, mate/stalemate, 50/75-move, 3/5-fold repetition, insufficient material, draw request, resign, time/flag-fall, flag-fall vs material, threat/check, **legality**, move plumbing, state, relative state, helpers. A drift guard asserts that **every concept still matches at least one span** and names the ones that match nothing. Display-only; the emitted engines are byte-identical regardless. *(Always shows the FIDE core, including `Q`.)*
2. **Rules panel** — toggles for **rules / clock / periods / rule set**, plus the **Draw-request limit**. **It shows the same interface-free core as panel 1**, rebuilt at the current rule settings: at the default it *is* panel 1's file, byte for byte, and the axes move it from there. That is the point — every axis on this panel (Standard/Chess960, FIDE/USCF, the four clock models, multi-period, the draw cooldown) is an **engine** axis; none of them touches the input driver. Rendering them on a full `ui:'input'` engine meant half the panel was render/parse code that never moved no matter which button you pressed, and the rule change had to be hunted down among the `onkeyup` and `D()` calls. Both panels now call the same **`bareCore(o)`** (hoisted into the scope they share), so the reader sees only what the buttons actually change. Switching off the default re-renders the source as a **red/green diff** against the std · sudden · single-period · FIDE baseline, with a live byte badge; the filename badge tracks the axes (`basic_core-960-uscf.js`). The **Draw-request limit** button is fully functional — with periods on it shows the cooldown reusing `B` (timestamp form); with periods off it shows the standalone countdown. A **FIDE ↔ USCF** pill diffs the result-fragment changes.
3. **Interface panel** — toggles for **interface** (prompt / input / clickable), **notation** (Indicators / strict / blindfold), and **rotation**. This is where the interface lives, and it shows the **full HTML page** with **role-based highlighting**: engine core plain, interface code turquoise, notation code orange, rotation code purple. Enforces: **dom + blindfold mutually exclusive**, **prompt + strict mutually locked**, **rotation disabled under blindfold**. Calls `build()` directly. *(Shows the L5 engine; the Chesseus axis is exercised from the Generator tab.)*

*(Two further views, `view-tech` and `view-rules`, still exist in the markup as "coming soon" placeholders but have no nav button and are unreachable.)*

The three panels therefore split cleanly along the project's own seam: **panel 1 = the core**, **panel 2 = the core's rule axes**, **panel 3 = the interface wrapped around it**.

**PGN tester** — replays a historical game through FideLite's own engine (Standard or Chess960) and shows its reaction at every half-move. It opens on a live board at the starting position with no PGN loaded, so pieces can be pushed around and the counters watched without pasting anything; loading a PGN replaces that game wholesale, and manual moves past the last PGN ply truncate forward history and continue. SAN is converted to the engine's moves with the engine's own legal-move generator, so the replay is only as legal as the engine is — which is the point: a PGN that will not replay is a movegen bug, not a parser bug. There is no clock in the logic; each ply just renders about a second apart so it is watchable. The game does **not** auto-end on the PGN's last move — only natural endings stop it (mate, stalemate, 3/5-fold, 50/75-move, dead position). Flag drop and resignation are manual buttons and the engine decides win-vs-draw (`TM`/`RM`). A live counter matrix shows the state the engine is actually keeping at each ply: side to move, ply/move number, the halfmove clock `o`, the repetition count, the ep target `Y`, the castle mask `C`, `J(T)`, the last UCI move, and the verdict `z`.

**Generator** — the factory: a left control panel (all option axes, clocks, and a FEN/position editor with castling-rights toggles) and a right panel with **Code** (highlighted source) and **Preview** (sandboxed iframe) sub-tabs, plus Copy, **Download** (the plain engine), and **RegPacked** (the compressed build). The **Rules** fieldset holds the Standard/Chess960 choice, the draw-offer cooldown, and a **FIDE ↔ USCF** switch. A **Chesseus** control (L5 → L0) picks the rules level — with an **L6 placeholder** shown disabled above L5 (locked-position detection, plus forced-mate search under USCF); it is a stated intention, not an implemented level, and `build()` knows nothing about it. The **Bot** fieldset carries the ladder (`off` / `R` / `B1`–`B5`) and, for the search rungs only, a separate **search-depth** group (1–4 plies) that is hidden entirely when it would be inert. the meta summary and download filename append the level (e.g. `_L4`, `_L0`; L5 is omitted), and picking a lower level live-updates the dependent controls. The **FEN board editor** opens in place over the Code/Preview area via **Draw board** (it is not a tab). The size readout shows the engine's byte length; for the **DOM** build it adds *"(on-disk size may be larger)"*, since the clickable board's Unicode glyphs are one character but three UTF-8 bytes each on disk.

### The board editor and Chesseus

The Draw-board editor is **level-aware**: fields the current level's engine would ignore are **disabled** (greyed) and update live when the Chesseus radio changes. **Castling** and **En passant** disable at L1/L0; the **½-move** (50-move) clock disables at L2 and below; **Repetition** disables at L3 and below. Where a field stays active, its range is level-scoped: **½-move** caps at `149` (L5, 75-move) / `99` (L4/L3, 50-move); **Repetition** runs `1–4` (L5, fivefold) / `1–2` (L4, threefold). A **Draw claim** selector seeds a pending claim into the emitted engine — `none` / `White claimed` / `Black claimed` (never *both*: that is agreement, so the game would already be over); it is disabled below L5 and reset to `none` there. See *Seeding a pending claim* for the byte form and the cooldown interaction. The editor also enforces a **two-kings-plus-one** rule: exactly one king each is required, and a board of *only* the two kings is rejected (an immediate dead draw). This check is editor-only; it does not fire on a FEN typed directly into the FEN box.

#### The en-passant target is validated for **legality**, not just geometry

A FEN's ep field is not free-form: FIDE only records an ep target when the capture can **actually be played**. The engine already gets this exactly right — it sets `Y` only if

```js
[Q-1,Q+1].some(q => s[q]=='Pp'[+W] && G(q).includes(Y))
```

i.e. some adjacent enemy pawn's **legal** move list contains the ep square. `G()` runs the make-move + `J(W)` self-check filter, so a **pinned** capturer never registers and `Y` stays `_`. The editor now applies the same test, because a hand-written FEN is the one way a bad `Y` can get into an engine that would never have produced it.

**Why this matters more than it looks: `Y` is part of the repetition key** (`P={[b=s+T+Y+C]:1}`). A spurious ep target makes the opening position hash differently from the *same* position reached later in the game, so the threefold/fivefold counter silently misses a repetition it should have caught. The engine computes this correctly from move one; the editor is the only door a wrong value can come through.

The case that motivates the full simulation — and the one a naive "is the capturer pinned?" test misses — is the **horizontal pin**: an ep capture vacates **two** squares on the same rank at once (the capturer's origin *and* the captured pawn's square), so a rook or queen on that rank can suddenly see the king through both. The editor therefore mutates the board exactly as the capture would leave it (land on the ep square, clear the origin, clear the captured pawn) and asks `edInCheck`. The target stands iff **at least one** capturer survives that test.

Verified against the engine as oracle over 480+ random ep positions and the pin/blocker/edge-file cases: **zero disagreements**.

At **L1/L0** en passant does not exist (`build()` emits no `Y` at all, and an ep-bearing FEN produces a **byte-identical** engine to one without). Greying the control there is not enough, so the editor also **clears** the target: otherwise `edBuildFEN()` would write out an ep square the chosen engine provably ignores, and the ep validation would lock the *Use FEN* button over a rule that level does not implement.

### Download & the BOM

Download writes the engine through a `Blob`, prefixed with a **UTF-8 byte-order mark** (`"\uFEFF"+code`). The BOM (3 bytes) is the cheapest reliable way to make a *locally opened* file decode as UTF-8: with no HTTP `Content-Type` header, some mobile browsers guess the wrong charset and render the chess glyphs (`♚♛♜♝♞♟ ♕♖♗♘ ½ ⚐ ⏱`) as mojibake. The BOM outranks the meta-prescan.

- **The BOM lives only on the download path, not in `build()`.** The site preview and the exhibit use `build()`'s output directly; only the saved file carries the mark.
- **It sits before `<script>`**, so the parser swallows it as an encoding signal.

A `<meta charset=utf8>` tag (19 bytes) is the documented fallback if a viewer ever ignores the BOM.

### The Rules panel derives from `build()` — there is no segment table

The Rules panel **used to** be driven by `<script type="application/json" id="segData">`: the engine, hand-split into constant runs and per-axis variants, reassembled for display. **That table is gone.** It drifted the moment `build()` was golfed — it encoded the engine's *shape*, and the shape is exactly what golf changes; by the end it still described a `move=(f,l,p,Z)` function that `build()` had long since inlined into the UI driver. (That dead `move` is unrelated to the live one `bareCore()` synthesises today — see the next section. The coincidence is instructive rather than confusing: a `move()` wrapper is the natural way to talk about a ply, which is why the hand-maintained table reached for one too. The difference is that this one is *derived* on every render instead of transcribed once.)

No table is needed. The panel only ever wants two strings: the core at the **current** settings and the core at the **default** settings, so it can tint the difference. `bareCore()` yields both directly. Nothing to hand-sync, and **nothing that can drift**: change a core fragment and every panel changes with it, because all three read the same `build()`.

### `bareCore()` — what the wrapper is allowed to invent

`bareCore()` cuts the interface out of `build()`'s output and re-exposes the surrounding logic as a
function. The line it must not cross is this: **it may rename and re-frame what it invents, and
nothing else.**

`build()` emits no `move()` at all. In a real engine the whole ply — read input, check resign, check
legality, call `M`, flip the side, compute the result, run the draw bookkeeping, render — is inlined
into the UI driver (`onkeyup=…` in text, `K()` in dom). `bareCore()` drops the parsing and the render
and wraps the remainder:

```js
move = (from, to, promo='q', drawRequest=0, resign=0) => z ? z : ( … , z)
```

All five names are the wrapper's own, so spelling them out invents nothing. **Both entries are
parameters on purpose.** The draw request always was one (the text driver's `/=$/.test(i)` becomes
`drawRequest`). Resign was the hold-out: it used to be rewritten to `f=='r'`, which is not a rule but
the text parser's letter test wearing a different variable name, and reads as nonsense chess. The two
interfaces genuinely disagree there — text types `r`, dom presses ⚐ — so an interface-free core must
show neither.

A placeholder **token** (a bare `RESIGN`) was considered and rejected. The panel presents this core as
a file with a byte badge, and the core **runs**: `move(52,36)` plays e2-e4, `move(0,0,'q',0,1)`
resigns. An undefined identifier would end that. Short names were tried first and every meaningful
single letter is taken — `R` is the castling-rights map, `Z` is `M`'s is-a-pawn flag, `f` is the
move-shape function, and all three would have been **shadowed** inside `move()`'s body. Only
`h/n/t/w/X` are free and none of them says anything.

`M` keeps its golfed `(f,Q,p)` because `M` *is* `build()`'s output. That asymmetry is the honest line
between engine and exhibit — and worth understanding, because the two do different jobs: `M` applies
a move and **validates nothing** (`M(56,0)` will drag the a1 rook up a blocked file without complaint),
which is exactly what lets `G` call it on a scratch copy to test candidates. Validation lives in the
caller.

One more rule, learned the hard way: **replay the engine's spelling, never normalise it.** The gate
rewrite has to tolerate `inclHoist` having folded `.includes(` into a one-letter method reference, so
it captures the spelling and puts it back. An earlier version rewrote it to `.includes(` instead, and
the panel then printed one call in a form `build()` never emitted while the two other call sites in
the same core still read `[x](`. If the alias is ever to go, it goes for the whole core in one
deliberate pass — not as a side effect of one substitution.

### The concept map — what a highlight is allowed to say

Each entry in `CONCEPTS` returns index spans into the displayed core. The governing rule is that
**a concept paints what it *is*, never the machinery it rides on**, and never another concept's rule.

- **Pieces are geometry only.** Clicking a piece answers one question: where may it move. The shared
  move-generation and legality machinery used to be appended to all six, which told the reader nothing
  about the piece they had clicked and dragged in fragments owned by others (`c` is the pawn's
  condition, `a`/`b` exist only to feed the slider scan, `r=!W-W` is the pawn's direction). Sliders
  keep the path-clear scan, because "may not jump over a piece" is part of how they move; knight and
  king have no such test and the pawn carries its own, spelled `_+_`.
- **Special moves are not folded into the piece that performs them.** Castling, en passant and
  promotion are their own concepts even though the same code runs.
- **The bishop/rook split is deliberately asymmetric.** The discriminator `(D*H ? D==H&P<'R' : P>'B')`
  sends them into opposite branches. The bishop takes its arm alone — `D==H` *is* the diagonal and
  `P<'R'` is the type, so the arm is already complete and adding the selector would be true but noisy.
  The rook needs both, because its arm is a bare type test with **no geometry in it at all**: the
  rook's "straight" lives entirely in the selector reading zero. Do not "restore symmetry" here.
- **Overlap is legitimate when both concepts really execute the code.** The rook painting the bishop's
  arm was wrong because the rook never runs it. `draw` painting `o>99?'50'` and `P[b]>2?'3R'` is right
  even though `counter` and `rep` show them too: those two literals exist nowhere else in the engine,
  sitting inside the `Z?` branch and reachable only through a request — drop them and the *claim* half
  of "draw request" disappears. (Their automatic counterparts, `75` and `5R`, live in the `z=` chain.)
- **`sub()` returns the FIRST match, and that is the main source of silent mis-painting.** `D*H` also
  occurs in the knight's `D*H==2`, so the sliders reach it through the `D*H?` anchor; `&S()` occurs
  first inside `SDEF`'s own recursion, so it is taken as a slice off the unique `)&S()` — a plain
  `sub("&S()")` lands on the definition, merges into `SDEF` and vanishes. When a fragment's text is
  not unique, anchor on something that is and slice.
- **`legality` is not `threat`.** `L`/`J` interrogate the board *as it stands*; `legality` is about a
  move, and its central act is to ask about a position that does not exist yet — save state, copy the
  board, play it, ask `J(W)`, roll back. Legality calls threat, never the reverse. Two rules a reader
  will look for and not find anywhere in this engine are **pins** and "you must address the check":
  there is no code for either, they fall out of that filter for free. Note what *bypasses* it — the
  castling clauses push straight after their own static `!O`/`!L` tests, which is exactly how a 960
  queenside castle could open a discovered check no static test could see.

The one sync hazard that remains is `castle960`'s `mLine`, where it mirrors the 960 castle line.

### The bot axis (Black AI)

`o.bot` (`off` | `R` | `B1`…`B5`) splices a Black-playing bot into the emitted script, and `o.botDepth` (1–4) sets how far the search rungs look. `off` emits nothing — the two-player engines stay **byte-identical**, verified across the full matrix. The two axes are independent by design: the rung decides *what the bot values*, the depth decides *how far it looks*, and neither implies the other.

**`R` — the random bot (all three interfaces, every level).** A deliberately mindless opponent: a uniformly random *legal* move for Black. No search, no evaluation, no state of its own. It is the minimal answer to "make it single-player". The whole picker is one shared expression:

```js
n=0,s.map((p,i)=>p>u&&G(i).map(t=>Math.random()*++n<1&&(k=i,l=t)))
```

- **`p>u` is the entire side-and-occupancy test, in three bytes.** The bot always plays Black, so the engine's general `p>_&p<u==T` collapses: Black is lower-case (`>'a'`), White upper-case (`<'a'`), empty is `'-'` (char 45) — so `p>u` selects exactly Black's pieces and rejects empties for free. The single biggest saving in the bot, available *only* because the side is fixed.
- **`G(i)` is the engine's own generator** — the bot inherits check evasion, pins, castling, en passant and promotion legality with no code of its own.
- **The reservoir sample (`Math.random()*++n<1`)** picks uniformly in one pass with no array: the r-th legal move replaces the choice with probability 1/r. Verified flat — 20/20 distinct replies to 1.e4 over 6000 samples, χ² = 17.5 (df = 19). The 17-B-cheaper "keep the last legal move" is degenerate: it answers 1.e4 with h7h5 every time, then shuffles a queen between h1 and g1 forever. Those 17 bytes buy an opponent instead of a reflex.

**Committing** is the one thing that differs by interface — a commit is `M()` + clock hook + `T^=1` + the whole result cascade (~160 B), and the bot must not duplicate it. In **dom**, `K(w)` already *is* that wrapper (the promotion buttons call it), so the bot just calls `K()` — **+79 B**. In **input / prompt** the commit sits inline in the driver, so it is hoisted into a `K2(w)` wrapper (paren-matched off the legality test's `&&(M(k,l`); the human path calls `K2(parsed promotion)`, the bot calls `K2()` and lets `M`'s promotion parameter default to `'q'` — **+92 B**, ~13 B of which is the hoist. Guarded by `z||T||`: `z` is truthy the moment the game ends and `T` is 1 on White's turn, so the bot fires only when the game is live and it is Black to move — one level of recursion at most.

**Bot move notation — squares from `k`/`l`, not from the typed text.** Both the blindfold `[E]` readout and the strict move list are built from `i.slice(0,4)` (the human's text box), which the bot never fills — so after a bot reply they would just repeat the human's move (and dom-strict additionally *threw*, calling `V(w)` with the bot's absent promotion letter). Both movers set `k`/`l`, though — the bot's picker does `k=i,l=t`, the human does `k=K(0)`,`l=K(2)` — so with a bot on, the squares are built from `k`/`l` instead. The construction differs by notation because of a name-space collision:

- **Blindfold** has no history box, so the letter `h` is free (verified across every blindfold+bot config): a one-shot helper `h=c=>'abcdefgh'[c%8]+(8-(c>>3))` is injected once at the driver head and the readout is `h(k)+h(l)`. **+6 B** (input and prompt), because the old `E=i.slice(0,4)+…+Z` line is deleted in the process. Colouring: `h` feeds the display (`E`), so it is interface (`.iface`).
- **Strict** (input, L5/L4/L3) — the history box *is* the element `id=h`, so `h` is taken, and in fact *every* single letter is already in use across strict+bot, so there is no free helper letter. Both squares are built with `[k,l].map(c=>'abcdefgh'[c%8]+(8-(c>>3))).join``` — one `'abcdefgh'` instead of two, which beats spelling each square inline. **+23 B per level**, paid only for input+strict+bot. The promotion and `Z` suffixes are **dropped** (as in blindfold): the promo test `(s[l]==p?'':V(s[l]))` keys on `p`, the moving piece the *human* driver captured, which the bot never sets — stale `p` tagged ordinary bot moves with a spurious piece letter (`b7b6P`) — and the bot always queens anyway (stated in the guide), so a bare `a7a8` is unambiguous. **dom-strict** already had its own `k`/`l` converter `t` (so squares were correct), and only its `V(w)` read needed guarding — `V(w||'')`, **+4 B** — since the bot passes no promotion arg. bot-off strict is byte-identical.

*These costs are per emitted engine, not a total: each strict-supporting level (L5/L4/L3) that a user downloads with input+bot is that engine +23 B; the same fix is simply re-paid in each. All of it is bot-only — the moment `bot:"off"`, every strict and blindfold engine is byte-identical to before.*

*Note — **Armageddon + blindfold** needs the move readout written *after* the result cascade. Armageddon's one-sided insufficient-material test has no free letter left, so it borrows the display var `E` as a scratch temp (`I(0),E=a,I(1)…!(E&~a)`) — which clobbered the `[E]` readout, showing a number instead of the move. The fix relocates the `E=<move>` assignment to just after RESULT (`histAfter`), so the scratch write runs first (harmless) and the real move lands last. Because RESULT's `z=s.some((p,i)=>…)` has by then reassigned the global `p` to the last board cell, the usual promotion suffix `(s[l]==p?'':V(s[l]))` can't be used; instead the readout reads the destination piece off the **board**, gated on the last rank: `i.slice(0,4)+(l%56<8?V(s[l]):'')`. So a promotion shows the (uppercase) piece — `a7a8Q`, `a7a8N` for an underpromotion — a normal move shows bare squares, and a stray 5th input character can't leak in. Armageddon has no draw offers (a draw is a Black win), so there is no `=` suffix. Net effect is ~1 B **under** the original per engine (input and prompt); it fixes both the bot-off and bot-on readout (same root cause — the bot path uses `h(k)+h(l)` and always queens), and leaves the material test itself byte-for-byte unchanged — only the location of the `E` write moved.*

**Number notation broke the bot in five places — all one root cause.** The `toNumericDom` / `toNumericText` passes rewrite Letter fragments into their Number equivalents from a fixed list. That list was written when the bot did not exist, so **any Letter fragment the bot introduces that the list does not recognise survives into a Number engine unrewritten**. Five separate symptoms, one bug class:

1. **The picker never fired.** `p>u` is the bot's three-byte side test, but Number deletes `u` — leaving `p>undefined`, always false. The engine parsed, measured the right size, and simply never moved. Fixed by `numBotPick(s)`, which rewrites the picker to `~p&1`. In the Number encoding a value is `folded*2 + colour` with colour bit `0 = Black` and `EMPTY = 0`, so "non-zero and even" is Black — and the bare `~p&1` (4 B) suffices without the non-zero test because `G(empty)` is always `[]`, so the inner `.map` never runs and the reservoir counter never increments. Verified over 399,560 empty-square `G()` calls. One byte longer than Letter's `p>u`.
2. **`inclHoist` bailed out entirely when the bot was on.** The `.includes` → `[X](` hoist (−5 B, L5) needs a free letter; the bot consumes only `t` (picker arrow) and `n` (reservoir). The bail was widened to the whole bot axis; narrowing it to just letter/dom/counted (needs `t`) and letter/dom/strict (needs `n`) recovers the 5 B on the other six branches — Number uses `u`, letter/input uses `x`, letter/prompt uses `h`.
3. **Blindfold + bot collided on `h`.** The hoist wanted `h`, but the blindfold bot injects its own `h=c=>'abcdefgh'…` square helper. A `botBlindH` gate skips the hoist there; letter/input/blindfold is unaffected (it uses `x`).
4. **Number blindfold echoed Letter squares.** The move readout `h(k)+h(l)` printed `h7h5` to a player typing numbers. `numBotEcho(s)` deletes the helper and substitutes `(k*100+l+1e4+'').slice(1)` — a 4-digit zero-padded index pair. **−16 B.**
5. **Number strict's move list did the same** via `twoSq`'s `[k,l].map(c=>'abcdefgh'…)`. Same rewrite, **−22 B.**

*Post-fix `R` cost: Letter dom +79, rising to **+90 at L5** because `inclHoist` yields its letter to the bot there; Letter input/prompt +92; Number dom +80, input/prompt +93. The picker and commit are byte-identical across levels **except L0**, which uses a parameterless `K2()` — it has no promotion choice, and its two-king-draw flag `w` would be shadowed by a `w` parameter.*

*A permanent guard is worth adding: scan `toNumeric*` output for surviving Letter markers (`abcdefgh`, `p>u`, `'a'`) and fail the build. The whole class is invisible to parse checks and to byte counts — only running a Number+bot engine and watching the board catches it. An early attempt at that check was itself wrong: it counted "did the bot write `k`/`l`" and passed on knight moves that happened to target the empty upper board.*

### `B1`–`B5` — the search ladder

One alpha-beta search, five evaluation rungs, and a depth that is a **separate axis**. Each rung only *adds* a term, so B1 is a strict subset of B2 and so on:

| Rung | Adds |
|---|---|
| B1 | material |
| B2 | + centre control |
| B3 | + king safety (in check is worth material) |
| B4 | + pawn advancement |
| B5 | + doubled-pawn penalty |

Unlike the version that was once removed from the generator (see the history note below), the ladder now ships on **all three interfaces, both notations and every level**.

#### It fits in ONE global, `n`

The old ladder claimed four single letters — `B` (entry), `h` (saved `K`), `n` (eval), `t` (search). **Three of those have since been taken by the engine itself**: `B` is the universal ply counter, `h` is the DOM move cache and the strict history element, and `t` is the strict square formatter *and* `inclHoist`'s `includes` alias. Measured across all 624 reachable option sets, the only single letter still free everywhere is `n` — and it is free precisely because a bot excludes the cooldown that otherwise owns it.

So the search fits in `n` alone, by three eliminations:

- **The leaf eval is inlined** into the `!D` branch as an `s.map` accumulation, so it needs no name. `P` and `c` ride the map callback's 3rd and 4th arguments — `map` only ever passes three, so `c` starts `undefined` and `P` starts as the board array, and both are written before they are read. Free locals with no name to spend.
- **`K` is not wrapped.** The old ladder saved it in `h` and installed a replacement. Instead the bot is appended to `K`'s own body, exactly where `R` already hooks, so the original commit needs no alias.
- **The entry point is the trigger expression itself**, not a named function.

Everything else rides `n`'s parameter list, and those parameters deliberately **shadow** engine globals (`a` the insufficient-material mask, `b` the repetition key, `f` the move-shape function, `g` the delay counter, plus `q`/`v`/`F`). That is safe because nothing the search calls — `G`, `M`, `L`, `J` — reads those globals *from the search's scope*: each resolves its own in its own closure. `M` already shadows the global `f` with its own first parameter, so this is the engine's existing idiom rather than a new risk.

#### The snapshot must match the level

Make/unmake is the engine's own idiom — `g=[SNAP];s=[...s];M(f,i);…;[SNAP]=g` — and `SNAP` tracks exactly the state `M()` mutates at that level: the board always, the ep target and castle mask from **L2** (L1/L0 have neither), the halfmove clock from **L3** (L2 and below have no 50-move rule). Snapshotting a variable the level does not emit would throw; missing one would corrupt the position on unwind — silent, and only visible as illegal-looking play several plies later.

#### Notation: built in the target encoding, spliced in *after* conversion

`toNumeric*` rewrites the assembled Letter script into the numeric encoding from a fixed list of literal rules, and this file already records two bugs where the `R` bot was silently missed by that pass. Rather than add the search to that list and inherit the same failure mode, the search is **built in the right notation and spliced in after the converter has run**, so there is nothing for the converter to miss or mangle.

The piece-value table is therefore indexed differently per notation and **reordered**, not reused: Letter goes through `' KPNBRQ'.search(V(q))` into `'0013359'`, Number indexes `q>>1` directly into `'0359103'`. Both put the pawn at 1, which is what keeps B4's `P==1` pawn test notation-independent.

**Where it splices differs by driver, and only for one reason.** `prompt`'s driver is a blocking loop that runs at load, so `n` must already exist when the script reaches it — the definition goes in before `;while(!z)`. `dom` and `input` are event-driven and their first bot call cannot happen until the whole script has executed, so a plain tail append is enough.

#### L0 has no check concept, so two terms vanish and one appears

The hanging-piece guard needs `L()` and king safety needs `J()`; neither exists at L0, so neither term is emitted (which is why **B2 and B3 are byte-identical there** — see the engine counts). What replaces them is the thing L0 actually plays for: the king is **capturable**, so it needs a decisive material value. The piece table gives the king the digit `0` — it is the one piece never worth capturing at L1+ — which makes `!P` a free two-byte king test. At L0 the king is worth 9000, more than every other piece on the board combined, so the search neither gives its own king away nor misses taking the opponent's.

#### The search is paid for on the bot's own clock

`R` is instant, so this never mattered; a search is not. Both clock models undercharge it for the same reason — the search blocks the main thread, and a blocked thread does not queue tick callbacks (`setInterval` coalesces to a single late fire), while prompt's elapsed model measures only from `d=new Date` at the top of an iteration to the moment the human answers, and the reply is computed after that window closes. Either way a ten-second think cost Black about one second. The trigger therefore times the search itself and takes it off `N`.

**The order of charge and commit is not cosmetic: it decides who the engine blames for the flag.** Neither model tests the clock in isolation; each blames *the side to move*, because normally only the mover's clock is running. An out-of-band deduction breaks that assumption, so each driver needs the ordering that leaves the turn pointing at the right player when the test finally runs.

- **dom / input — charge AFTER the commit.** The tick reads `U*N||(z=…)` and it **decrements first**: with `N` left at 0 and Black still to move it would step to −1, and a negative product is truthy, so the flag would never fire and the game would hang on Black's turn forever. Committing first flips `T` to White, so the next tick decrements `U` instead, finds `U*N` exactly 0 and reports `WT`. Charging after the commit also means the increment `K()` just added is itself eaten by a long think — which is what stops an increment clock from making the bot immortal.
- **prompt — charge BEFORE the commit, and skip the commit when the clock is gone (`N&&`).** There is no tick here; the test `U*N<1` runs once per iteration against `W=T`. Leaving the turn on Black makes the next iteration charge Black again and report `WT`. Committing first would hand the turn to White and the same test would blame White for Black's flag — a legitimate result silently flipped.

The clamp `N=N>m?N-m:0` is what keeps `N` off negative values in the first place; without it a single long think steps straight past the one value the flag test can see. **The charge ceils rather than floors, and it is spelled in the clock's own unit.** The elapsed time is `(new Date-m+999)/1e3|0` — `+999` is an integer ceiling, identical to `Math.ceil(ms/1000)` for any non-negative integer millisecond difference, for 4 B where `Math.ceil(…)` costs 11. Flooring undercharged every search shorter than a second, which at shallow depth is nearly every move: the bot's clock sat frozen, and on an increment clock it *climbed*, because `K()` credits the increment before the charge runs and a bot that is never charged can never flag. Under `msClock` (Number + prompt, L3+) `U`/`N` are held in milliseconds and the charge drops the divide entirely — `m=new Date-m`, 12 B shorter, and no rounding is needed because the resolution is already finer than the unit. Both drivers read one shared constant so they cannot drift apart. Getting this wrong is silent in the worst way: the seconds form on a millisecond clock charged a 3-second think 3 units out of 600000, a thousandth of its price. `m` is the trigger arrow's own parameter, so it shadows the global `m` that `I()` writes during the commit's result cascade — that shadowing is what makes it safe to hold a timestamp across `K()`.

#### The async bot has to draw its own reply on `input`

`K2` is only the commit **group** — unlike dom's `K`, which ends with `D()`, it does not render. The input driver's own `D()` sits after it in the handler, so `R` gets drawn for free: R is synchronous, so it finishes inside the handler and that render picks its reply up. A **search** bot runs from a timeout, i.e. *after* that render has already happened, and nothing draws it afterwards. From L3 up the one-second clock tick hides this by redrawing anyway; **at L2 and below there is no clock, no tick and therefore no second render at all** — the bot moved, the board kept showing the position before its reply, and the move only appeared on the player's next keystroke. So the input trigger renders explicitly. `dom` needs nothing (its `K` already ends in `D()`); `prompt` needs nothing (the board *is* the next dialog, rebuilt from scratch each iteration). Three conditions had to coincide for the bug to show — an async bot, a commit that does not render, and no tick — which is why it was visible only on `input` at L2 and below.

#### Measured cost

Bytes over `bot:"off"`, at L5 · Indicators · depth 3 (the depth itself is one digit and costs nothing):

| | R | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|---|
| dom / Letter | 90 | 511 | 546 | 562 | 586 | 634 |
| dom / Number | 80 | 461 | 496 | 512 | 536 | 584 |
| input / Letter | 92 | 513 | 548 | 564 | 588 | 636 |
| input / Number | 93 | 474 | 509 | 525 | 549 | 597 |
| prompt / Letter | 92 | 506 | 541 | 557 | 581 | 629 |
| prompt / Number | 93 | 467 | 502 | 518 | 542 | 590 |

The clock-charge wrapper is ~47 B of that and is not emitted at a clockless level (L2 · input · B3 = 517 B).

#### The RegPacked path has no measured rows for a search bot

`rpPlanKey` returns `null` for `B1`–`B5`, which routes them to the greedy search. A B-bot appends 400–600 B of new top-level code with its own scope shape — one global, a ten-to-eleven-name parameter list, a second board copy per node — none of which the plan tables were measured against. Falling through to the `off` row would hand those engines a plan built for a body that does not exist here, and the failure would be **silent**, because the plan's apply-time guards check shapes rather than provenance.

*History: this ladder was once removed from the generator to simplify the bot axis, and `BOT_SEARCH_LADDER.md` documents that removed version — DOM-only, Letter-only, L1–L5, four single letters. **Its "Putting it back" procedure is now obsolete**: those five steps rest on the old free-letter map, three quarters of which no longer holds. Keep the file for the historical eval terms if you like; do not follow its restore steps.*

### Mutually exclusive options (and the single-writer rule for greying)

Two interface/notation pairs have no engine behind them, so the Generator locks each pair against the other and greys the unavailable radio (`label.opt.dis` — dimmed, `pointer-events:none`):

- **blindfold ⇔ dom** — a blindfold board has nothing to click.
- **strict ⇔ prompt** — there is no prompt+strict engine; `build()` carries no such branch (the prompt block has no `H` move-history at all).

  *Caveat found by a full-matrix run:* `build()` does not actually **refuse** this pair — it emits something. Only the Generator's greying keeps users away from it, so the combination is unreachable in the product but reachable from a harness. And what it emitted was broken: `EXTRACT`'s draw signal is `dz = (strict||blind) ? "Z" : …`, while the prompt driver only assigned `Z` under `blind` — so a prompt+strict engine died on its first move with `ReferenceError: Z is not defined`. Now fixed by widening the prompt driver's `dzSet` to `(strict||blind)`, +20 B on that one branch and nothing else. **Lesson: greying a combination in the UI is not the same as `build()` rejecting it.** If a pair is truly unsupported, either make `build()` normalise it or keep it working — an unreachable-but-emitted branch rots silently, because no parse check catches a missing runtime binding.

`sync()` computes `noStrict` from two independent reasons — **level** (L2-L0 have no clock/50-move/repetition to annotate) and **interface** (prompt has no strict engine) — and this is the single place that greys the Strict radio. Both directions of the pair-locks are enforced there: the partner's radio is `disabled`, and if it happened to be the current choice it is re-pointed (dom→input, strict→counted). **Strict + bot is a real, supported combination** (the fix below makes the move list correct), so the bot does *not* disable strict.

**The trap:** `#info-strict` is greyed for *two independent reasons* — the level (**L2–L0** drop strict, since with no clock/50-move/repetition the indicators row would be empty) and the interface (prompt). `classList.toggle('dis', …)` **writes the flag unconditionally**, so if two places toggle the same element, the later one silently wins and the earlier one appears to do nothing. That is exactly what used to happen: the pair-rule set `dis` for prompt, then the level rule further down cleared it again, and selecting *prompt* left *Strict* looking enabled while its input was in fact disabled. **Grey each element from exactly one place, using the combined condition** (`noStrict = L2|L1|L0 || ui==="prompt"`); let the pair-rules only set `disabled` and re-point the radio. If you add a third reason to disable something, fold it into that one condition rather than adding another `toggle`.

### The three "same for both" checkboxes

Three independent per-side axes, each with its own checkbox, each **checked by default** so the untouched Generator emits exactly what it always did:

| Checkbox | Splits | Unit | Dead when |
|---|---|---|---|
| Same time for both | base clocks `wt`/`bt` **and** every period's block-add (`p2badd`, `p3badd`) | minutes | Armageddon (draw odds forbid `wt==bt`) |
| Same increment/delay for both | `o.binc` **and** every period's `binc` | seconds | — (valid in every model; the field itself hides under sudden death) |
| Same draw-claim limit for both | `o.bdrawEvery` | full moves | not L5, or a bot is on |

**The grouping is by unit, not by row.** Everything measured in minutes — the starting clock and the block time added at a period boundary — is one concept (a player's total thinking time) and rides the *time* checkbox. The per-move trickle is a different mechanism and rides the *increment* checkbox. Getting this wrong is easy: an earlier revision put both period columns under the increment box, so unchecking "same time" split the base clocks but left the period adds symmetric.

**Locking must be reversible.** When an axis goes dead the box is force-checked (so `opts()` takes the symmetric path and the output stays byte-identical), but the user's choice has to be **remembered and handed back** when the lock lifts — `sync._sdWas` / `sync._stWas`, keyed on the *edge* of the dead condition, not on every call. Without that, an L5→L4→L5 round trip silently re-symmetrises a control the user had split. Same bug class as the single-writer trap above: the state is written unconditionally on every `sync()`, so it must only *change* on a transition.

**Field plumbing has two ladders, and a new field must join one of them.** Second-based inputs get their steppers from the `STEP` map; minute-based inputs go through the separate MINUTES ladder (`FLOOR`/`DEFV` + `snapIn`, which also handles the ¼/½/¾ rungs). A field in neither list keeps the browser's native spinners and looks wrong next to its partner — which is exactly what happened when `binc`/`p2binc`/`p3binc`/`bdrawevery` (STEP) and `p2badd`/`p3badd` (MINUTES) were first added. The MINUTES ladder also used to size its wrapper `100%`, which made a lone field span the row and made a split pair unequal; it now uses the same `input width + 2×28 px` box as `STEP`, so every field in the panel is one width and a White/Black pair fits side by side.

### The four-colour preview — how it segments, and how it breaks

The `#out` preview colours the emitted engine by **architectural role**, not by token type: `.eng` (blue `#82aaff`) engine logic, `.str` (turquoise `#48d1cc`) engine-side string constants, `.iface` (violet `#a974d6`) the human layer, `.tag` (pink `#e8a8d8`) HTML/CSS markup. **`.tag` means *anything the browser parses as HTML*** — the `<script>` element itself, and every tag the engine writes, **at any nesting depth**.

**A tag is SOLID.** Once a tag is open, everything up to its `>` is part of it — literal text, the `${` `}` delimiters, **and the hole contents**. `<th style="font:30px/40px _" width=40${Z}H(${i}) id=o${i}>` is not markup with code punched through it; it is one attribute-bearing tag, and every character reaches the browser (`Z` is ` onclick=`, `i` is the cell index, so it renders as `<th … width=40 onclick=H(0) id=o0>`). Colouring `Z` and `i` as code made the tag read **mottled** — pink, violet, pink, violet — so inside an open tag the hole is painted `.tag` throughout. Same for `<button${Z}K("q")>`, `<input type=radio id=x${Z}X()>` and `<button style=background:red${Z}X(1)>`.

**Outside a tag, a hole is genuine code and keeps its region colour.** `${s.map((c,i)=>…)}` (the loop that builds the 64 cells) and `${'q♕r♖b♗n♘'.replace(…)}` (the loop that builds the promotion buttons) are JavaScript that *happens to emit* markup — they are not markup, and stay `.iface`. Likewise the clock render's `${q=j?U:N,q/60|0}`.

Three functions do it — `hlStr` (splits string literals out of a run, and paints markup at every depth), `segmentDriver` (carves the driver into `eng`/`iface` runs), and `highlight` (glues it together). It is **pattern-driven**, so it is fragile in exactly three ways, and all three have bitten us:

- **`highlight` must find where the core ends.** With FIDE it scans `Q()`'s arrow-paren body; with **no `Q`** — USCF's result set, and every Chesseus level **L4 and below** — the last core function is `M`, whose body is a **paren arrow** `M=(sig)=>(body)`, *not* a brace body. Code that looks for `=>{` finds nothing, `coreEnd` falls through to `inner.length`, the whole engine becomes one `.eng` block, and the driver is never segmented — the panel goes uniformly blue/teal (`iface = 0`). The scan must skip `M`'s **signature** parens first, then balance-scan the **body** parens (`scanParens`).
- **`segmentDriver` must not resume a scan inside a string.** The clock tick is `setInterval("z||( … ),D())",1E3)` — the whole tick body lives **inside a quoted argument**. After flushing that body as an `eng` run the scan has to jump past the **closing quote of the `setInterval` argument**; if it resumes at the `,D())` *inside* the string, the next character it meets is that closing quote, which it reads as an *opening* quote and skips to end-of-input — swallowing the entire `onkeyup` body (resign, acceptance gate, `M()`, RESULT, draw claims) into one violet run. The jump is therefore correct — but it must still **emit the text it jumps over** (see the round-trip invariant below).

- **Nested templates: markup is `.tag` at every depth, and nothing may be dropped.** The DOM engine's `document.write` nests templates inside its own holes — `` `<body>…<table>${s.map((c,i)=>`${i%8?'':'<tr>'}<th style=… id=o${i}>`).join``}</table>…` ``. The literal-matching regex stops at the first backtick it meets, which is the *inner* template's **opening** quote, so the outer literal was cut short mid-markup: `<body>`/`<table>`/`<label>` came out `.tag` while the `<th …>` cells and the `<button …>` promotion buttons fell through to the region colour — **the same tags in two different colours**. Worse, the same mis-cut made the tick jump above skip its `,D())` without flushing it, so the panel silently **dropped a render call**. Since the panel is **copyable**, a lost `,D())` is a lost line of code, not just a lost colour. All fixed: `tplEnd()` finds a template's real end by tracking `${…}` nesting (an inner template can no longer be mistaken for the outer's closing quote), `tpl()` carries the open-tag state through its chunks and holes (so `}<th style=…>` is markup even though it begins mid-expression, and `id=o${i}`'s delimiters are part of the attribute), and the tick rule flushes the span it skips. **The invariant to test is round-trip fidelity: strip every `<span>` from `highlight()`'s output and you must get the source back, byte for byte, on every config.** A highlighter that loses a character is broken whatever colours it picks — the uploaded build failed this on 1728 of 2752 configs.

- **A rule keyed on a Letter literal covers barely half the axis, and its miss is not merely a lost colour.** The result codes are quoted two-letter tokens in Letter (`'SM'`, `'WT'`, `'RM'`) and **bare integers** in Number (`3`, `6+T`, `T+16`), so eight of `segmentDriver`'s rules matched nothing at all in a Number engine. The RESULT rule was the dangerous one: its terminator was `'SM'`, so on a miss `len` ran to the **end of the string** and painted the whole remaining driver — render, click handler, `setInterval`, `alert` — engine blue. All eight are now one **structural** rule. Every assignment to `z` is game-result logic; its extent is found by scanning, not by matching, with three terminators at bracket depth 0: `,`/`;` end it, a `)` closes a group it sits *inside* (the `&&( … )` move-execution group or the `z||( … )` guard, and that delimiter belongs to the engine action, so it is included), and a `:` **with no ternary of our own still open** is the else-arm of an outer conditional — the prompt driver chains flag-fall, resign and move into one expression (`U*N<1?z=…:!i?z=…:(gate)&&(…)`), so a `:` we do not own must not be swallowed. `?` and `:` are counted at depth 0 only, so a ternary bracketed inside parentheses (`Cl(e>2?12:z)`) can never terminate the scan.
- **The membership test is not always spelled `.includes(`.** At L5 `inclHoist` rebinds the method name to whichever single letter that config had spare and calls it `arr[X](v)` — measured, `t`, `u`, `n`, `x` and `h` all occur. A rule keyed on the literal therefore matched nothing in *every* L5 engine, which is exactly where the typed-move acceptance gate and the DOM click test live. Both now probe for either spelling. The same fix let the acceptance gate be anchored on `(p=s[k=` instead of on the Letter form of what follows it, since the colour test and the coordinate parse are both notation-specific (`(p=s[k=K(0)])>_&&p<u==T` vs `(p=s[k=i[0]+i[1]-0])&&p%2==T`) while that opener is not.
- **The same expression can be a rule in one place and a display in another.** A DOM engine contains the membership test twice: `H = c => … ~k && h.includes(c) ? (l=c, …)` is the click **acceptance gate**, which decides whether the move may be played and is engine; `q.bgColor = ~k && h.includes(i) ? '#c91' : …` sits inside `D()` and asks the same question only to pick a **cell colour**, which is display. It is told apart by what follows — the destination paint is the only site whose ternary selects the highlight colour, and `'#c91'` is stable across every level and both notations. This is the same line already drawn between the RESULT's `J(T)` mate test (engine) and the status line's `J(T)?' C!'` check indicator (display), and it was wrong long before the alias fix: below L5 the literal `.includes(` matched and painted the render's colour pick engine blue.
- **Code passed as a string is still code.** The clock tick (`setInterval("z||(…)")`) and, at clockless levels, the search bot's trigger (`setTimeout("n(2,…),K2(),D()",9)`) are compiled and run, not display constants, so both are flipped from `.str` to `.eng` by a post-pass on the assembled output.
- **Rule order is first-match-wins, so a broad rule can shred a narrow one.** The `R` bot's picker is engine code that happens to sit in the driver, and it *contains* a `G(i)` call. The generic engine-call rule (`"MGJIQ".includes(c)`) would claim that `G(i)` on its own and leave the guard and the reservoir around it as `iface` — rendering the one expression **violet / blue / violet**, which reads as three unrelated things. The bot rule therefore sits at the **head** of the chain and claims the whole span as a single `eng` run before `G(` is ever reached.

  **The bot is blue end to end, commit call included.** The span runs from `z||T||(n=0,s.map(` through the sampler's close `(k=i,l=t)))` **and on through the bot's own `,K()` (dom) / `,K2()` (text, prompt)**. Picking a move and playing it is one indivisible act; the call that plays it belongs to the bot, not to the driver whose wrapper it reuses. **No human `K`/`K2` is touched.** The names collide but the call sites don't, and the distinction is structural rather than stylistic: the bot's call is **argumentless** and sits immediately after the sampler's close, so it is reachable only from inside this span (the rule matches only the `z||T||(n=0,s.map(` opener). Every human call carries an argument and lives elsewhere — `K("$1")` (dom promotion buttons, inside a string literal, so `.str`), `K('')` (dom commit after a click), `K2(/[rbn]/.test(w=i[4])…)` (text/prompt, the parsed promotion letter). And the driver's **other** `K` — `K(0)` / `K(2)`, the from/to coordinate parse — is a *different function* that merely shares the letter; it reads the typed square, so it stays interface, and the `PF` carve-out keeps it that way. In text/prompt the hoisted **`,K2=w=>` header is interface while its body is engine** (the body *is* the commit cascade — `M`, clock hook, `T^=1`, RESULT — which the existing engine rules already claim, so it needs no rule of its own).

If a preview ever goes flat-coloured, check those two first. A quick health probe: colour every config and assert `iface > 0` and roughly 8–30 % of the text — a `0` means the core-end scan failed, a single giant `iface` run means a string-skip ran away.

---

## Download filenames

Both buttons name their file through one writer, `dlName(o, packed)`, so the plain and RegPacked
downloads can never disagree. **Every axis that changes the emitted engine appears in the name**,
and the rule for whether an axis gets a tag is "does it differ from the stock build" — Letter,
FIDE, L5, no cooldown and no bot are the defaults and stay silent:

```
FideLite_<ui>_<info>[_number]_<rotON|rotOFF>_<time>[_2p|_3p]_<std|960_ARR>[_Arm|_L4…_L0]
         [_uscf][_drawPeriodN][_botR|_botB3d2][_cGuard][_fen][_packed].html
```

Board rotation is the deliberate exception: it prints either way, because a reader should not have
to know which direction the default falls, and it prints even where the option is inert (blindfold
has no board; a bot forces rotation off) — the tag reports the *option*, not the rendering.

`_fen` is a **flag, not a value**. It covers everything the name does not spell out: the clock
times, increment/delay, the per-side variants of both, the per-side cooldown, the repetition seed,
a pending draw claim, a custom position, and any per-period `at`/`add`/`inc` moved off its default.
Each of those could carry a value, but the clock and period axes would then dominate the name, so
they collapse into one "not the stock setup" marker. The consequence is worth knowing: two engines
differing *only* in 10|10 vs 90|90 still share a name. They no longer collide with the stock build,
which is what the flag is for; telling them apart from each other would need a value, and that is a
deliberate trade. **Armageddon's clocks never trigger it** — the level enforces `wt >= bt+60`, so
asymmetry there is the format's definition rather than a choice, and flagging it would put `_fen` on
every Armageddon download while saying nothing.

Verified by construction: a sweep over the ten tagged axes produces 18,816 configurations and 18,816
distinct names, with zero collisions.

---

## The RegPacked download

Alongside the plain **Download** the Generator offers a **RegPacked** button (`#dlp`): it takes the very same `build()` engine and runs it through [RegPack](https://github.com/Siorki/RegPack), a self-extracting JavaScript packer, producing a smaller HTML file that decodes back to a byte-identical engine at load time.

**The one invariant that makes this safe: the RegPacked path touches only the packed download.** The plain Download bytes and the engine's behaviour are never affected — `build()`'s output is unchanged. The whole pipeline lives *after* the `UI wiring` marker.

**The library is loaded lazily from a sibling file.** RegPack itself is large (~170 KB); on first click the page `fetch`es `tools/Siorki_Regpack.html`, extracts its library `<script>` plus the wiring up to `window.regpackCompress = …`, and injects that as a real `<script>`. `fetch` only works over http(s), so opening `index.html` from `file://` disables the button with a plain message. The path constant `RP_URL` at the top of the block is the thing to change if the tool lives elsewhere.

### How it packs: `rpPackSmallest`, the candidate forms, and the plan table

`rpPackSmallest(jsBody, o)` is the core. Its guiding idea is **min-select: it builds several runtime-identical candidate FORMS of the engine, packs every one at several crusher settings, and returns the smallest that still parses.** Because the un-transformed body is always in the candidate set, *no transform can ever make the output bigger*.

**Two preprocessing steps run first, and both are newline-critical.** The board display's row breaks are **real single-byte newlines** (LF) living inside the render's **template literals**. RegPack strips real newlines from its input before crushing, which would silently collapse the board onto one line, so the `#dlp` handler first rewrites every real newline in the engine body to the two-character **escape sequence `\n`** (`…trim().replace(/\r\n?|\n/g,'\\n')`). Inside a template literal that is byte-for-byte identical at runtime but leaves RegPack nothing to strip. Then `rpDetemplateAll` converts each template literal into plain string-concatenation (RegPack treats template *contents* as code — whitespace-stripped, identifiers renamed — which would mangle the DOM-render HTML). **The subtlety:** a literal chunk is stored as its *source* text, so the escape written by step one is the two characters backslash-`n`. Naively `JSON.stringify`-ing that doubles the backslash and the packed engine prints a literal `\n`; `rpTemplateToConcat` therefore runs each chunk through `rpUnescapeTemplateLiteral` first. Both steps are **correctness**, not optimisation, and are never bypassed.

Four levers then feed the candidate set:

1. **Board-flatten (`rpExpandBoard`) — min-select-protected.** The emitted initialiser is `s=[...'rnbq…'.padEnd(48,Y=_='-')+'…']`; the 32 empty squares are produced by `padEnd` and never appear in the source, hiding a long uniform run from RegPack's tokeniser. This rewrites it as one flat 64-char literal. It is deliberately **expression-agnostic**: it *evaluates* whatever the initialiser is inside a `with()` over a Proxy that records every free-variable assignment, then re-emits those bindings as a prefix — which matters because the board carries a side effect (`padEnd(48,Y=_='-')` initialises both the empty sentinel `_` and the en-passant slot `Y`). Measured: **loses on Letter (+5…+9), wins on Number (−1…−9)** → offered as a candidate, never applied blindly.
2. **vPad (`rpVPadBoard`) — min-select-protected.** Keeps `padEnd` (writing the dashes out costs ~+21 raw and never pays back) but produces the WHITE half by upper-casing the BLACK literals: `…+V('pppppppp')+V('rnbqkbnr')`. The two new call sites join the *existing* `toUpperCase()` token family. Note the halves are not mirror images — Black is `<back><pawns>`, White is `<pawns><back>` — so the reuse is per-rank and a guard checks the exact ordering. Measured: **wins 37 of 112 configs, 105 B total.**
3. **Helper-inline (`rpInlineHelpers`) — min-select-protected, wins nearly everywhere.** Deletes the opening helper definitions and pastes each expansion at every call site. The helper set is **not fixed**: `build()` currently emits seven distinct prefixes, because `_='-'` folded into the board initialiser and `inclHoist` prepends a method-reference binding whose *letter varies by config* (`x`/`h`/`t`/`n`/`u`). Each helper is therefore matched independently. Un-hoisting `includes` alone — turning three 4-char `[x](` sites back into three 10-char `.includes(` sites — is worth −8…−12 packed. Measured: **−9…−33 at L5.**
4. **Crusher-factor sweep (`RP_FACTORS`) — always run in full.** RegPack scores candidate repeats with three weights; `regpackCompressF` re-runs the exact same packer with `[[1,0,0],[3,1,0],[4,1,0],[4,2,1]]` for every form. This changes only *how RegPack scores repeats, never the code being packed*. All four earn their place — across 112 configs the winner is 1/0/0 in 41, 3/1/0 in 38, 4/1/0 in 24 and 4/2/1 in 9.

Six forms (`base`, `flat`, `vPad`, `inline`, `inline+flat`, `inline+vPad`) × four factors = up to 24 packs, ~1.5–2 s. The winning form is `inline+flat` 43×, `inline+vPad` 37×, `inline` 30× and `flat` 2× — **no single form dominates, which is exactly why this is a min-select and not a rule.**

**The parse guard is not optional.** RegPack's token character-class includes `$` and its self-extractor stores the payload in a **backtick template literal**. When `$` is assigned as a token and lands immediately before another token character, the payload contains a bare `${` — a SyntaxError. Measured: this occurs in **1 of ~1800 candidates** (L4/prompt/blindfold at 3/1/0) and it was the *smallest* candidate, so a size-only min-select actively preferred the broken build. Every candidate is now checked with `new Function(packed)`; an invalid candidate is not a candidate.

### Variable merge and rename — `RP_PLAN`

RegPack builds its token character-class out of the ASCII codepoints **not** used as variable names, so dropping a distinct single-letter name tightens the pack. Two moves do that:

- **MERGE** — collapse a local that lives inside exactly *one* function onto a letter that function does not use. Two variables whose frames never overlap can share a name.
- **RENAME** — move a variable onto a letter that is free everywhere.

**They compose, and they compose with each other.** Each accepted step frees one codepoint the next can exploit: on a dense L5 body a single merge is worth 5 B but a five-step chain is worth 19 B. And `M:QEO + R:jn` beats either alone — which is why rename is kept even though on its own it is worth 0–1 B.

Because the search is expensive (~40 s per config) and the engines are frozen, the winning chain has been **measured offline for every config and stored in `RP_PLAN`** — 173 rows covering all seven levels. Applying a known plan costs one string pass instead of a search, which is why the button stays responsive (**0.2–5 s**, typically under 2).

**The key is built from the build OPTIONS, never from the emitted text.** The previous table (`RP_MEMO`) derived its key by pattern-matching the engine source, and that mis-keyed whole families: Armageddon writes `U=3E2,N=240` instead of `U=N=6E2`, so it failed the marker test and was treated as L2. Reading `o.*` cannot drift that way.

Which axes the key carries was determined by measurement, not assumption:

| axis | in the key? | why |
|---|---|---|
| `ui` × `info` | yes | 7 valid pairs — **prompt excludes strict and dom excludes blindfold**; the UI enforces both, and `rpPlanKey` rejects them outright so no dead rows can accumulate |
| `notation` | yes | Number drops `$ K V w x` — a different letter budget entirely |
| `fed` | **L5 and Armageddon only** | uscf removes the `Q` helpmate fn, so `QE` dies and `IF`/`Lj`/`MQ` become legal. **From L4 down that function is not emitted at all, so uscf and fide produce byte-identical engines** — verified on all 14 variants — and the segment is dropped, halving those tables |
| `bot` | dom only | the extra `n`/`t` land as isolated locals in `X` and `K`; elsewhere they stay global |
| `960`, `rot` | L5 overrides only | they add **no variable**, but they reshape a couple of function bodies so a shared letter becomes isolated — a fresh candidate the std plan cannot see (rot opens `M:GgZ` worth 6 B; 960 opens `R:DK` worth 8 B). Only the 11 configs where that measurably beats the std plan get an override row |
| time mode, multi-period, `drawEvery`, `drawState`, `binc`, `rep`, `cancelGuard`, `fen`, clock values | no | they either change nothing or add a **global** (`n`, `B`), and a global never changes the isolated-local pool the merge search draws from |

**The guard that matters.** A merge is only safe when BOTH hold: (1) the destination letter is absent inside the function's span, and (2) the destination is **not live outside** that span. Condition (2) was missing in the original implementation and it silently corrupted engines: merging `G`'s local `O` onto `B` passed (1), but `B` is the strict move counter — a live global — so the renamed body began writing to it and the move history rendered `NaN.` **while the board and every frame still matched.** Byte counts and parse checks both miss that; only running real games caught it. A destination used elsewhere is allowed only when all of its other uses sit inside one other function span that does not overlap ours.

Every step is re-validated against the actual body before it is applied, so **a stale row degrades to a no-op, never to a corrupt engine** — the failure mode the previous table had.

### What the table is worth, per level

| level | rows | saving | avg |
|---|---|---|---|
| L5 (base + rot/960 overrides) | 47 | 162 B | 3.4 B |
| Armageddon | 36 | 108 B | 3.0 B |
| L4 | 18 | 40 B | 2.2 B |
| L3 | 18 | 26 B | 1.4 B |
| L2 | 18 | 14 B | 0.8 B |
| L1 | 18 | 16 B | 1.6 B |
| L0 | 18 | 20 B | 2.0 B |

The recurring winners tell the structural story. At L5 it is **`M:QEO`/`M:QEK`** (the helpmate fn `Q`'s isolated local `E`). Armageddon drops `Q` entirely, which both kills `QE` and *frees the name `Q`* — so **`M:GdQ`**, parking `G`'s isolated `d` in the vacated slot, takes over and then leads all the way down to L0. L4 adds `I()`'s local `F` (`M:LjF`, `M:txF`); L3 drops `I` again and exposes `fa`/`Mq`/`Gm`.

**The saving does not fade monotonically** — it bottoms out at L2 (14 B) and rises again at L1 and L0 (16 and 20 B). Stripping the clock, the 50-move counter and the repetition table leaves `G` and `f` full of short-lived locals (`Ge`, `Gy`, `fb` appear only at L0), so the merge lever finds fresh material at the bottom of the ladder.

Below the table, and for any unrecognised level, `rpPackSmallest` falls back to a **greedy search** (`rpChain`) bounded by `RP_CHAIN_BUDGET_MS`. The forms × factors sweep always runs regardless.

### Verifying a pipeline change

The rule here is narrower than the engine's: **the RegPacked engine must unpack to the same engine — behaviour, not bytes.**

- **Structural proof (strongest, no execution).** A merge/rename step must differ from the input only by single-letter bare-identifier substitutions, strings untouched, length unchanged → a pure alpha-rename → behaviour-neutral. **This is necessary but not sufficient** — see the `NaN.` failure above, which *was* a valid alpha-rename and still broke the engine. The scope guard is what makes it safe.
- **Runtime differential — mandatory.** Drive real games (a castling line and a Scholar's mate) through the plain and packed engines and compare board, every rendered frame, **and the move history**. The corruption that byte counts and parse checks missed showed up only in the history. For `bot=R` configs seed `Math.random` first: the engine is nondeterministic by design, so two runs of the *same* engine already differ.
- **DOM markup byte-identity.** For the dom UI, capture `document.write` output from both and compare exactly — including attribute-separator spaces (4113 chars / 337 spaces at L5). This is what the detemplater protects.
- **Newlines survive.** Count real `\n` in a rendered frame (15/15, 14/14, 11/11 at L5/L5-strict/L2); a literal `\n` in the output means the decode step was skipped.
- **`build()` unchanged.** Diff `build()` output across the full option matrix before/after. The pipeline affects **only** the RegPacked download; this is the invariant the whole design rests on.

### Where the remaining headroom is: compression-aware ("self-aware") golfing

**The plain engines are saturated.** Every variant has been golfed to a proven local minimum; a config-specific hunt might still turn up a byte or two, but that well is essentially dry. **The RegPacked path is not.** The levers above are all *mechanical* — inline a definition, flatten a literal, rename a letter, reweight the crusher — and mechanical levers have now been taken.

The unexplored axis is **compression-aware golfing**: rewriting expressions into forms that are *behaviour-identical but lower-entropy*, so RegPack has more to fold. This is worth stating plainly because it inverts the project's usual instinct:

- **Ordinary golfing and RegPack pull in opposite directions.** Every byte squeezed out of the plain engine also removes a *repetition* RegPack could have tokenised. A shorter, cleverer, more varied expression is better plain text and worse packer input. It is entirely possible that **older, more repetitive versions of some engine functions packed better than the current tight ones** — the plain-optimal form and the pack-optimal form are simply different objectives, and we have only ever optimised the first.
- **The move is to deliberately raise redundancy.** Write a function *more verbosely* but reusing string/expression patterns that already occur elsewhere, so the same byte sequence appears three or more times. RegPack's threshold is effectively "appears ≥ 3 times": a pattern occurring twice usually does not clear the gain/overhead bar, and a third occurrence tips it over. **So the highest-value move is finding a fragment that occurs exactly twice and making a behaviour-neutral third occurrence appear.** The intermediate body gets *bigger*; the packed output can get materially smaller.
- **This is already how the existing pipeline works, one level up.** Helper-inline grows the pre-pack body by ~130 B purely to manufacture repeated `Math.abs(` fragments; vPad adds two call sites to join an existing token family. Compression-aware golfing generalises that from *helper definitions* to *arbitrary expressions*.
- **A worked negative example.** The dom resign button is styled `background:red`, while every other colour in the markup is 3-digit hex (`#ccc`, `#0f0`, `#00f`…). Rewriting it as `#f00` to match that family looks like a free pattern win — it is not. `red` is 3 characters and `#f00` is 4, and **RegPack does not recover the difference**: measured across the 8 dom configs it costs +1 B raw *and* +1 B packed, every time. RegPack folds *repeated byte sequences*, not visual patterns; `#f00` and `#0f0` share only `#` and `0`, which are single characters already everywhere. Pattern similarity is not compressibility.

**Priority is deliberately second-tier.** The original variants come first: the plain Download is the primary artifact and its byte count is the headline number. This axis only ever improves the packed download. It is also the one lever that is **not self-verifying** — min-select protects *size*, so a rewrite that changes behaviour but happens to pack smaller *would be selected*. Correctness would rest entirely on differential execution (and perft, which the mechanical axes did not need). That validation cost, plus the fact that it needs per-expression human reasoning rather than a search, is why it has not been attempted.

But the ceiling looks real. If someone is willing to think hard about writing equivalent-but-blander functions — same semantics, lower entropy, patterns shared across call sites — there is plausibly **materially more** than the single-digit byte wins the mechanical axes have been returning. Worth trying once, on one interface, before deciding whether to industrialise.

---

## Number notation — reading and playing an emitted engine

Everything above describes the engine as built and golfed. This section is the **player-facing key** to the **Number** encoding: how the board is stored and shown as small integers, how you type moves, how to resign or offer a draw, and how to read the single-number result. It is the reference a person actually needs open beside a Number-notation engine — the counterpart to the *why-it-shrinks* mechanics in the [numeric-bitfield section](#the-numeric-bitfield-board--applied-a-letternumber-generator-switch) that follows.

The encoding is available on **every** build — all three interfaces (clickable DOM board, text field, `prompt()` loop), every info level including **blindfold**, both rule sets (**FIDE / USCF**), **standard and Chess960 (freestyle)**, and every Chesseus level **L5 → L0** including **Armageddon**. It composes with FEN start positions too. There is nothing Number-specific about which engines can use it: the switch is a mechanical post-process on the assembled char engine, so wherever a Letter engine exists, its Number twin does too.

> Everything here is the *Number*-format convention. In **Letter** format the board shows piece letters, the clock shows `W: 900s`, and results show `W#`, `SM`, … — none of that changes. Letter output is byte-identical to the pre-switch engine.

### Board squares — the index you type

The board is a flat grid numbered **0–63**. **Index `00` is a8** (top-left in White's view); the number increases left-to-right along each rank, top rank (8) down to bottom rank (1). **`63` is h1.**

You enter a move as **two 2-digit indices stuck together: `<from><to>`** — e.g. `5236` (from `52` to `36`). Always two digits per square (`04`, not `4`). Note the asymmetry: squares are typed in **decimal, two digits**, while the board *prints* pieces in **hex, one digit**. The two encodings never meet — you never type a piece code, and the board never prints a square index except in the edge labels (which are decimal, matching what you type).

```
        a     b     c     d     e     f     g     h
  8     00    01    02    03    04    05    06    07
  7     08    09    10    11    12    13    14    15
  6     16    17    18    19    20    21    22    23
  5     24    25    26    27    28    29    30    31
  4     32    33    34    35    36    37    38    39
  3     40    41    42    43    44    45    46    47
  2     48    49    50    51    52    53    54    55
  1     56    57    58    59    60    61    62    63
```

Quick landmarks: `a8=00`, `h8=07`, `a1=56`, `h1=63`, White king start `e1=60`, Black king start `e8=04`. Formulae: `file = index % 8` (0=a … 7=h), `rank = 8 − ⌊index / 8⌋`.

**Examples**
- `1.e4` (e2→e4) = `52` → `36` → type **`5236`**
- `Ng1→f3` (g1→f3) = `62` → `45` → type **`6245`**
- Black `e7→e5` = `12` → `28` → type **`1228`**

Only the **first four digits** are read as the move — the from-square is taken from positions 0–1 and the to-square from 2–3 (`i[0]+i[1]-0` / `i[2]+i[3]-0`, inlined: the two characters are concatenated as text, then `-0` coerces the pair to a number). Anything typed after that is either the promotion digit (below) or ignored. A trailing non-digit *also* triggers a draw offer — see *Resigning and offering a draw*.

**Both squares must be two digits.** `0` is not a shorthand for square 0 — write `00`. A field with fewer than four digits has no second character for one of the pairs, so that pair reads `undefined` and the move is rejected: `001` does **not** play `0→1`, and `5` does not name square 5. This is the concatenating parser's one behavioural edge over the `+i.slice(...)` form it replaced (−4 B), which silently accepted a clipped pair; the canonical four-digit block is unaffected, and a rejected short move leaves the position, the clock and the side to move untouched.

> **Text-field (input) engines commit a move on Enter, in every notation.** Type the move (or paste it) and press **Enter** — the move is parsed and played. This is the same Enter-gate in Letter and Number: an earlier build dropped the gate in the Number field (re-parsing on every keystroke to save ~12 B, on the reasoning that a Number move is a fixed digit block you would paste whole), but that let a partial digit string commit before you finished typing, which felt broken — so the gate was restored and Number now behaves exactly like Letter. Because moves are read from the first four (or five) characters, both **typing then Enter** and **pasting then Enter** work equally well. The `prompt()` interface reads the whole field per turn, and the clickable DOM interface commits on click — neither needs Enter.
>
> One quirk to expect in **Number at L3 and above, on both the text field and the clickable board**: the board is blank for about a second after the page loads. Those engines drop the driver's opening paint to save 4 bytes and let the clock's one-second tick draw the first frame instead. On the clickable board the effect is more visible — you see an empty, uncoloured grid rather than a board missing its pieces, because the same call that places the pieces is also the one that colours the squares. Nothing is wrong — wait a beat and the board appears. Number engines below L3 (no clock, nothing to draw that first frame) and all Letter engines paint immediately.

*Board rotation:* if the board is set to rotate for the side to move, the **display** flips but the index of a given square never changes — `e4` is `36` whichever way the board is drawn.

### Reading the board — 1-digit hex piece codes

Every square prints as **one hexadecimal digit**. The value is `piece_type × 2 + colour`, where **colour bit = 0 for Black, 1 for White**, and **empty = 0**. So odd = White, even = Black, and `0` = empty. Every value fits in a single hex digit by construction — the largest code is 13 = `d` — so no padding is needed and a rank is exactly 8 characters wide, one per square.

| hex | dec | piece | | hex | dec | piece |
|:--:|:--:|:--|--|:--:|:--:|:--|
| `0` | 0 | *(empty)* | | `8` | 8 | ♟ black pawn |
| `2` | 2 | ♝ black bishop | | `9` | 9 | ♙ white pawn |
| `3` | 3 | ♗ white bishop | | `a` | 10 | ♚ black king |
| `4` | 4 | ♜ black rook | | `b` | 11 | ♔ white king |
| `5` | 5 | ♖ white rook | | `c` | 12 | ♞ black knight |
| `6` | 6 | ♛ black queen | | `d` | 13 | ♘ white knight |
| `7` | 7 | ♕ white queen | | | | |

(The value `1` never appears — piece codes start at 2 — and `e`/`f` are unused, so three hex digits are free.) Reading trick: **halve the code, drop the remainder → piece kind**; the **remainder tells the colour** (1 = White, 0 = Black). E.g. `7` → 3 → queen, odd → White = white queen. Note the knights are `c`/`d`, the only codes above the kings — a knight is *not* "less than a king," which matters if you ever read the raw values (the engine's non-king test is `c!=10&c!=11`, not `c<10`).

The starting position therefore reads, top rank to bottom:

```
4 c 2 6 a 2 c 4     ← rank 8  (black: r n b q k b n r)
8 8 8 8 8 8 8 8     ← rank 7  (black pawns)
0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0
0 0 0 0 0 0 0 0
9 9 9 9 9 9 9 9     ← rank 2  (white pawns)
5 d 3 7 b 3 d 5     ← rank 1  (white: R N B Q K B N R)
```

In the text interfaces the cells are printed with no separator, so a rank is exactly 8 characters and each column is one square — the whole starting board is 64 characters:

```
00 4c26a2c4
08 88888888
16 00000000
24 00000000
32 00000000
40 00000000
48 99999999
56 5d37b3d5
   01234567
```

The left label is that rank's a-file square index (`00 08 16 … 56`); the bottom row is the file numbers `01234567`, one digit per column, aligned under the board. Add the two to locate a square: rank label `48` + file `4` = `52` = e2. The DOM board renders piece glyphs directly regardless of notation; the numeric encoding is what it stores, not what that board draws.

### Promotion — the piece number

When a pawn reaches the last rank, add **one more digit** after the move to choose the piece. It's a three-entry menu, read from the **fifth character only** (`i[4]`):

| type digit (`i[4]`) | promotes to |
|:--:|:--|
| `0` | bishop |
| `1` | rook |
| `2` | knight |
| *(omitted)* | queen — **the default** |

Queen has **no digit of its own**: it is what you get when you type nothing, and also what you get from anything the menu does not recognise — a `3`, a `9`, a stray letter, the `=` draw marker. The parse is `'126'[i[4]]`: your digit indexes a three-entry lookup string whose *contents* are the engine's internal piece codes (1 = bishop, 2 = rook, 6 = knight), and any index outside `0`–`2` yields `undefined` — which `M()`'s own `p=3` default parameter then turns into a queen. (No `||3` fallback is needed: passing `undefined` to a parameter with a default triggers that default, and the lookup can only ever return `undefined`, `"1"`, `"2"` or `"6"`, the last three all truthy. Dropping it saves 3 B and is the reason the default in `M`'s signature must stay.)

Keep the two numberings apart. **What you type** is a menu position (`0`, `1`, `2`). **What the string holds** is a piece code (`1`, `2`, `6`). They are not the same numbers, and the piece codes are not the hex board codes either — you never type a board code. Typing `c` because the board prints black knights as `c` gives you a **queen**, not a knight.

You cannot promote to a king or a pawn by any input: every unrecognised character falls back to queen, so no digit can put an illegal piece on the back rank.

Only the single fifth character is consulted. A sixth digit and beyond are **ignored** for promotion — `08002` and `0800299` both promote to a knight; the trailing `99` does nothing. (The piece the pawn becomes always takes the pawn's **own colour** — the promoted piece is `code×2 + W`, where `W` is the moving pawn's colour bit, read from the pawn, never from your input. A black pawn promoting to a knight becomes a *black* knight; you cannot promote to the other colour.)

**Examples** (White pawn a7→a8 = `08`→`00`)
- Promote to **queen**: `0800` *(or any unrecognised suffix, e.g. `08003`)*
- Promote to **bishop**: `08000`
- Promote to **rook**: `08001`
- Promote to **knight**: `08002`

### Castling and en passant — no special input

Both are entered as ordinary `<from><to>` moves; the engine recognises them from the geometry and does the rest. There is no dedicated castling or en-passant syntax.

**Castling — move the king two squares toward the rook.** You type the king's from-square and its two-square destination; the engine slides the correct rook itself.

- **Standard chess.** White: kingside `e1→g1` = **`6062`**, queenside `e1→c1` = **`6058`**. Black: kingside `e8→g8` = **`0406`**, queenside `e8→c8` = **`0402`**. (The king always lands on the g- or c-file castled square — `62`/`58` for White, `06`/`02` for Black — and the rook jumps to the far side of it automatically.)
- **Chess960 / freestyle.** The king's *destination* is the same castled square (g- or c-file), but its *start* square depends on the shuffled arrangement, so type that position's actual king-from-square followed by the g/c-file target. The generator's Chess960 castling handles the rook, including the cases where the king or rook barely moves.

**En passant — just play the diagonal capture.** Move your pawn diagonally onto the **empty** square behind the enemy pawn that just made its two-square push; the engine detects the en-passant geometry and removes the captured pawn. Example: a White pawn on d5 capturing a Black pawn that just played c7→c5 is `d5→c6` = **`2718`** — you land on the empty `c6` (`18`), and the `c5` pawn is taken. Nothing marks it as en passant in the input; the empty diagonal target is enough for the engine to know. (En passant is only available the one move after the enemy's two-square push, exactly as in normal chess. It exists at L2 and above; L1/L0 drop the two-square pawn push and with it en passant.)



Number mode prints each clock as a **side letter + raw seconds**, no colon, no space, no `s`:

```
W600   B540
```

means White has 600 seconds, Black 540. (In the DOM board each of the two clock boxes shows its own `W…` / `B…` the same way; there's no mm:ss and no ⏱ icon in Number mode — this legend is the decoder.)

**Whose turn (blindfold prompt, L3+).** When you play blindfold in the `prompt` interface at L3 or above, a single digit sits **between the two clocks** to show whose move it is:

```
W600 1 B540      ← the 1 means White to move
W595 0 B540      ← the 0 means Black to move
```

**`1` = White to move, `0` = Black to move.**

**Below L3 there is no clock** (L2/L1/L0), so blindfold can't show the turn between two clocks. Instead it prefixes the last-move echo with the side to move, and in **Number** mode that prefix is the **raw turn bit** — the same `1`/`0` convention: `1 [5236]` means White to move, `0 [5236]` means Black. (In **Letter** mode the prefix is the side letter with no colon — `W [5236]` / `B [5236]`. Neither carries a clock at these levels; the digit or letter is the only turn cue.)

**Counted also shows the turn below L3.** The same reasoning applies to the Indicators (counted) view: at L3 and above the running clock already reveals whose move it is, but L2/L1/L0 have no clock, so counted would otherwise leave the turn unstated (strict isn't offered below L3, and blindfold already covers itself as above). So on **counted L2/L1/L0** — all three interfaces (input, prompt, DOM) — the side to move is shown next to the board coordinate: **Letter uses `W`/`B`, Number the raw bit `1`/`0`**, each set off by a single space. Placement follows the coordinate and precedes the other indicators: in **DOM** and **prompt** it sits right after the coordinate hint (`a8-h8 W …` / `00-07 1 …`, and before the `C!` check flag where one exists); in **input** the coordinate labels sit *below* the board, so the turn instead leads the status line (before the result/check indicator). At **L0** there is no check indicator, so it simply trails the coordinate. This is a display-only addition — the engine already tracks `T`; the readout costs a few bytes per affected engine (more in Letter, fewer in Number) and changes nothing about play.

**The `prompt` interface shows it at *every* level, including L3+.** The clock-implies-the-turn argument holds for `input` and `dom`, which print both clocks; the `prompt` board prints only **one** clock line, and unrotated that line is a fixed `B: …s` / `B…` label — it names *which* clock is shown, not whose move it is. (Rotated, the label does follow the turn, but making the cue appear and disappear with `rot` would be worse than showing it always.) So in `prompt` counted the side-to-move indicator sits right after the coordinate at **L5 through L0 and Armageddon**, in both notations: `a8 W      M=0   R=1` / `00 1      0  M0   R1`. It costs +11 B in Letter and +5 B in Number on the L3+ engines that previously lacked it.

### Resigning and offering a draw

These two actions have no button in Number mode — they are triggered by **what you type in the move field**, and they work the same way in the `input` and `prompt` interfaces. Both exist only where the underlying rules keep them: **resign and draw-offer are L5-only** (Armageddon drops draw offers because a draw is already a Black win; Chesseus drops both at L4 and below). At those lower levels a stray character is simply ignored and there is no way to resign — you play the position out.

**Resign — cancel the dialog or submit an empty field.** The move handler tests `!i` before parsing a move. An **empty** field (pressing Enter on a blank prompt, or submitting an empty input) resigns: the side to move loses, and the result is `16`/`17` (`WR`/`BR` — the *winner's* side; `16` = White wins because Black resigned). If the position is dead (the resigning side's opponent can't actually mate), FIDE scores it `15` (`RM`, a draw) instead. In the `prompt` interface the same test is what makes a **cancelled dialog** (`null`, which is falsy) resign instead of throwing. **`!i` rather than `i<1`:** the truthiness test matches only `null` and `""`, so a field that is merely *numerically* below 1 no longer resigns. Typing `0`, `00`, `0000`, a blank space, a negative (`-5`) or a fraction (`0.5`, `.5`) now falls through to the move parser, fails to name a square, and is rejected as an **invalid move** — the position is re-presented and the player moves again, which is what FIDE prescribes for an illegal or malformed move. (The concatenating square parser makes this safe: `i[0]+i[1]-0` is `NaN` or out of range for every one of those fields, and `0000` parses to `k=0,l=0`, which `G()` never generates because `from==to`. Verified over the whole widened set — no field reaches `M()`, throws, or loops.)

**Offer a draw — include a non-digit.** The draw path is gated by `i!=+i` — `NaN` is the only value that is not equal to itself, so this is `isNaN(i)` written out in 5 bytes instead of 8. (The leading `+` is unnecessary: the loose `!=` coerces the left side anyway, so `"6044" != 6044` is `false` and `"draw" != NaN` is `true`. The one value the two forms disagree on is `null`, and a `null` field has already resigned on the previous branch and left the loop before the draw test is reached.) It fires whenever the field contains **any character that isn't a digit**. So:

- Typing a bare non-numeric token (a letter, a `=`, anything) with no valid move in front offers/handles a draw on its own.
- Typing a **valid move followed by a non-digit** does *both*: the first four digits play the move (and a fifth would promote), and the trailing non-digit then offers a draw on the same input. Example: `5236x` plays `52→36` **and** offers a draw; `5236` just plays the move.

**Accepting.** A draw offer is pending until the **other** side answers. The accept mechanism is the same non-digit input from the opposing side: two non-digit inputs from **opposite** colours settle the game as a draw by agreement, result `12` (`DA`). A second non-digit from the **same** side instead retracts. While an offer is pending, the status line shows the `13` indicator (`D?`); `13` is never a final result, only a "draw offered, still playing" flag.

So the full typed-input vocabulary in Number mode is: **four digits** = move, **+ a fifth `1`–`4`** = promotion choice, **an empty field** (or a cancelled prompt) = resign, **a non-digit anywhere** = draw offer/accept (and a move-plus-non-digit does both at once).

### No garbage cleanup on the echo — by design

In **blindfold**, the board is hidden, so the only feedback is the `[…]` echo of your last input. Letter mode trims that echo to the clean move (`E=i.slice(0,4)+…`, dropping stray characters and the draw marker). **Number mode does not** — it stores the raw input verbatim (`E=i`), so if you typed `5236x` or `0800499`, the echo shows exactly that, trailing garbage and all.

This is a deliberate trade, and it is the same trade the whole Number encoding makes: **it lowers the polish of the on-screen experience in exact step with turning everything into numbers, while doing zero harm to the engine.** The echo is cosmetic — the move itself was parsed from the first four (or five) characters regardless, the draw offer fired on the non-digit regardless, and the game state is identical either way. Number notation's entire premise is byte economy paired with a printed legend, not on-screen readability; skipping the echo cleanup saves the bytes the cleanup would cost and never touches correctness. Garbage in the echo is ugly and completely inert. (The cost of *adding* letter-style cleanup was measured — roughly +11 to +46 B per blindfold engine depending on how faithfully it mirrors the letter form — and rejected on those grounds: it buys tidiness the mode does not aim for, at a price the mode does not want to pay.)

### The status readout — what every field means, variant by variant

Alongside the board and clock, each interface prints a compact **status line** while you play. Which fields it contains depends on the **interface** (input / prompt / dom) and the **info level** (counted / strict / blindfold — note that **prompt has no strict**, so its only levels are counted and blindfold). Every field is a bare number — this is the legend.

**The fields**

| field | looks like | meaning |
|:--|:--|:--|
| **result `z`** | a number `1`–`17` (Armageddon adds `⟹WA`/`⟹BA`) | the game-end code (see *Game-result codes*). `0`/blank = game still going. |
| **indicator** | `4` / `13` / `0` | one shared slot: `13` = a draw is pending (`D?`), else `4` = the side to move is in check (`C!`), else `0` (Letter: empty). An offer **hides** a simultaneous check — see the note below the table. |
| **move count `M`** | `M33` | halfmove/position counter used for the draw rules (no `=` sign). |
| **repetition `R`** | `R2` | how many times the current position has occurred. |
| **clock** | `W456 B454` | White then Black, raw seconds. In `input` and Letter-`prompt` the clocks are clipped onto board rows; in **Number-`prompt` both sit in the header**, after `R`. |
| **turn** | `1` / `0` | only shown inline in blindfold prompt: `1`=White, `0`=Black to move. |
| **echo `[…]`** | `[5236]` | in blindfold, the last input you typed (the board is hidden, so this is your only feedback — and in Number mode it is **not** cleaned up; see *No garbage cleanup on the echo*). |

Two of these — **check (`4`)** and **draw offer (`13`)** — are *live indicators*, on only while the condition holds. **`dom` shows them independently; `input` and `prompt` still share one slot.** On `dom` a pending offer and a check can be lit at the same time: Letter prints `D? C!`, and Number **sums** the two codes, so the slot reads `0` (neither), `4` (check), `13` (offer) or `17` (both) — the four values cannot be confused because 13 and 4 only add up one way. On `input` and `prompt` the two still share a single slot with a fixed priority — a pending offer beats a check, which beats nothing — so there a `4` means "in check *and* no offer pending", and if both are true you see `13`. The full chain is `z > D? > C! > off` in `input` (which also shows the finished game's result there) and `D? > C! > off` in `prompt`, which stops rendering the moment the game ends and delivers the result by `alert`. `dom` puts the result in its **status line**, which the result overwrites entirely (see below).

**How the three info levels differ**

- **counted** — the full readout: indicators + `M`/`R` counters + clock (+ board where the interface shows one).
- **strict** — trimmed: board + clock + result only. **No `M`/`R`, no check/offer indicator** (you don't get told you're in check — you have to see it). Offered at L3 and above, and on `input`/`dom` only — **there is no prompt+strict engine**.
- **blindfold** — no board at all. You get the clock, the `[…]` echo of your last move, and the result; prompt also shows the inline turn digit.

**Reading each interface** (example values: 33 moves, 2 repetitions, clocks 456/454, White to move)

`input` — writes into the page; the result `z` shows inline (no popup):
```
counted :  0  M33  R2        ← indicator slot (also carries z), then M/R; the board grid + "B454" clock follow
strict  :  (result only)     ← just the board + clock; z appears here when the game ends
blind   :  W456 B454 [5236]  ← clock + your last move; no board, turn is implicit
```

`prompt` — the status is the **title of the input dialog** that opens each move; the result is delivered by a popup (`alert`) at the end. **There is no prompt+strict engine** (see *Which options exclude each other*), so only two rows exist:
```
counted :  a8   W   C!   M=33   R=2    ← Letter: label, side to move, indicator, M/R; clocks ride the board rows below
            00 1 4 M33 R2 W456 B454    ← Number: same fields single-spaced, then BOTH clocks (the board below is bare 8x8 hex)
blind   :  W456 1 B454 [5236]      ← clock, turn digit (1=White), clock, last move
```

`dom` — a graphical board (always shown) plus a one-line status and two clock boxes; result `z` turns the status blue when the game ends:
```
counted :  00-07 4 M33 R2     ← board-range label, indicator slot, M/R  (+ board + clocks)
strict  :  (board + clocks only, no status counters)
blind   :  00-07 4 M33 R2     ← same as counted, but the board grid is hidden
```

**Where the turn and the result come from**

- **Turn**: **prompt prints it as a digit** (`1`/`0`) right after the corner label at every info level — counted shows it in the header (`00 1 …`), blindfold between the clocks (`W456 1 B454`). It is prompt's only unambiguous turn cue: its clock labels are fixed `W`/`B` names, not a "whose move is it" signal. `input` and `dom` leave it implicit — in a shown board you can see it, and with a running clock you can tell from which side's time is ticking down.
- **Result `z`**: **input** and **dom** show it in place (dom colours it blue); **prompt** shows it as an `alert` popup after your last move. In every case it's the single number below.

**Telling the fields apart — nothing collides.** The readout is all bare numbers, but four simple rules make every field unambiguous:

1. **A letter means a clock or a counter, a bare number doesn't.** `W456`/`B454` are clocks (always a `W`/`B`), `M33`/`R2` are the move/repetition counters (always an `M`/`R`). So in `W456 1 B454`, the lone `1` with **no letter** is the turn digit — it can't be part of a clock, because clocks always carry their letter. Likewise the counters can never be confused with an indicator: `M33` is a count, `33` alone would be an indicator slot (but the indicator is only ever `0`, `4`, or `13`).
2. **A hyphen means the board-range label.** The DOM status shows `00-07` (or rotated `63-56`) before the indicator slot. It's the only token with a `-`, so `00-07 13` always parses as `[label 00-07] [indicator 13]` — the hyphenated piece is the label, the bare number after it is the indicator.
3. **`4` and `13` are reserved indicators — they are never a final result.** The leading slot shows the result `z` once the game ends (on `input`; `dom` writes it over its status line and `prompt` pops an `alert` instead), otherwise the live indicator. Because `4` (check) and `13` (draw offer) exist only as *indicators*, a final `z` is never `4` or `13` — it's always one of `1,2,3,5,6,7,8,9,10,11,12,14,15,16,17`. So a `4` or `13` in that slot always means "in check" / "draw offered" (game still going), never a result. **One caveat on `dom`, where the two indicators add:** the both-at-once sum is `17`, which is also the resign code `BR`. The two are never actually ambiguous, because a finished game replaces the *entire* line — a live `17` appears inside a full status line (`00-07 17 M0 R1`) while a final `17` stands alone — but a test that greps the rendered digits without looking at the surrounding line can confuse them.
4. **Position is fixed, so the Number-prompt header reads left to right in one order:** corner label, turn digit, indicator, `M`, `R`, then `W` and `B` clocks — `00 1 4 M33 R2 W456 B454`. The first two bare numbers are always label-then-turn and the third is always the indicator; everything after wears a letter.

**One indicator, one slot — on `prompt`.** Here check and the draw offer **share** the slot and the offer wins, so `4` means "in check *and* nobody has offered" — if a draw is pending while you are in check you see `13`, not both. That is a display limit, not a rules one: the check is still there and you must still answer it. (`dom` is the exception: it shows the two independently and adds their codes, so `17` there means both at once. `input` shares the slot exactly as `prompt` does.)

In short: **clocks and counters wear a letter, the board label wears a hyphen, and everything left over is a position-fixed bare number** — and `4`/`13` in the indicator slot are always indicators, never outcomes.

### Game-result codes

When the game ends, it prints a **single number** (`0` means "still playing" and never shows). Two of these — **4** and **13** — are *live indicators* shown *during* play, not final results.

| # | meaning | outcome |
|:--:|:--|:--|
| **1** | checkmate — **White wins** | 1–0 |
| **2** | checkmate — **Black wins** | 0–1 |
| **3** | stalemate | draw |
| 4 | *(indicator)* the side to move is **in check** — shown in **all three interfaces** (`prompt` gained it; older prompt engines never printed it) | — |
| **5** | 50-move rule | draw |
| **6** | **White wins on time** | 1–0 |
| **7** | **Black wins on time** | 0–1 |
| **8** | insufficient material | draw |
| **9** | threefold repetition | draw |
| **10** | fivefold repetition | draw |
| **11** | 75-move rule | draw |
| **12** | draw by agreement | draw |
| 13 | *(indicator)* a **draw has been offered** (pending) | — |
| **14** | time ran out but the winner **can't mate** → draw | draw |
| **15** | opponent **resigned in a dead position** (can't mate) → draw | draw |
| **16** | **White wins** — Black resigned | 1–0 |
| **17** | **Black wins** — White resigned | 0–1 |

**Read the letter-pair mnemonic behind each number if it helps:** `1 = W#`, `2 = B#`, `3 = SM`, `4 = C!`, `5 = 50`, `6 = WT`, `7 = BT`, `8 = IM`, `9 = 3R`, `10 = 5R`, `11 = 75`, `12 = DA`, `13 = D?`, `14 = TM`, `15 = RM`, `16 = WR`, `17 = BR`. The code always names **the winner's side** for a decisive result (so `16 = WR` is *White resigns* → **Black** wins; `17 = BR` is *Black resigns* → **White** wins).

> **Note on 2 vs 3:** a decisive mate and the drawn stalemate sit next to each other so that the two checkmates (**1** White, **2** Black) are consecutive — that is what lets the engine emit them as a single arithmetic expression instead of a branch. Stalemate takes **3**. The same consecutive-pair trick underlies the win-on-time (`6`/`7`) and resign (`16`/`17`) codes, and at L0 the two king-captures (`1`/`2`) — each pair is emitted as `offset + colour-bit` rather than a branch.

**Which numbers can appear depends on the rules level:**

- **L5 (full FIDE):** all of the above can occur.
- **USCF rule set:** **10 (5R)**, **11 (75)** and **15 (RM)** never occur; **14 (TM)** is decided by material instead. (3-fold `9` and 50-move `5` remain as *claims*.)
- **L4:** no resign / draw-offer / can't-mate draw → codes reduce to **1 2 3 5 6 7 8 9**.
- **L3:** also no insufficient-material / repetition → **1 2 3 5 6 7**.
- **L2 / L1:** only **1 2 3** (White mate / Black mate / stalemate).
- **L0 (capture-the-king, no check):** the set is replaced — **1 = White captured the king**, **2 = Black captured the king**, **3 = draw** (only the two kings remain and the side to move didn't capture).

### Armageddon

Armageddon is scored, not simplified: **Black has draw odds, so every draw counts as a Black win.** The engine still reports *how* the game ended (the same numbers), then appends the **Armageddon score**: `WA` (White wins the match) or `BA` (Black wins the match). Number mode shows, for example:

```
5 ⟹ BA     (a 50-move draw — Black takes the point)
1 ⟹ WA     (White checkmates — White takes the point)
```

**Codes that occur at Armageddon** (11 of them) and how they score:

| # | reason | score |
|:--:|:--|:--:|
| **1** | White checkmates | **WA** |
| 2 | Black checkmates | BA |
| 3 | stalemate | BA |
| 4 | *(in-check indicator)* | — |
| 5 | 50-move | BA |
| **6** | White wins on time | **WA** |
| 7 | Black wins on time | BA |
| 8 | insufficient material | BA |
| 9 | threefold repetition | BA |
| **16** | White wins (Black resigned) | **WA** |
| 17 | Black wins (White resigned) | BA |

Rule of thumb: **only White actually winning the game scores `WA` (numbers 1, 6, 16)** — everything else, decisive-for-Black *or* any draw, scores `BA`. (Codes 10, 11, 12, 13, 14, 15 do not occur at Armageddon: there are no draw offers, and the 5-fold / 75-move / can't-mate gates are unreachable.)

**Working it out from the number alone — `z ÷ 5`.** If the score letters aren't shown (or you only have the bare result code), divide the result by 5 and look at the remainder: **remainder 1 → `WA` (White takes the match), any other remainder → `BA` (Black)**. This is exact, not a coincidence — the three White-win codes `{1, 6, 16}` are precisely the numbers that leave remainder 1 (`1 = 5·0+1`, `6 = 5·1+1`, `16 = 5·3+1`), and every other reachable code (`2, 3, 5, 7, 8, 9, 17`) leaves a different remainder. So `1⟹WA`, `6⟹WA`, `16⟹WA`; everything else `⟹BA`. (It is the same `z%5==1` the engine itself uses internally to decide the score without listing the three codes — the table was numbered so that test would work, and you can run it by hand.)

White also starts with more time here (at least a one-minute edge) — that is the price of draw odds, shown in the clock as e.g. `W300 B240`.

### One-screen cheat sheet

- **Move** = `<from><to>` as 2-digit indices, `00`=a8 … `63`=h1. Promotion: add a fifth digit `0`/`1`/`2` = B/R/N (omit it, or type anything else, for a queen).
- **Castling** = move the king two squares: `6062`/`6058` (White O-O/O-O-O), `0406`/`0402` (Black). **En passant** = play the diagonal capture onto the empty square (e.g. `2718`). No special syntax for either.
- **Resign** = submit an empty field (Number) / type `r` (Letter), or **cancel the dialog** in the prompt UI. **Draw offer/accept** = include any non-digit (a move plus a non-digit does both). Both L5-only.
- **Board cell** = `type×2 + colour`; odd = White, even = Black, `00` = empty; halve → piece (knights are `12`/`13`, above the kings).
- **Clock** = `W<sec> B<sec>`. In Number-prompt both sit in the header line; elsewhere they ride the board rows.
- **Status** = bare numbers: one indicator slot showing `13`=draw offered, else `4`=check, else `0` (offer beats check), then `M33`=move count, `R2`=repetitions. Blindfold adds `[…]`=your last input (raw, not cleaned); blindfold-prompt adds a `1`/`0` turn digit between the clocks (`W456 1 B454`).
- **Result** = one number; **1/6/16 = White win, 2/7/17 = Black win, 3/5/8/9/10/11/12/14/15 = draw; 4 = check, 13 = draw offered.** Armageddon appends `WA`/`BA` (draw = `BA`); to read it by hand, **`z÷5` remainder 1 = `WA`, else `BA`**.

---

## Optimization

### The guiding principle

The project's optimization rule is narrow and strict:

1. **Only the emitted engine is optimized.** The generator page is never size-budgeted; readability there is free.
2. **No *accidental* reduction of the interface or the engine.** Bytes are never bought by quietly dropping a feature, a rule, or a UI behaviour. Within a given rules level, every engine keeps exactly the rules that level defines and every interface keeps working; a saving is only acceptable if it is **behaviour-neutral** — proven identical by perft + a differential test, not merely "looks the same". Rule *removal* is legitimate **only** as an explicit, named Chesseus level (L4–L0). L5 remains **100% FIDE-legal** and is the fixed reference every optimization is measured against.
3. **Never lock up RAM.** No optimization may introduce a loop whose termination depends on a board property the current position might not satisfy.

### Two independent optimization surfaces

- **The emitted engine** — hand-golfing the source `build()` produces. Every gain here must be behaviour-neutral (perft + differential) and must respect the three rules above.
- **The RegPacked download** — a compression layer applied *on top of* the finished engine, affecting only that one download. All of its transforms are min-select-protected or guard-checked; none touch the engine or the plain download.

**The engine core is saturated; the presentation layer was not.** The core (`I/S/f/L/J/G/M/Q/K`) is a proven local minimum — a substring/alias scan over it turns up only operators and keywords, nothing aliasable, and every hand-golf attempt on its geometry, castling, EP and result terms has come back equal or longer. The clock / period / result paths are likewise at their floor: the period hook folds equal block-adds into one product test and equal increments into a collapsed threshold ladder, the increment folds into the Fischer/Bronstein accumulator, and the prompt clock carries no dead real-time counters.

The **render layer**, however, was *not* fully reduced, and the gap had a specific shape worth remembering: **build-time constants that were folded but never simplified.** With rotation off, `build()` sets its side-token `ct` to the literal `"1"` and then splices it into expressions that were written for the rotating case, so the emitted engine carried `${'WB'[1]}: ${1?N:U}s` — 21 bytes to print what is always the two characters `B: ` plus `N`. Collapsing those to `B: ${N}s` / `W: ${U}s` (and the same in the prompt's fullwidth board) took **−26 B** off every non-rotated `input` engine and **−28 B** off `prompt`; flipping the DOM clock's side-pick from `!j?N:U` to `j?U:N` took another **−1 B**. All behaviour-neutral (identical renders under asymmetric clocks, both sides to move), and the rotating path — where the token really is variable — is untouched.

The lesson generalizes: whenever an option is *off*, grep the emitted engine for its constant (`[1]`, `1?`, `?…:…` on a literal) and check whether the surrounding expression still pays for a choice that no longer exists. Treat the core as done; hold any new core idea to the bar of "provably neutral and actually worth the byte" — but the presentation layer still rewards a careful look.

#### The template-literal boundary fold (−1 B, 30 variants)

A second presentation-layer leak, same flavour: **punctuation paid to leave a template literal and immediately re-enter it.** The text renderers spliced the board in by breaking out of the string:

```js
D=_=>t.innerHTML=`…B: ${N}s\n\n` + (BOARD_EXPR) + ` a b c d e f g h\n\nW: ${U}s\n`
```

That boundary — `` ` `` `+` … `+` `` ` `` — is **six characters** of pure punctuation to interpolate a value the template can hold directly. A `${…}` hole is **three**:

```js
D=_=>t.innerHTML=`…B: ${N}s\n\n${BOARD_EXPR} a b c d e f g h\n\nW: ${U}s\n`
```

The expression is unchanged; only the seam moves. **−1 B**, and the nested backtick it puts inside the hole (the `` ` ${m}\n` `` in the `replace` callback) is legal — template literals nest freely, so no escaping is needed.

**Where it fires: 30 of the 72 renderable variants.** The fold needs the template to **reopen** after the expression, so it applies exactly where the board has trailing template content:

| Interface | Fires? | Why |
|---|---|---|
| `input` (counted / strict) | **yes** — all levels, rot on and off | the file-letters row and the bottom clock follow the board |
| `input` (blindfold) | no | no board is rendered at all |
| `prompt`, **L5 / Armageddon / L4 / L3** | **yes** | the bottom clock line follows the board |
| `prompt`, **L2 / L1 / L0** | no | `noClock` — the board is the *last* thing in the string, so there is nothing to reopen into; the plain `` `+ `` concat is kept |
| `dom` | no | the DOM renderer writes cells directly (`self['o'+i]`); it emits no template boundary at all |

This is a **per-engine** byte, not a cumulative one: a user who downloads an `input` engine saves 1 B, a `dom` user saves nothing. Verified behaviour-neutral by driving the same game through the pre-fold and post-fold engines and comparing the rendered text on every ply — byte-identical across all 36 board-rendering configurations, with 0 `SyntaxError`s over the full 8,064-config matrix.

### Two golf rules the whole engine rests on

- **Operator precedence.** Relational (`< >`) binds tighter than equality (`==`), which binds
  tighter than bitwise `&`. Chains like `p>_&p<TH==T` rely on exactly that; add parentheses only
  where precedence would betray the intent, never for reassurance.
- **Occupancy is `>_`, not `!=_`** — the single most important rule here. Empty is `_='-'` (45) and
  every piece is a letter (>45), so `s[i]>_` (2 B) tests "this square has a piece", is **1 B shorter**
  than `s[i]!=_`, and chains straight into the colour test (`>_&<B==T`). All seven piece/colour tests
  use `>_`; empty tests use `==_`. **One deliberate exception: `S`'s path-clearing loop keeps `!=_`.**
  There, `!=_` reports "blocked" for an off-board `undefined`, whereas `>_` would read `undefined` as
  empty and let the scan run off the edge — sliders (queen, bishop, rook) walked off the board, span
  forever, and took the tab's memory with them. `S` is collinear so it never actually leaves the board
  and `>_` *would* also be safe for 1 B, but the `!=_` stays as belt and braces against a future
  misuse of `S`. So: `>_` for occupancy everywhere except the one `!=_` inside `S`.
- **Intersection optimizations.** When two options are both on they sometimes carry redundant state
  that merges — strict's move counter `B` and a multi-period game's ply counter `mc` are the same
  number, so multi-period strict drops `mc` and reuses `B`; the strict colour-threshold `x`/`u` gives
  strict the one-character threshold that counted already had.

### Warnings & gotchas (read before any byte change)

- **A draw offer and a draw claim are different things, and only the offer is throttled.** The cooldown exists so neither side can spam *offers*; a **claim** (50-move, threefold) is addressed to the arbiter, not the opponent, and FIDE 9.2/9.3 lets you make one for the position that will arise *after the move you are about to play*. Two bugs came from conflating them, one per interface family. In **`dom`**, the claim was gated on `e` — the offer bitmask — so a spent cooldown blocked the claim as well: ticking ½ could not set `e`, the post-move `Cl()` never ran, and a legitimate 50-move claim was silently lost. It now reads `x.checked` instead, which the cooldown never touches (and which `D()` must therefore **not** rewrite each frame — the `x.checked=e&2-T` line is gone; `K` clears the box after the move instead). In **`input`/`prompt`**, the claim was never broken, but the cooldown was armed the moment `e^=` flipped, so a slot could be spent on an offer that was toggled straight back off, or attached to an invalid move that never flipped the turn. Arming moved to `W^T&&e&2-W`, evaluated after `e^=` in the same branch. In both families the rule is now the same: **a slot is spent only when an offer was actually presented to the opponent.**
- **Status-line spacing is a Letter/Number split, and the Number side is produced by rewriting the Letter side.** Letter pads the `prompt` header so the readouts hold their columns as indicators come and go, and it does so in two shapes. Most builds use a uniform **3**-space gap between adjacent readouts (`a8   W   C!   M=1   R=1`), with the pad living *inside* each indicator arm — blank arm included, padded to the width of the lit ones, which is what stops `M=` sliding left every time a check clears. **L5 with rotation on** instead reproduces the reference build column for column: 6 spaces after the coordinate, arms carrying no pad of their own, 5 before `M=`, 3 before `R=`, one trailing space; its arms are 2/3/4 wide, so `M=` still drifts up to 2 columns there — deliberately matched, not derived. Number collapses all of it to a single space (`00 1 4 M1 R1 W600 B600`), because its cells are fixed-width tokens with nothing to align. **That collapse is keyed to the exact Letter pad widths, so changing a pad in `build()` silently orphans its rule** — the Letter output moves, the Number output keeps a width that no longer matches, and nothing errors. To keep the two from drifting apart again the padding is folded off in ONE place: an unpad block at the very top of `toNumericText`, ahead of the coordinate rewrites and the code loop, which rewrites the padded header back into the unpadded shape every rule downstream was written against. **Its placement is load-bearing** — the first attempt sat in `_numResultCodes`, which the text path calls *after* the `a8`→`00` rewrite, so it matched nothing and leaked `'C! '` into the Number engine. Same trap one level down: the rotated prompt reaches the bottom clock *after* `.join('')` → `` .join`` ``, so a rule anchored on `}` misses it and needs its own post-join form.
- **The status indicator is ONE slot on `input`/`prompt` and TWO on `dom`, and `prompt` has a check indicator at all now.** On `input` and `prompt` check (`C!`/`4`) and the draw offer (`D?`/`13`) share a single chained slot — `z > D? > C! > off` on `input`, `D? > C! > off` on `prompt`. On `dom` they are **independent**: Letter concatenates two optional arms (`+(e?' D?':'')+(J(T)?' C!':'')`) and Number **sums** the codes (`(e&&13)+J(T)*4`), giving 0/4/13/17. Three things trip people up. (1) `dom` once carried two separate slots straddling the board label (`D? a8-h8 C!`), then a single shared slot, and now two arms *after* the label — a doc or test asserting either older shape is stale. (2) `prompt` carried **no check indicator at all** until this change — its header was draw-offer-only — so an older prompt engine will never print `C!`/`4`, and `4` was unreachable there. (3) `dom`'s result no longer goes in a clock box; it replaces the whole status line. Number's off-state must stay `J(T)*4`, never `J(T)&&4` or a `?4:0` ternary: `J` returns a boolean, `&&` renders the string `false`, and the ternary costs 3 B to print the same `0` the multiply gives free.
- **Occupancy is `>_`, but `S`'s path-clear test must never use `>_`.** Empty is `_='-'` (char code 45); every piece is a letter (>45). So `s[i]>_` tests "this square has a piece" in 2 bytes and chains into the colour test (`>_&<u==T`). All piece/colour tests use `>_`; empty-tests use `==_`. **`S` is the one exception.** An off-board index reads as `undefined`, and `undefined > '-'` is `false`, so a `>_` test there does **not** see the edge as "blocked" — the scan walks off the board and **spins forever, locking up RAM**. The two safe forms are `s[f]!=_` (in a `while` loop — `undefined != '-'` is `true`, terminates the scan) and `s[f]==_` (in the current recursive form — `undefined == '-'` is `false`, so the short-circuit `s[f]==_&&S(...)` doesn't recurse). **Either is fine; `>_` is not.**
- **Retry loops that wait on a board condition can hang.** A `do{…}while(square empty / wrong piece)` spins forever when no such square exists (mate/stalemate, or a position with none of that piece). Never let a loop's exit depend on a board property the position might not satisfy — enumerate with `G` and index into the result, or guard with `z`.
- **Emitted engines depend on sloppy mode — and always have.** The engine's entire top-level state (`u`, `A`, `s`, `C`, `Y`, `T`, `z`, `o`, `e`, `P`, `b`, …) is assigned without `var`/`let`, so under `"use strict"`, as an ES module, or through a bundler that adds either, the very first assignment throws `ReferenceError: u is not defined` — verified on an untouched build, so this is a pre-existing property of the format, not something any recent change introduced. Dropping `y`'s declaration from `G`/`L` (see the byte note above) adds one more name to that set but does not change the picture: strict mode was already unreachable. Emitted files ship as plain `<script>`, where all of this is legal. It is listed here because it is invisible until someone embeds an engine differently, and because it is the same constraint that rules out `with(…)` in the DOM render.
- **`y==e` is mandatory** in the 960 castle line (without it, a cross-rank capture of an enemy rook mis-castles).
- **`C&R[r]`** is only a valid long-castle shortcut when the long rook is on the a-file.
- **The castling clauses skip the make-then-`J(W)` legality filter** that normal moves get — they push directly after static `!O`/`!L` transit tests, evaluated *before* the rook vacates. On **b-file long-rook skeletons** (`rlf===1`) queenside castling can open an a1→c1 discovered check that the static tests miss; `castle960` adds a guard for exactly those. If you restructure the clauses, keep that guard or route castling through make-then-`J`.
- **The emitted markup's close tags are load-bearing wherever an `innerHTML` render target follows — do not "tidy" them.** `</pre>` (input) and `</p>` (DOM) sit next to deliberately unclosed tags and look redundant. They are not: without them `<input id=X>` parses *inside* `<pre id=t>`, and the `<table>` parses *inside* `<p id=W>` — and since `D()` renders with `innerHTML`, which **destroys the target's children**, the first frame deletes the input box / the board. (An implied `</p>` is *not* generated before `<table>`: `<table>` is valid flow content inside `<p>`, so it nests.) Test with `document.open()/write()/close()`, **not** a fresh parse — a fresh parse normalises the nesting and hides the bug. The question to ask before deleting any tag is *which `innerHTML` target is it fencing me out of?* `</label>` **used to be** dropped (−8 B) on the grounds that nothing renders into a label and HTML5 cancels a label's synthetic click when the clicked target is itself interactive, so the ⚐ button parsing inside the label still fired `X(1)` without toggling the draw control. That is true but fragile, and it fused two independent widgets into one element; the label now closes right after ½ and ⚐ sits outside it. `</button>` is **not** safe either — see *Tried and abandoned*.
- **Operator precedence:** relational (`< >`) > equality (`==`) > bitwise `&`. Chains like `p>_&p<u==T` rely on this; add parentheses only where precedence would betray the intent.
- **Existence-test the move list with `G(i)+''`, never `G(i)[0]`.** RESULT decides mate/stalemate via `s.some((p,i)=>…&&G(i)+'')`. `[]+''===''` is falsy (no moves); a non-empty list is truthy. `G(i)[0]` is **wrong**: square index 0 (a8) is falsy in JS, so a position whose only legal move lands on a8 would read as "no move" → a phantom mate. Keep `+''`.
- **The clock-end block (`TM`/`RM`/`BT`/`WT`/`BR`/`WR`) is delicate.** Flag-fall branches on `Q(W)` (FIDE) or the material test (USCF) to choose win-on-time vs draw-on-time, and the resign codes interlock through the same gate. One altered term silently flips a legitimate result. Verify any change with driven clock games that flag on both sides, including a flag-fall in king-vs-king (which must be `TM`, a draw) — and run both rule sets.
- **The universal ply counter is one letter `B`.** Fragments in `build()` are written `mc` and rewritten to `B` before assembly; the placeholder never reaches an engine. In strict, the history `++B` advances the counter once per ply *before* the hook, so the hook must not increment again (strict drops the folded `++mc` to `mc`); counted/blindfold keep the hook's own increment. Any new period-hook fragment must respect this split.
- **An ep capture vacates TWO squares, not one — never test the pin against the un-mutated board.** The capturer leaves its origin *and* the captured pawn leaves its square, and those two squares are on the **same rank**. A rook or queen on that rank can therefore see the king through the pair even though neither square alone would have exposed it. Any legality test for an ep target (the engine's `G()` filter, the editor's `edValidate`) must simulate the capture in full — land on the ep square, clear the origin, clear the captured pawn — and only then ask whether the mover's king is in check. Testing "is the capturer pinned right now" passes this position and is wrong.
- **`K2` commits, `K` commits AND renders — and an asynchronous caller has to know the difference.** DOM's `K` ends with `D()`; the text drivers' hoisted `K2` is only the commit group, and the render that follows it belongs to the *handler*, not to `K2`. Anything that calls `K2` from outside the handler must therefore draw for itself. A synchronous caller (the `R` bot) is fine by accident — it finishes before the handler's own `D()` runs. An asynchronous one (a search bot on a timeout) is not, and the symptom is invisible wherever a clock tick redraws anyway: it only surfaces at L2 and below, where there is no tick at all, and there it looks like "the bot is not playing" when in fact the bot has played and nothing repainted. Test it by comparing what the display currently shows against a forced re-render, not by reading `z`/`T`.
- **Promotion is free:** pick the destination and `M(f,l,'q')` promotes — no separate promotion branch is needed.

### The numeric bitfield board — applied, a Letter/Number generator switch

The largest single win found, and it is now **in `build()`** as a **notation switch** in the generator's rules controls: **Letter** (the char board) or **Number** (this bitfield board). It applies to **all three interfaces** — the clickable DOM board, the text field, and the `prompt()` loop — and to every info level including **blindfold**, and it composes with **FEN** start positions and **Chess960**. The two silent traps below were both real and are both handled by the transform; a third class (a stray char-comparison the transform missed) bit three separate times during bring-up and is documented under *"bugs the transform must not miss"* below — read that section before touching the transform.

The switch is a **post-process on the assembled char engine**, not a second engine: `build()` emits the normal char engine, then (when Number is selected) two functions — `toNumericDom` for the DOM board, `toNumericText` for the input/prompt text board — rewrite it token by token into the numeric form. That keeps the char and numeric engines from drifting: there is exactly one engine source, and Number is a mechanical transform of it. **Letter output is byte-identical to the pre-switch engine**, so the whole feature is inert unless Number is chosen.

Measured savings at L5 (fischer, no bot), char → numeric with the board edge labels held constant: DOM strict **2600 → 2482 (−118)**, input strict **≈−110**, prompt strict **1932 → 1817 (−115)** — prompt's jump reflects dropping the fullwidth board render (see the render section); the number-mode coordinate labels add a few bytes back, so the pure-render win is larger — and the largest on **blindfold** (no board render to carry) at **input 1927 → 1795 (−132)** / **prompt 1854 → 1722 (−132)**. (Strict input additionally drops its edge labels for a further ~25–56 B — a Letter/Number-independent change, documented below.) **Input and prompt shed a further ~13–14 B** on top of these figures by dropping the move-field `.toLowerCase()`: the char engine lowercases the typed move so `E2E4` works, but a Number move is digits only — there is no case to fold — so the call is dead weight and the transform removes it (prompt drops the bare call; input rewrites `i=X.value.toLowerCase(X.value='')` to `i=X.value,X.value=''`, keeping the box-clear side effect). DOM has no such call, and Letter keeps it.

**Blindfold takes the switch too.** An earlier version of this section (and the first cut of `opts()`) forced blindfold to Letter on the reasoning that "blindfold has no board to encode." That reasoning is wrong: blindfold has no *visible* board, but its internal `s[]` array still holds the position, and the numeric encoding shrinks `f/G/M/L/I` all the same — so the switch is enabled there and delivers the *biggest* per-engine win (−132 B), since there is no render code to offset it. The lesson is the same one the `bgcolor` and `</p>` items teach elsewhere: the visible surface is not the whole engine.

**The idea.** The board holds *characters* (`'N'`, `'p'`, `'-'`) and every rule test is a string comparison. Hold **numbers** instead and give the bits meaning, and most of the rule logic stops being comparisons and becomes arithmetic that was already there.

```
raw = folded*2 + colour        colour = bit 0  (0 = Black, 1 = White)        empty = 0
folded:   1 = bishop   2 = rook   3 = queen   |   4 = pawn   5 = king   6 = knight
raw:      b=2 B=3   r=4 R=5   q=6 Q=7   p=8 P=9   k=10 K=11   n=12 N=13
```

**Why that ordering.** The three sliders occupy folded `1,2,3`, so their movement rights *are* their low bits:

| folded | bits | `P&1` → diagonal | `P>1` → straight |
|---|---|---|---|
| bishop = 1 | `001` | ✔ | ✘ |
| rook = 2 | `010` | ✘ | ✔ |
| queen = 3 | `011` | ✔ | ✔ |

and the three leapers sit *above* them at `4,5,6`, so `f`'s dispatch chain collapses from three equalities to three range tests, in descending order:

```js
// char:   P=='N'?D*H==2:P=='K'?D<2&H<2:P=='P'?c:(D*H?D==H&P<'R':P>'B')&S()
// number: P>5?D*H==2:P>4?D<2&H<2:P>3?c:(D*H?D==H&P&1:P>1)&S()               −13 B
```

Both slider tests must yield **0/1**, because the enclosing `&S()` is bitwise — that is why diagonal is `P&1` (bit 0, so the mask is already 0/1) and straight is `P>1` (a boolean) rather than the more obvious `P&2`, which would yield `2` and silently zero the `&`.

**Where the bytes come from.** Five things collapse at once:

- **`V=p=>p.toUpperCase()` is deleted** (−21 B). The colour fold is now `p>>1`.
- **`u='a'` is deleted** (−6 B). The colour test is `p&1`.
- **The `_='-'` sentinel is gone.** Empty is `0`, so occupancy is truthiness — eleven tests (`p>_`, `g==_`, `s[r+i]>_`, …) each shed 2–3 B.
- **The DOM glyph translation table disappears** (−18 B): `' ♚♛♜♝♞♟'['-KQRBNP'.search(V(y))]` → `' ♝♜♛♟♚♞'[y>>1]`. The folded value *is* the glyph index.
- **Piece identity becomes arithmetic**: promotion `W?V(p):p` → `p*2+W`; the king lookup `s.indexOf('kK'[+W])` → `s.indexOf(10+W)`; the ep pawn `'Pp'[+W]` → `9-W`; the helpmate probes `j('nN')&j('pP')&…` → `j(12)&j(8)&…`; and `I`'s classification chain `q<'C'?…:q=='N'?…:m|=q>'K'` → `q<2?…:q>5?…:m|=q<5`.

Measured per function, so the arithmetic reconciles (script body, char → numeric):

| | char | numeric | Δ |
|---|---|---|---|
| `f` (move shape + slider) | 139 | 125 | **−14** |
| `G` (move generation) | 369 | 357 | **−12** |
| `M` (make move) | 260 | 247 | **−13** |
| `Q` (helpmate) | 85 | 72 | **−13** |
| `I` (insufficient material) | 107 | 98 | **−9** |
| `J` (in check) | 31 | 27 | −4 |
| `L` (attacked) | 101 | 100 | −1 |
| prelude (board init, `V`, `u`) | 178 | 175 | **−3** ← the −23 B decode almost cancels the two deleted helpers |
| UI tail (glyph lookup, `K`, `H`) | 1273 | 1231 | **−42** |
| **script body** | **2543** | **2432** | **−111** |
| **whole file** | **2560** | **2469** | **−91** |

*(These per-function figures are from the original DOM-only prototype, before the switch shipped; they show where the encoding win comes from and still hold — `f/G/M/L/I` are unchanged. The prototype's glyph table was already index-based, so its render cost nothing; the shipped input/prompt renders (one hex digit per square, see the render section) are cheaper than the glyph map the first cut used, which is why the current whole-file deltas — DOM −118, input ≈−110, prompt ≈−115 — differ from this prototype's −91. Prompt's is the largest of the three because it also sheds the fullwidth board mechanism. Blindfold, with no render at all, lands at −132.)*

**The one cost is the board initialiser.** Numbers cannot be spread out of a plain string, so they must be decoded. Four decodes were measured; hex digits + `parseInt` is the cheapest: `s=[...'4c26a2c4…'].map(c=>parseInt(c,16))` at **83 B**, against `charCodeAt()-48` 86 B, `indexOf` into a lookup string 96 B, and `charCodeAt()&15` 98 B. The char board's initialiser is **65 B** — a plain spread with *no decode at all*. That +23 B gap is the irreducible tax of leaving characters, and it is why the prelude only nets −3 B despite `V` and `u` both vanishing there.

**Do not then try to nibble-pack the board.** Once the board holds numbers, the next thought is always *"a piece is 4 bits, so one byte holds two squares — the 64-square board should be 32 bytes."* That is a statement about **memory**, and the source is not memory: it is **UTF-8 text**, where a "byte" means *one ASCII character*. The packing was built and measured (`nib.html`), and it is **+16 B**:

- Piece values are `0..13`, so a packed pair needs **14 × 14 = 196** distinct values. Source-safe printable ASCII (codes 32–126, minus `'` `"` `\` `` ` ``) offers **91**. **196 > 91** — a packed byte *cannot* be written as one source character.
- So the packed characters spill past U+007F and **UTF-8 charges 2 bytes each**: the "32-character" string is **45 bytes**. The halving evaporates before the decoder is even written.
- The decoder then costs 53 B on top (`.flatMap(c=>[(c=c.charCodeAt()-40)>>4,c&15])`), for 99 B against the 83 B one-hex-char-per-square form.
- And the real compression was already done: **`padEnd` crushes the 32 empty squares — half the board — into a handful of source bytes.** Nibble-packing *expands* those same 32 squares to 16 characters (and, since half of them land above U+007F, more than 16 bytes).

The colour-symmetry trick (white = black + 1, the numeric analogue of the char V-split) was measured too: **+12 B**. The `+1` map costs more than the 16 characters it saves. `nib.html` is perft-clean at 2485 B — it works, it is just bigger.

Wider fields (5-bit pieces, a 0–31 range, extra "is this square attacked" flags) buy **nothing** for the same reason: `p&4` is three characters whether the piece is 4 bits or 32, and the current scheme is *already* a bit-mask — colour is bit 0 and the slider rights are the folded low bits. Adding a range-bit (`bit3 = slider`) does not beat `P>3`, which is the same three characters and keeps the leapers contiguous — and contiguity is what makes `P>5 / P>4 / P>3` possible at all. Spreading pieces across a wider field to make every bit "meaningful" *breaks* that contiguity and forces equality tests back. The knight and the king are the proof: neither is expressible as "straight and/or diagonal rights", so any semantic bit layout collides on them.

**Two traps. Perft caught both; the byte count looked right through both.**

- **The `S` slider hangs.** The obvious empty test for a numeric board is `!s[a]` — and it is **true off-board**, because `!undefined === true`. `S` walks straight off the edge and recurses forever. (`S` *is* reachable with a non-collinear pair: the outer `&` is bitwise, so it runs even after the shape test has already failed.) The char version survives because `s[a]=='-'` is *false* off-board. Use **`s[a]<1`** — false off-board (a NaN comparison), true only for a real empty square, and only 1 B more than `!s[a]`.
- **A raw value cannot enter a bitwise `&` chain.** A char board's `g>_` yields a **boolean**; a number board's bare `g` yields the **raw value** — and `1 & 8 === 0`. Written as `D==1&(g|i==Y)`, every diagonal pawn capture is silently rejected (perft 8902 → 8888). Use **`g>0`**. Auditing all nine truthiness conversions, exactly one was wrong: the rest survive because they feed `!`, `&&`, or a ternary condition, none of which care about magnitude.

Also note the empty-square glyph must stay a **non-breaking space (U+00A0)**, not U+0020. HTML collapses an ordinary space, the `<th>` gets no line box, and **every empty rank renders at zero height** — the board loses half its rows and no error is thrown.

**Bugs the transform must not miss — a char comparison left un-rewritten is silent.** The transform's job is to rewrite *every* char-comparison into its numeric form. Miss one and it does not throw — `P=='K'` on a numeric board (where `P` is a number) is simply always `false`, and the associated rule quietly stops working. Three of these bit during bring-up, none caught by depth-4 perft from the start (which reaches neither castling nor these specific check/promotion cases), all caught by a **random synchronised differential** (Number vs Letter, same seed, full legal-move lists compared ply by ply):

- **Castling had two `P=='K'` sites, not one.** The dispatch chain in `f` was rewritten, but the *castling* clauses — `P=='K'&!J(W)` in `G` (generate) and `P=='K'&D==2` in `M` (execute, the rook hop) — are separate occurrences the `f`-rule never touched. Both went `false`, so castling silently never generated *and* the rook never moved. Both become **`P==5`** (exact king; a range like `P>4` would also fire for the knight, which cannot castle). Depth-4 perft passed throughout — castling only appears once the pieces between king and rook clear, deeper than d4 reached.
- **A raw value in a bitwise `&` — the check scanner.** `L`'s own-piece filter is written `p>_&p<u==b` in char (two booleans joined by `&`, fine). The naïve numeric rewrite `p&p%2==b` parses as `p&(p%2==b)` — a **bitwise** AND on the raw value — so a black (even) piece gives `6&1 = 0`, falsy, and is skipped in the attack scan. The king could then move into check. Fix: **`p&&p%2==b`** (logical). This is the same "raw value cannot enter a bitwise `&`" trap as the pawn-capture bug above, in a second place; the char version survives both because `p>_` is a boolean.
- **A leftover string default — NaN promotion.** `M`'s signature carries a promotion default `p='q'` (the char engine's queen). On a numeric board `p*2+W` with `p='q'` is `NaN`, written to the board — and it fires during *move generation*, because `G` calls `M(d,i)` with no promo argument when testing a promoting pawn. Depth-4 perft masked it because both harness sides did it identically. Fix: **`p=3`** (folded queen; `3*2+W` is the queen value).

The pattern across all three: perft from the start is a weak test for these, because the offending state is rare or symmetric. The **random synchronised game** — compare the two engines' full legal-move lists at every ply of many seeded games — is what catches a generation divergence, and it found each of these within a few plies.

**Verified.** perft 20 / 400 / 8902 / 197281 across **all three interfaces** (DOM, input, prompt — the last via a core-only cut before its blocking `prompt()` loop), on both **rotations**; a random synchronised differential (Number vs Letter, seeded, full legal-move lists per ply) clean over 100+ games × 50 plies including **blindfold** and **FEN** start positions (castling, en-passant, promotion-ready), with boards, ep targets, castling rights, repetition keys and 50/75-move counters matching Letter at every ply, and the insufficient-material verdict (incl. the K+N+N-is-*not*-insufficient weighting) matching across material; the numeric board rendered correctly in every interface and both rotations (1-digit hex cells, index edge labels, aligned grid) with no `NaN`/`undefined` cells and the clock label on the correct line; **Letter output byte-identical** to the pre-switch engine across the whole `{interface × info × FEN × 960}` matrix — except for the deliberate strict-input label removal (see below), where counted and blindfold stay byte-identical and only strict changed.

**How the text-UI board render was resolved — and why it ended up as one hex digit.** The text UIs print the board *as characters* — `s.join(' ')`, chunked with `.replace(/.{16}/g, …)`, which needs **exactly one character per square** — so a raw numeric board renders as `4,12,2,…` and shatters the grid (values 10–13 are two characters). The first fix was a **one-character-per-value glyph map** (`'-.bBrRqQpPkKnN'[c]`, so `4 → 'r'`, `9 → 'P'`, `0 → '-'`), which re-aligned the grid and made the numeric board *read like the letter board*. That worked but cost ~18–28 B per text engine, and it re-introduced a legibility goal the Number mode does not have — the whole point of Number is byte economy with a printed guide, not on-screen readability.

The shipped render is simpler and smaller still: **print every value as one hex digit** (`c.toString(16)`, so `0→'0'`, `4→'4'`, `13→'d'`) and **drop the space separator** (`.join``` — a tagged template, where `join` receives the strings array `['']` and `String([''])` is `''`, so the separator is the empty string for 2 B less than `.join('')`). Every cell value is 0–13, which is a single hex digit *by construction*, so no padding branch is needed at all; a rank is `8×1 = 8` characters and the grid split is `/.{8}/`. The board reads as hex codes — `4c26a2c4` per rank — which a guide decodes (`4`=black rook, `9`=white pawn, `0`=empty). An earlier build padded each value to a fixed **two decimal digits** (`c<10?'0'+c:c`, rank `0412020610021204`, split `/.{16}/`); hex replaced it because the pad ternary disappears (`c.toString(16)` is shorter than `(c<10?'0':'')+c`), the rank halves from 16 characters to 8, and the row-label arithmetic collapses from `i/2` to `i`. Two things make this strictly better than the glyph map:

- **It is smaller.** The per-cell expression `(c<10?'0':'')+c` is shorter than the glyph lookup `'-.bBrRqQpPkKnN'[c]`, and dropping the space separator removes the `join(' ')`'s argument. Input lands at **−11 B** vs the glyph render.
- **Prompt drops fullwidth entirely — the big win.** The prompt board fullwidth-shifted every cell (`String.fromCharCode(c.charCodeAt()+65248)`) so its **letters** would line up in the dialog's proportional font. Hex digits don't need that: they are equal-width (tabular figures) in essentially every font, so plain ASCII single-character cells already align in columns. Deleting the whole fullwidth mechanism is **−45 B** on prompt — the single biggest render saving. It is why prompt's char→numeric delta went from −82 B (glyph era) to about −220 B now (the index coordinate labels add a few bytes back; the pure-render swing was larger).

Both renders have rot and non-rot forms with different cell expressions (non-rot `s.map(c=>…)`, rot `(T?s:s.toReversed()).map(…)` for input, and prompt's own inline per-cell separator), so the transform rewrites each; missing the rotated one leaves that board printing raw numbers (a real bug caught in testing — the generator defaults rotation on, so the rot path is what a fresh Number engine actually renders). One grid subtlety: the char board string was 127 chars (64 glyphs + 63 separators, no trailing space) so its **last** rank was 15 chars — unmatched by `/.{16}/`, hence no trailing newline, so the `W:` clock sat on the rank-8 line. The hex board is 64 chars, so `/.{8}/` matches all 8 ranks and the callback appends a newline after rank 8 too, pushing `W:` onto its own line. The non-rot prompt grid used to end with `.slice(0,-1)` to strip that one newline back; it now uses `/.{8}(?!$)/g` instead, so the final block never matches and never gets a newline in the first place — 7 B cheaper and byte-identical output. DOM is untouched throughout — it renders cells directly with its own index-based glyph table (`' ♝♜♛♟♚♞'[y>>1]`), which was already free.

**FEN and Number compose.** A FEN start position seeds the board through a different code path than the plain/960 arrangements: the board literal is single-quoted (`'r-bqkbnr…'`) rather than a template literal, and a FEN with no en-passant target sets `Y=_` (the char empty marker). Both had to be taught to the transform — the board-init regex now matches either delimiter (`` [`'] ``) so the FEN board is hex-encoded like any other, and `Y=_` is rewritten to `Y=-1` (a FEN *with* an ep target already sets `Y` to a square index, which is numeric-correct as-is). Before this, a Number+FEN build ran and then died at load with `_ is not defined`, with the board left as raw letters.

**Coordinate labels become square indices in Number mode.** Once the board prints numbers, algebraic edge labels (`a`–`h`, `1`–`8`) read oddly beside it, so in Number mode every coordinate indicator becomes the square's **0–63 index, 2 digits**: `a8=00`, `h8=07`, `a1=56`, `h1=63` — standard layout, top-left `00`, incrementing left-to-right then down. The guiding rule is that a label always shows the **physically displayed** square at that position, so with rotation on the labels follow the flipped board. Each interface carries this differently:

- **DOM** shows the move-format hint as a top-edge square range: `'a8-h8'` → `'00-07'`, and rotated `'h1-a1'` → `'63-56'`.
- **Input** keeps its left-rank + bottom-file layout and relabels (this is "option A" — the alternative was to mirror DOM's top-edge labels, or drop edge labels entirely). The left label per rank is that rank's a-file index (`i` for the 8-char grid → `00 08 16 … 56`); the bottom row is the file **numbers** `01234567` — *not* the 2-digit rank-1 indices, because a full `56 57 … 63` row is far wider than the board and overhangs. With one hex digit per square the file digits sit flush, one under each column, so the row is exactly as wide as a board rank (three leading spaces clear the rank label, then eight digits). Rotated, the left labels follow the reversed board (black view: `63 55 … 07 = 63-i`) and the bottom file numbers reverse (`76543210`).
- **Prompt** shows the top-left displayed square as an orientation marker: static `a8` → `00`, and rotated `${T?'a8':'h1'}` → `${T?'00':'63'}`.

One alignment detail: the numeric board cell is 2 adjacent digits and the input rank label is 2 digits wide (`00`), versus the letter board's 1-char rank label (`8`). So the file-number row needs **2 extra leading spaces** for its digits to sit under the board columns; without them the labels drift left under the rank label. Letter mode keeps its single space (its rank label is one char). This is a Number-only tweak — the letter renders are byte-identical to before.

**Strict input drops the board's edge labels entirely (−25 B non-rot / −56 B rot).** Strict already prints the full move list after every move, with each move's from/to squares, so the board's own rank/file labels are redundant *in strict specifically*. Removing them is a strict-only variant of the input board render: the rank label (in the grid callback, `LABEL+` ${m}\n``) and its separating space both go, and the bottom file row (the tail's leading ` ${files}`) goes with its own trailing newline — dropping that newline too, or a blank line is left between the last rank and the clock. This applies to **both** Letter and Number strict (so Letter strict is no longer byte-identical to the pre-change engine — but counted and blindfold are, and DOM/prompt strict are untouched, since only the input board render forked). Counted keeps both labels. The rot saving is larger than non-rot because the rotated label expressions were themselves longer (`(i/16^T*7)+1` rank, the two-string file selector) than the non-rot ones.

**The generator preview colours the board as engine state.** In the highlighted Code panel, the numeric board literal (`s=[...'hex'+'0'.repeat(n)+'hex'].map(c=>parseInt(c,16))`) is the starting position — engine *state* — so it reads **blue (`.eng`)**, the engine colour, not turquoise (`.str`), the colour of engine-side string constants. The highlighter paints every engine string `.str` by default; a post-process finds just the board block (bounded by `s=[...` and `.map(c=>parseInt(c,16))`) and flips its spans to `.eng`. The game-end result tokens (`'TM'`, `'RM'`, `'WR'`, `'IM'`, `'5R'`, …) stay turquoise — they *are* display constants. This is generator-only; it does not touch an emitted engine.

**Now measured — Number packs better too, and it changes which form wins.** The character distribution of a numeric engine changes completely (letters → digits), so RegPack's tokens shift, and the plain-file saving does carry through to the packed download. It also flips two pipeline decisions: **board-flatten wins on Number and loses on Letter** (the dashes are cheap in a letter board but tokenise well next to digits), and Number bodies drop `$ K V w x`, a different letter budget that shifts the merge winner. Both are handled by min-select and by `notation` being a key axis in `RP_PLAN` — see *The RegPacked download*.

### Measured RegPack levers — three that paid, one that could not

These are packed-output findings: each was measured through `regpackCompressF`, not inferred from
the plain source. They are recorded because the reasoning generalises, not because the bytes matter.

**The `side label` column — a redundancy removal, and it applies to exactly one build.** The counted
header printed the side to move twice: as a letter in the corner marker (`${T?'a8  W':'h1  B'}`) and
again in the two clock lines below the board (`W: 600s` / `B: 600s`). The corner marker encodes it a
*third* time, since the board flips with the side to move, so `a8` in the top-left already means
"Black is at the top, White to move". Dropping the letter and its two spaces leaves `${T?'a8':'h1'}`:
−6 B plain, −4 B packed, no information lost.

**`~j%8` for `j%8-7`** (−1 B raw, −1 B packed on `prompt_counted`). For integer `j`, `~j` is `-(j+1)`,
so at the end of a rank (`j` ≡ 7 mod 8) `~j` is a multiple of 8 and `~j%8` is `-0` — falsy, exactly
like the original. Verified over all 64 indices. The paired suggestion of writing `j-7` as `j^7` is
free on its own (both are 3 characters) but mirrors the `T?j^56:j^7` a few characters earlier, which
is what actually earns the packed byte.

**1. `J(!U)` → `J(T)` in the `input_*` clock** (−1 B plain; −3 packed on `input_blindfold`, −2 on
`input_counted`). The flag-fall line asked *whose clock is empty*; it can ask *who is to move*
instead, because `T?U--:N--` decrements only the mover's clock, so `U` can reach zero only while `T`
is 1. That one line locks the two facts together and the loop halts on the same tick, so the state
where they disagree never exists. The substitution also replaces a boolean argument with a number,
which is the safer direction: `J` puts its argument through `12+W` and `p%2==w`, both of which
happen to tolerate `true`. The packed gain exceeds the source gain because `input_*` calls `J` from
two places — the clock and the resignation line — and the resignation line already read `J(T)`, so
after the edit `=J(T)?'` occurs twice and becomes a token. The clock call lives inside a
`setInterval` template while the other is bare code; the crusher scans the body as text, so the
repeat spans that boundary without trouble.

**2. `T?j^56:j^7` → `j^T*49+7`** (−2 B plain and packed, both counted builds). See *Orientation*
above: the parenthesised form was compared and found equal, the unparenthesised one was never tried,
and `^` binds looser than `*` and `+`.

**3. Dummy-parameter alignment** (0 B plain; −9 packed on `input_counted`, −6 on `dom`). Giving an
unused or purely local parameter the name an existing repeat already uses lets the crusher extend a
token it has already paid for. On `input_counted`: the render's `_` → `v` (a third `v=>` beside
`f=v=>` and `onkeyup=v=>`), the board map's `(c,j)` → `(p,i)`, and the `replace` callback's `(m,i)`
→ `(p,i)`, aligning with the three `(p,i)=>` the engine already contains. On `dom`: the clock map's
`(e,k)` → `(p,i)` (−2) and the render's `R=_=>` → `R=u=>` (−4), which also closes a global — `u` was
a bare scratch read only inside `R`. Every one of these shadows an engine name (`v` is the attack
test, `c` is castling rights, `p` is the DOM promotion picker, `i` is the driver's input string), and
all are safe for the same reason: shadowing is lexical, so a function defined in the outer scope
still resolves the outer binding when the render calls it, and none of the callback bodies read the
shadowed name. Re-derive this rather than assume it for any new site. The ceiling is real — pushing
further and renaming `c=i=>`, `l=>`, `B=t=>`, `Q=t=>`, `I=w=>` and `X=w=>` all to `u=>` gains 0 B
plain and 0 B packed: past a point the crusher has already cannibalised every repeat there is.

**The one that could not exist: the draw-claim table.** Using `X`'s return value as an index is a
real idea and does beat the cascade by 2 B of source — the first pass rejected tabling this group
because *the conditions are not a single index*, and `X`'s return is one. But it inherits `X`'s
precedence (`n>99` before `G>2` before `o>2`) instead of the driver's (agreement first), so a draw
agreed after the fifty-move counter fills is labelled `50` rather than `DA` — same ½–½, different
mnemonic, and the test standard compares rendered text. More decisively: `X` has exactly one call
site and is therefore inlined in every pipeline, so `X(W)` does not exist there and the object index
has nothing to index. The lever is plain-source-only by construction.

### Tried and abandoned — do not re-attempt

These were tried, measured, and rejected. None beat the current scheme.

- **Alternative board representations — mailbox / 0x88 / 12×10 — much larger.** Off-board tests pay off only inside a search; these engines are hand-written and AI-less, so that payoff never arrives. In raw JS bytes every padded/oversized board came out much larger than the flat-64 char array.
- **An integer board / pieces-as-numbers — no win.** The char string's flexibility (`[...s]` clone, slicing, `>_`/`<u` char compares, `s+T+Y+C` repetition keys) is worth more than any micro difference.
- **Side as `T = ±1` instead of boolean — no win.** The boolean is cheaper; the ±1 direction is recovered where needed via `r = 1-2*W`.
- **Defining piece movement from index-difference vectors instead of `f()` — much larger.**
- **Packing the whole game state into one FEN-like string instead of separate scalars — net loss.** Every downstream field access had to index/parse into the combined value, making those parts longer. Separate one-char globals stay.
- **`s>_` inside the slider `S` (to save 1 byte) — forbidden: it hangs / locks RAM.** (See the headline warning above.)
- **Inlining any *other* helper — measured, all losses.** Folding `S` into `f` won 9 B because **`S` had exactly one external call site** (its second occurrence was its own recursion), so nothing had to be duplicated: the `S=` binding, the `,`, the `f`/`Q` params and the `S(a,b)` argument list all vanished at once. That is the whole criterion — **a helper only shrinks when inlined if it has ONE external caller.** Every other helper is shared, so inlining copies its body to each site and the engine grows. Measured at L5 (all perft-clean, all rejected): `j` (4 calls, inside `Q`) **+32 B**, `O` (4 calls) **+40 B**, `V` (5 calls) **+44 B**, `J` (3 calls) **+53 B**; `f` (2 calls: `L`, `G`) and `L` (2 calls: `J`, `O`) duplicate their bodies as well. Related dead ends: hoisting the twice-repeated own-piece test `p>_&p<u==` into a shared helper is **+12 B** (two repeats is below break-even), the `[s,Y,C,o]` snapshot tuple is written once and read once, and `b=s+T+Y+C` cannot be hoisted because the second use deliberately *recomputes* it after a move. The parameter-defaults-as-free-locals trick is already applied everywhere it pays (`L`, `G`, `M` all carry scratch locals in their param lists; `I` goes further and uses global scratch). One of those declarations has since been dropped: **`y` is no longer declared** in `G`/`L` and simply leaks to an implicit global (−4 B; −2 B at L0, where only `G` survives), which is safe because nothing else writes `y` while `G`/`L` are on the stack. `D` cannot follow it — see *Tried but not preferred* for why.
- **`<body bgcolor=ccc>` (dropping the `#`, −1 B) — renders BLACK. Reverted; keep the `#`.** The legacy-colour rules *suggest* bare `ccc` should zero-pad to `#c0c0c0`, and reasoning from the spec that is exactly what you predict. **A real browser renders it black.** The `#` is load-bearing. This one is in the list because it was applied on a spec argument and only caught when the page was actually looked at — **render it, don't derive it.**
- **Dropping `</p>` (DOM) or `</pre>` (input) — breaks both UIs. Repeatedly re-proposed; the answer is no.** The bodies look over-closed next to the deliberately unclosed tags around them, so these two closers read as free bytes. **They are not — each keeps a render target from swallowing the rest of the page**, and the renders write with `innerHTML`, which deletes the target's children. Without `</pre>`, `<input id=X>` becomes a **child of `<pre id=t>`** and `D()` wipes the box on the first render — dead on arrival. Without `</p>`, the **`<table>` nests inside `<p id=W>`** (no implied `</p>` is generated before `<table>` — it is valid flow content inside `<p>`), and `D()` writes the clock with `W.innerHTML=…` every frame, so **the board is destroyed on the first render.** The testing lesson: parsing the emitted markup as a *fresh document* normalises the nesting and both variants look identical — reproduce with `document.open(); document.write(html); document.close()` and assert `#W.contains(table) === false`.
- **The promo panel sits ABOVE the board, and it must close every tag.** The buttons render between the status line and the clock, so a promotion choice appears where you are already looking instead of below the board. That position removes an old optimisation: while the panel was the LAST thing in the document, builds with no draw controls could drop both `</button>` and `</b>` and let EOF close them (−9 B). Above the board there is no EOF to lean on — an unclosed `<b id=p hidden>` swallows the **table**, so the board inherits `hidden` and the engine renders a blank page. This is invisible to `new Function(engine)` (the script is valid either way); only an actual HTML parser sees it. Test it with one: build each dom config, parse it, and assert the `<table>` is **not** a descendant of `#p` and that `#o0` has no `hidden` ancestor. When the panel first moved, the old open-tag branch broke 12 configs (every L1–L4 counted and L1/L2 strict) exactly this way.
- **Dropping `</button>` in the promo panel (−9 B) — three separate breakages.** The parser rule is real (a `<button>` cannot nest, so the next one becomes a sibling), but the promo buttons are followed by **`</b>`**, and there the parser cannot close the still-open `<button>` — it closes and **re-opens `<b id=p>`** instead. Result: (1) a **duplicate `id=p`**, so `getElementById('p')` returns a `<b>` holding only ♕♖♗; (2) `p.hidden` no longer covers the ♘ button, which stays **visible during normal play**; (3) the ½ draw control is swallowed *inside* the ♘ button, so clicking it fires `onclick=K("n")` — **the player trying to offer a draw promotes to a knight instead.** (That last one is now structurally impossible — the draw control lives in the footer below the board while the panel is above it — but the first two still apply, and the whole hazard is moot anyway since the panel's position forces the closing tags.)
- **Re-lettering the pieces to shrink the comparisons (−5 B max — exhaustively searched, then rejected).** The piece alphabet looks free, so the tempting question is whether a cleverer choice collapses the rule tests. It doesn't, and the ceiling is provable. **First, the alphabet is not free: it is locked to ASCII case-pairs.** The colour test `p<u` (3 B) forces White and Black into two *separated* code blocks, so the fold from Black to White is "subtract a constant" — and the only cheap string operation that does that is `.toUpperCase()`, which needs genuine case pairs. (Skipping the fold and making `f`'s tests colour-blind is *impossible*: the diagonal test would need a threshold `X` with `X > max(B,Q)+32` and `X <= R`, but with all six letters in `A`–`Z` that demands `X > 97` while `R <= 90`.) **Second, the letters themselves cost nothing:** a char literal `'X'` is 3 B whichever letter it is. So the *only* lever is turning an equality (`P=='N'`, 6 B) into a range test (`P<'N'`, 5 B), which requires that piece to be extremal at that point in the chain. Brute-forcing all 720 orderings against the real test chains in `f`, `I`, `G` and `M` gives a **unique optimum, `B<N<Q<R<P<K`** (letters `A`–`F`), worth exactly **5 B** — verified end to end: perft 20/400/8902/197281, and identical legal-move sets, boards, ep, castling rights and 50-move counters across **31,831 plies of 400 random games**. Rejected: 5 B is not worth a board that reads `dbacfabd` and a promotion input of `e7e8d`. *(Perft earned its keep here: the first attempt missed the third `P=='K'` — the one in `G` — and castling silently stopped generating, 25 moves → 23, while the byte count looked right.)* **This item is about the *char* alphabet** — re-lettering while the board still holds characters. Replacing the characters with **numbers** is the separate, larger, and *accepted* win documented in the numeric-bitfield section; the analogous "does a cleverer number layout collapse the tests" question was brute-forced there too and also lands on the current ordering (`2*folded+colour`), for the same range-test-contiguity reason.
- **Making the empty square falsy so occupancy is truthiness (would be ~22 B — provably unreachable).** Eleven tests (`p>_`, `g==_`, `s[a]==_`, `s[r+i]>_`, `g+s[…]==_+_`, …) would each shed 2–3 B if `_` were falsy and occupancy were just `p`. Three independent blockers, and the third is fatal: (1) with `_=''` the board initialiser collapses — `''.repeat(32)` contributes nothing and `s` comes out 32 long, not 64; (2) `0 == ''` is **true**, so the en-passant test `i==Y` would let a pawn "capture" onto an empty **a8** (square 0). `undefined` fixes both — `0 == undefined` is false, and `[...Array(32)]` gives real falsy slots — but (3) **the render kills it**: the text board relies on every square being *exactly one character* (`.replace(/.{16}/g, …)` = 8 squares per row), so a zero-width empty shatters the rows (the split is `/.{8}/` since the hex render; it was `/.{16}/` in the two-digit era, but the argument is unchanged), and the DOM render calls `V()` on **every** square including empties, where `undefined.toUpperCase()` throws. `_` must be a real, displayable, one-character value that survives `.toUpperCase()`. `'-'` already is.
- **Opening out `I`'s verdict `!m & F*2+a<3` into separate clauses — it doesn't decompose.** The threshold looks like three ideas crammed together, and the obvious expansion is `!m & a<3 & a*F<1` (no heavy piece / no opposite-coloured bishops / no bishop-and-knight). It is **wrong**: `a*F<1` is satisfied by `F=2, a=0`, so **two knights slip through** as "insufficient". Restoring them needs `F<2` as a fourth clause, and `!m & a<3 & F<2 & a*F<1` is longer than what it replaces. `F*2+a<3` is doing all four jobs in one comparison — the knight count is *weighted* precisely so that two knights (4) clear the bar that one knight plus a bishop (3) also clears. Leave it alone.
- **Folding the pawn test into `I` (Armageddon-USCF, +2 B).** 14E3 needs "does Black have a pawn?", and `I` already walks all 64 squares — so hoisting the test into that loop looks free. It isn't: `I`'s scan is gated on `p<u` (White only), so catching a *Black* pawn means widening the filter and adding a branch inside the map (+12 B), against the 13 B of `!/p/.test(s)` it deletes, minus the extra global. A separate one-character regex over the board string is cheaper than a branch in a loop that is already tightly gated.
- **A "dual" `I` that tallies both sides in one pass (Armageddon-FIDE, +3 B).** `armIM` calls `I` twice — `I(0)` for Black's bishop mask, then `I(1)` for White's material — so folding both tallies into a single pass looks like a clear win. It isn't: the dual `I` has to carry a second branch inside `s.map` (+19 B), and because it can no longer return a *verdict* (whose side would it be?), the threshold has to be re-written by hand at the call site (+14 B). Two plain calls to a lean `I` cost less than one clever call to a fat one.
- **Routing 960 castling through the generic make-then-`J(W)` filter (+59 B per 960 engine).** The clean fix for the b-file discovered check, but it costs ~59 B and *still* needs the `!O` transit tests kept alongside it (a bare `J` only checks the king's final square). The targeted a1-slider guard is +26 B, covers the sole gap, and applies to only the affected skeletons.

- **`&&` -> `&` in the ep-target line and in `I`'s verdict (-2 B / -1 B) — both break, for different reasons.** The ep line is `Y=Z&D>9&&(Y=f+Q>>1,[Q-1,Q+1].some(q=>s[q]==9-W&&G(q)[u](Y)))?Y:-1`, and the tempting read is that both operands are already 0/1 so the bitwise form is equivalent. Two things go wrong. **The outer `&&` is load-bearing as a guard, not as a boolean**: with `&`, the right side runs unconditionally, so `Y=f+Q>>1` fires even when the piece is not a two-square-pushing pawn — measured 44 divergences in under a thousand plies, with `Y` left at a real square where it should read `-1`, i.e. a phantom ep target that makes an illegal capture look legal on the next ply. **The inner `&&` is load-bearing for cost**: `G(q)` is full legal-move generation, and short-circuiting it behind "is this square an enemy pawn" is what keeps it off the hot path. Forcing both neighbours through `G()` on every move measured **1 ms -> 69 ms per 300 `M()` calls, a 69x slowdown** — the first attempt to test it simply timed out. Separately, `I`'s verdict `(F&j(4)|a)&&!(E&~a)` fails on the *value* argument the proposal rests on: the right side is indeed 0/1, but **the left side is a bitfield**, not a flag — `a` carries bishop-square parity and can be 2, 4 or 8, and `2&1` is `0`. So `&` silently reports "cannot mate" where `&&` reported "can", turning live positions into insufficient-material draws. Measured: `Q()` returned `0/0` instead of `1/0` at L5 across std, Armageddon and 960. **The rule this leaves: `&&` in this codebase is never decorative — check whether it is guarding a side effect, a cost, or a non-boolean left operand before touching it.**
- **`D<2&H<2` -> `D|H<2` for the king (-2 B) — precedence inverts it; the corrected form saves nothing.** The arithmetic claim is sound: for non-negative integers, `(D|H)<2` is exactly `D<2 & H<2`, verified over all 64 pairs. But `<` binds *tighter* than `|`, so `D|H<2` parses as `D|(H<2)` — a different expression that disagrees on **54 of 64** pairs, and in the permissive direction: `D=1,H=2` yields `1|false` = `1`, letting the king move two ranks. Written correctly as `(D|H)<2` it is **7 B**, exactly the length of `D<2&H<2`. No win either way.
- **Initialising `E` in the numeric chain, `z=o=e=0,E=''` -> `z=o=e=E=0` (-3 B) — corrupts the blindfold status line.** `E` looks like idle scratch, but in **blindfold** it holds the opponent's last move as text (`E=i` after a successful move, printed as the tail of `` `W${U} ${T} B${N} ${E}` ``). With no board on screen that string is the player's *only* information channel, and `E=''` is what makes the pre-first-move display end cleanly. Seeding it to `0` prints a bare `0` there on move one (verified in a driven game), and since `Q()` also assigns `E=a` mid-game the field would alternate between a bitfield digit and a move string. The initialiser also exists in only **6 of 108** configs (blindfold x three interfaces x two notations), so the 3 B is both narrow and destructive.
- **`4-3*W` -> `4>>W*2` for the king-side castle mask (-1 B claimed) — it is +1 B.** The shift arithmetic is correct (`W=0` -> 4, `W=1` -> 1, and it holds for boolean `W` too) and precedence needs no parentheses, but `4>>W*2` is **6 B** against `4-3*W`'s **5 B**. Measured equal across 38400 `G()` calls, and longer.
- **`!D&!g&!s[d+r*8]` -> `!(D|g|s[d+r*8])` for the two-square pawn push (-1 B claimed) — 0 B.** Both forms are 15 B; the `&`-chain trades its two `!`s for the parentheses the OR-fold needs. Logic is equivalent (verified over the full value space including `undefined`), so this is simply a wash. Note the current `&`-chain is itself the result of the *opposite* fold, `!D&!(g|s[d+r*8])` (16 B) -> `!D&!g&!s[d+r*8]` (15 B), which did win a byte — the third variant just lands back on the same count.

### Tried but not preferred — works, rejected on quality grounds

These *would* save bytes and are correct, but degrade the engine's quality.

- **Dropping `D` from `G`/`L`'s parameter lists as well as `y` (−4 B more per engine) — `y` applied, `D` rejected.** `G` and `L` carry `y` and `D` as trailing parameters purely to get free locals (the parameter-defaults-as-locals trick), and neither is ever read by the caller — so deleting both from the signatures looks like a clean −8 B, letting the bodies' `D=A(…)` and `y=…` writes fall through to implicit globals. **`y` is safe and is applied** (−4 B; −2 B at L0, where `L` is gone and only `G` remains): its only other writer is the DOM render's `y=s[i]`, which never runs while `G`/`L` are on the stack. **`D` is not**, and the failure is severe rather than subtle: **the `input` and `dom` drivers already bind `D` as the render function** (`D=_=>t.innerHTML=…` / `D=()=>{…}`), so the first `G()` call overwrites it with a number and the next `D()` throws `TypeError: D is not a function` — the board stops redrawing, the clock stops ticking, and clicks do nothing. `prompt` is the only driver with no render `D`, which is exactly why the bug hides from prompt-only testing. Note the trap: it is *not* possible to "delete only the move-side `D` and keep the render one" — while `D` is in the signature the body's `D=A(…)` binds to the local; removing the declaration is what merges the two into a single global. Renaming the render function would work, but **at L5 there is no free letter** to move it to (all 52 single letters are live in at least one L5 config); free letters only appear at L4 and below (`n` at L4; `n`,`F`,`I` at L3; nine at L2; sixteen at L0), so this would become a second per-config letter-allocation scheme like `inclHoist`'s, spending L4's *only* free letter for 2 B. Kept `D` declared. *(Regression guard: any change touching a core scratch name must be exercised through the **DOM and input drivers**, not just `G`/`M`-level or prompt harnesses — a real click has to move a piece and leave `typeof D === "function"`.)*

- **Dropping the DOM driver's opening paint (−4 B) — applied on Number DOM at clocked levels only (L3+/Armageddon); kept everywhere else.** The exact analogue of the input rule above, on the other interface. The DOM driver ends `…(k=c,D());D();setInterval("z||(…,D())",1E3)`, and the three `D()`s are three different things: the first is **inside** `H`'s click handler (per-click render, must stay), the third is inside the tick string, and the **middle standalone statement is the opening paint** — one call at load to draw the initial position. Dropping it leaves the board unpainted until the tick fires, which on a clocked engine is ~1 s. Gated identically (`/setInterval\(/` must be present, so L2−, which has no tick, keeps its paint and is never left blank forever), Number-only, and anchored on `;D();setInterval` so it cannot match either of the other two calls. **512 configs, −4 B each**, verified by executing one tick in each and asserting the board is populated afterwards.

  **This degrades further than the input version, and that is accepted rather than overlooked.** Input's `D()` rewrites a `<pre>`'s text, so a missed opening paint shows an empty text block. The DOM `D()` also *builds* the squares — `document.write` emits the `<th>` cells empty and uncoloured, and `D()` is what fills `innerHTML`, `bgColor` and the piece colours. So for that ~1 s the player sees a **blank uncoloured grid rather than a chessboard**, not merely a board missing its pieces. The position is never *wrong*, only late, and the Number axis is the one that trades interface polish for bytes — but if a future change makes the first paint reachable more cheaply, this is the rule to revisit first.

- **Dropping the input driver's trailing `D()` (−4 B) — applied on Number input at clocked levels only (L3+/Armageddon); kept everywhere else.** The driver ends `…,D()),D()`, and the second call is *not* a redundant repaint: operator precedence parses the assignment as `onkeyup=(v=>…,D()) , D()`, so the trailing call sits **outside** the arrow body and runs exactly once — it is the engine's **opening paint** at load. Measured: on load the original writes the board once; with the tail dropped, load writes nothing. What that costs depends on whether the level has a clock. **With a clock (L3+/Armageddon)** the `setInterval` tick calls `D()` every second, so the board appears within ~1 s — a startup delay, not a broken game. That is an acceptable trade on the **Number** axis, which already spends interface polish for bytes (raw 0-63 indices, `M` without `=`, no echo brackets), so it is applied there: **192 configs, −4 B each**, perft 20/400/8902/197281 unchanged. **Below L3 there is no `setInterval` at all**, so the same edit leaves the board blank *permanently* — the player would have to type a first move sight-unseen, which is unplayable rather than merely terse; those levels keep the opening paint. The rewrite is gated on the tick's presence in the emitted script, and **Letter keeps the opening paint at every level** (its axis buys readability, not bytes).
- **`arr.includes(v)` → `arr[X](v)` method-reference hoist (−5 B per L5 engine) — applied.** Every L5 engine calls `.includes(` exactly three times (`G(k).includes` legality, `s.includes` in `Q`'s material scan, `G(q).includes` in the EP guard). Binding the method name once to a free one-letter global (`X='includes',`, +13 B) and rewriting each call to `arr[X](v)` (−6 B each, −18 B total) nets **−5 B**. It is **min-selected to L5 only**: L4 has two calls (net +1 B), L3–L0 have one (+7 B), so the hoist is skipped below L5. Runtime-identical — bracket-notation method access is standard JS; **perft 20/400/8902/197281 verified on all six hoisted variants** (every UI × notation), so move-gen, castling, EP and promotion are untouched. The one-letter name is **allocated per config from a measured free-letter map**, because which letters are free depends on the axes: **Number** frees `u`/`V` (the colour token and `toUpperCase` never appear once the board is numeric), so **Number uses `u` everywhere**; **Letter input** uses `x` (the text box is `id=X`, lower-`x` is free), **Letter prompt** uses `h` (history exists only in dom/input strict), **Letter dom counted** uses `t`, **Letter dom strict without cooldown** uses `n` (strict takes `h`/`t`/`B`, but `n` is free when no draw-cooldown). The cooldown is detected in the script via its `n[+T]`/`n[+W]` ticks; a bot is excluded (the reservoir also wants `n`). **The one gap: Letter dom strict *with* cooldown has no free one-letter name** — strict occupies `h`/`t`/`B` and the cooldown occupies `n`, leaving nothing. A **two-letter** name would still work but only nets **−1 B** there (the extra call-site char eats 4 of the 5), so that single config is **not preferred and skipped** — it keeps its plain `.includes`. (Number never hits this gap: `u` is free even under strict+cooldown.)
- **`v.which` instead of `v.keyCode` (−2 B) — applied (Letter input; Number input already drops the whole guard).** *Both* `KeyboardEvent.which` and `KeyboardEvent.keyCode` are deprecated (the modern spelling is `v.key === 'Enter'` / `v.code`), and both still return the same `13` for Enter on every browser — so this is **not** a "deprecated vs modern" trade, it is two equally-deprecated names where the shorter wins. Crucially it is also **not** an interface-quality regression like the trailing-`D()` / `throw z` items below (nor a broken-outright one like `X.onchange`): the Enter test `v.which-13` behaves **byte-for-byte identically** to `v.keyCode-13` (verified — Enter commits, any other key waits), so the player feels nothing. Given the engine already leans on high-tier deprecated HTML throughout (`<center>`, `<font>`, `bgcolor`, string-`setInterval`), keeping the *longer* deprecated spelling for a phantom "modernity" was inconsistent; `which` is used. *(The modern non-deprecated form `v.key==='Enter'` is longer than either, so it loses on bytes.)*
- **`X.onchange=_=>…` instead of the global `onkeyup=v=>v.which-13||…` (−9 B, input only) — tried on a built engine and it does not work at all.** Binding the handler to the box itself makes the Enter test and the `v` parameter redundant, which is a real byte win (measured 27 B → 18 B; the README previously claimed ≈−11 B and also listed `prompt` as affected — wrong on both counts, `prompt` has no `X` box and no `onkeyup`, it loops on `prompt()`). The reason it fails is structural rather than a matter of feel. The driver's first act is `i=X.value.toLowerCase(X.value='')` — it reads the value and **blanks the box in the same expression**. That is harmless under `onkeyup`, where the event has already fired. Under `change` it is fatal: the event only fires when the element's value differs from its **last committed value**, and the programmatic `X.value=''` neither fires `change` nor reliably updates that baseline. The first move may commit; after that the handler goes silent and **the field stops accepting moves entirely** (verified on a built engine — typing a move and pressing Enter does nothing). So this is not the "worse feel" trade the other rejected items describe: `onchange` and a self-clearing box are simply incompatible. Making it work would mean dropping the `X.value=''` clear and finding another way to avoid re-reading a stale move, which costs more than the 9 bytes it saves. Kept the global `onkeyup` Enter-gate. *(`X.oninput` is one byte shorter still, but it fires on every keystroke — the same mid-typing commit problem that got the Number Enter-gate reverted below.)*
- **Splitting the start-position string and rebuilding the white half with `V` (0 B on the folded path, −1 B otherwise).** The board is colour-symmetric, so with `a='rnbqkbnr', b='pppppppp'` the whole thing is `a+b+E+V(b+a)` — the white half is just the **block-swapped** black half, uppercased (the pawn row moves in front of the back rank). It works, and `V('-')==='-'` even lets the empty run live inside the call (`a+b+V(E+b+a)`), but **measured it is exactly byte-neutral on the folded path**: inside a template literal the board characters need **no quotes**, and pulling them out into `'…'` variables costs +19 B (4 quotes, 2 names, 2 commas, `a+b`, `V(b+a)`) against the 16 B of white half it deletes. Only on the **non-folded** path — where the board is already a quoted concat — does it net −1 B. Winning would mean deleting one of the two variables, and you can't: recovering the block swap from a single string costs 26 B (`t.slice(8)+t.slice(0,8)`) or 32 B (regex), both worse than the 19 B they'd replace. **And it is mutually exclusive with the board-literal fold, which is worth −3 B** — so on every engine that can fold, the fold wins and this is dead. Not worth two extra live ranges (`a`, `b`) for the variable-merge guards to reason about. **Note:** a *different* form of this idea does pay on the packed path — `rpVPadBoard` keeps `padEnd` and rebuilds only the white half via `V()`, joining the existing `toUpperCase()` token family; it wins 37 of 112 configs. See *The RegPacked download*.
- **`top['o'+i]` instead of `self['o'+i]` in the DOM render (−1 B).** `top` is one character shorter than `self` and, in a standalone tab, resolves to the same window — the render is byte-for-byte identical and every DOM variant works. Rejected because the emitted engines are **portable files handed to non-technical users**: the moment one is opened inside an `<iframe>` — a preview pane, an embed, a docs page, anyone dropping the file into a site — `top` no longer means *this* window but the **parent** document, where the engine's `o0`…`o63` cell globals do not exist (so the board renders blank), and if the parent is cross-origin the access **throws `SecurityError`** and the engine dies outright. `self` always means the engine's own window, embedded or not. One byte is not worth converting "paste this file anywhere" into a technical footgun the user has no way to diagnose. Kept as `self`.
- **Sharing `B+T` via a temp in the period hook.** The alias only nets a gain when `B+T` appears 5+ times (a three-period per-period Fischer/Bronstein engine), and no single-letter variable is free in every one of those configs — so no generic-safe temp exists.
- **`with(self['o'+i]){…}` around the DOM render body (−3 B).** Drops the five `q.` prefixes by putting the cell in scope. Works: the emitted engine is sloppy-mode (no `"use strict"`, plain `<script>`), so `with` is legal, and none of the render's read names (`i y s u V k l T z`) collides with an `HTMLTableCellElement` property, so they still resolve to the engine globals while `style`/`innerHTML`/`bgColor` hit the cell — verified byte-identical render across every DOM variant (rot on/off, all levels). Rejected on quality: `with` is strongly discouraged and turns the render into a minefield — any *future* bare name that happens to match a DOM property (`align`, `ch`, `scope`, `width`, `height`, `id`, `title`, `hidden`, `dir`, `slot`, …) would silently resolve to the element instead of a variable; it also breaks the moment the engine is ever loaded strict/as a module, and forces a RegPack re-measure. The `q.` prefixes are cheap insurance against bare-name capture. Kept explicit.
- **Dropping the Enter-gate in the Number text field (`onkeyup=v=>v.which-13||…` → `onkeyup=_=>…`, ≈−12 B, Number input only).** Number moves are a fixed digit block (`5236`, or `5236`+promotion digit), so it is tempting to re-parse on **every keystroke** and drop both the Enter test and the `v` parameter — the reasoning being that a Number move is pasted whole, landing as one event. It works and saves the bytes, but it is a genuine **interface-quality regression** (unlike `X.onchange` above, which does not work at all), in a sharper form than the trailing-`D()` item: typing the move digit-by-digit, a *partial* string is re-parsed as you go, so a valid move can **commit before you finish the last digit** (e.g. after `523` the field may already describe a legal move and fire). Nothing corrupts — an illegal partial is rejected by `G()` — but a field that commits mid-typing feels broken to a human. This was briefly applied (with a "Number is the paste-and-play axis" rationalisation) and **reverted**: the Number field now keeps the Enter-gate and behaves exactly like Letter (`v.which-13||`), so typing-then-Enter and pasting-then-Enter both work. This fails the same "playable game for a non-technical user" bar as the trailing-`D()` / `throw z` items. Kept the Enter-gate. *(The `.toLowerCase()` drop, the K-inline, and the other genuine Number-input wins are unaffected — only the keystroke-commit change was reverted.)*
- **`throw z` instead of `alert(z)` at the end of the prompt driver (−1 B).** The `prompt` loop ends `while(!z)…;alert(z)`, and `alert(z)` (8 B) is the *only* thing that surfaces the game result to the player. `throw z` (7 B) is one byte shorter and, post-loop, syntactically fine — but it changes the outcome from a **visible popup** to an **uncaught exception that only prints to the dev console** (`Uncaught 14`). A normal player never opens the console, so the game would appear to end **silently** with no result shown. This is a functional regression, not a golf trick — it trades away the engine's result display for a byte, so it fails the same "playable game for a non-technical user" bar as the trailing-`D()` and `onkeyup` items above. (It is also `alert`-specific: only the `prompt` UI ends in `alert(z)`; `input`/`dom` render the result into the page.) Kept `alert(z)`.
- **Dropping the emitted engine's closing `</script>` (−9 B).** Every emitted file ends `…</script>` with nothing after it, and because the `<script>` is the document's last element, a browser auto-closes it at EOF — so the tag can be removed and a standalone file still parses and plays (verified: parses, board correct, full game runs to an `alert`). Rejected on the same portability grounds as `self` vs `top`: the emitted engines are **files handed to non-technical users and pasted anywhere**. Without the closing tag the engine is only safe as the *last thing* in a document; the moment it is embedded (a page, a docs block, an editor that appends anything after it) the missing `</script>` **swallows all following content into the script**, breaking both the engine and the host. The 9 B is a robustness trade, not a free win — the closing tag keeps "paste this file anywhere" true. Kept `</script>`. *(If a plain-download-only variant is ever wanted, this could be applied to that path alone, leaving the RegPack and embed paths intact — but it is off by default.)*

---

## Build history — how it actually went

Kept because the order things were discovered in explains why the code is shaped the way it is, and
because most of these bugs are the kind that come back. It is a record, not a specification.

**Order of construction.** The first version was a single variant, worked on for a long time before
the variant count grew and the options axis appeared. Chronology turned out to matter: the natural
build order runs from the primitive core up through the levels, and within a game from its opening
to its end — the ideal sequence follows either the level ladder or the order in which rules come
into play during a game, and deviating from it produced work that had to be redone. The Making tab
was far more fragmented at first, with `T`, `M`, `P` and `D` as separate pieces. Progress after that
was modular. The human-facing pieces (resign, draw offer) came last, and the live clock after them.

**Things that turned out to be traps.**

- **The rook's — and therefore the queen's — malformed movement**, caught by the tester rather than
  by reading the code.
- **`G[0]`, fixed with a `+1`.** Index 0 (the a8 corner) was not treated as a legal move, so
  positions there were scored as mate or stalemate that were neither.
- **`!=_` cannot become `>_` in the slider path.** Sliders (queen, bishop, rook) ran off the board,
  the scan never terminated, and memory went with it. This is the origin of the exception recorded
  under *Two golf rules* above; `!=_` is deliberate in a few places and should be left alone.
- **The ghost queen.** An empty square could be moved as though it were a queen, and the move could
  capture your own piece.
- **Castling through a captured rook.** Early on, if the opponent took an unmoved rook with a knight
  or bishop, castling was still permitted and the capturing piece passed over the king.
- **Chess960 castling via the a/h file.** Byte savings had been taken by dropping checks, so any
  a/h-file target — including squares outside the first and eighth ranks — read as a castle, and a
  rook that did not exist was synthesised and castled with.
- **Cancel protection.** Adding it made the alerts misbehave on tab switches, which is why it exists
  as a narrow, level-gated option rather than a global guard.
- **The clock froze**, which is not FIDE-legal, and drove the move to the input interface.

**The hardest part was flag-fall versus material (`TM`/`RM`)**, because there is no consensus to copy
from anywhere. The rule was derived by eliminating positions by hand, and it was corrected repeatedly:
at one point `K+Q` (flag fallen) against a lone king was scored a draw while `K+2Q` against a lone
king was not, and multi-piece cases were wrong generally. Because perft measures move generation and
says nothing about how a game ends, every ending had to be tested by hand — which is why *Building &
testing* below asks for driven games rather than counts alone.

**Deliberately not built: locked-position (dead-position) detection.** It belongs with insufficient
material conceptually, but the cost is memory rather than bytes, and that is the wrong trade for an
engine whose whole premise is that it fits in a couple of kilobytes.

---

## Building & testing

The whole project is `index.html`; there is no separate engine source file. To test an engine headlessly, extract `build()` from the `#builder` script and run it in Node:

```js
const fs = require("fs"), vm = require("vm");
const H  = fs.readFileSync("index.html","utf8");
const s0 = H.indexOf(">", H.indexOf('<script id="builder">')) + 1;
const mk = "/* ===================== UI wiring ===================== */";
const build = new Function(H.slice(s0, H.indexOf(mk, s0)) + "\nreturn build;")();

const o  = {ui:"input", info:"counted", time:"fischer", inc:5, rot:false,
            rules:"std", arr:"RNBQKBNR", periods:[], wt:600, bt:600, drawEvery:1,
            fed:"fide", chesseus:"L5", rep:1};   // chesseus: "L5" | "Armageddon" | "L4"…"L0"
const engine = build(o).match(/<script>([\s\S]*)<\/script>/)[1];
```

Then run the engine in a `vm` context with stubs (`Date`, `Math`, `console`, `setInterval:()=>0`, `alert:()=>{}`, `self/window/globalThis = ctx`, the text-UI elements `t` (display) and `X` (the input box), and for `dom`: `document.write`, cells `o0…o63`, the clock/meta elements `W`/`v`/`d` (formerly `d0`/`d1`/`d2` — renamed to the free single letters `W`/`v`/`d`), `x` (the ½ checkbox), `p`/`h`). Override `ctx.s/C/T/Y/z/o` to set a position, then drive moves (input: set `X.value` and fire `onkeyup`; dom: click-pair via `H(from); H(to)`, confirming promotions with `K('q')`; prompt: feed a queued `prompt` stub). Note `u` is the colour-threshold variable, not an element, and `B` is the ply counter (`mc` never appears in an engine).

**What to verify:**

- **Byte deltas on the whole engine, not a snippet.** UTF-8 glyphs (clock/flag symbols) are one character but three bytes — the Generator's displayed size differs from the downloaded file size. Measure with `Buffer.byteLength(s,"utf8")`. **Download prepends a UTF-8 BOM** (`\uFEFF`, 3 bytes) to the saved file, so a downloaded engine is 3 bytes larger than `build()`'s output; compare like with like.
- **Differential**: diff old vs new `build()` output across an option matrix. A 960-only change **must leave the standard path byte-identical**, and vice-versa; likewise a USCF change **must leave the `fed:'fide'` output byte-identical**. For USCF, also drive the **flag-fall material matrix** (`K` vs `K` → `TM`; lone-minor; `K+2N` vs lone king → draw, vs king-with-pawn → win; both flag directions) and confirm the `5R`/`75`/`RM` codes never fire while `3R`/`50` claims still do.
- **The `Q` helpmate matrix (FIDE).** `Q` is the *only* exact rule in the project that depends on two sides' material at once, and its bishop branch is easy to get wrong. Drive **both directions** (`Q(0)` and `Q(1)`) over a material matrix and check each against a golf-free reference: bare king → always a draw; lone knight → draw unless the opponent has something other than a queen; same-coloured bishops → draw unless the opponent has a knight, a pawn, **or an opposite-coloured bishop**; two knights, `B+N`, opposite-coloured bishops, and any Q/R/P → not a draw. The opposite-coloured-bishop case is the one a naive `| !!a` misses — the reference mate is Black `Ka8, Bb8` vs White `Kb6, Bc6`.
- **Armageddon.** Confirm the **residue scan** finds no claim/offer leftovers (no `e` bitmask, `e^=`, `'DA'`, `Cl`, `n[+W]`, `/=$/`, `'D?'`, the DOM `½` radio or `id=x`) while the **⚐ resign button survives** in the DOM — Armageddon is the first level where `noRes` and `noDraw` disagree, so a shared `drawCtrl` string will silently take the resign button with it. Confirm `drawEvery:1` and `drawEvery:3` are byte-identical (the cooldown is inert). Drive the `armIM` matrix in **both rule sets** — they deliberately differ (see the table above) — and check the score suffix renders on every code (`50->BA`, `W#->WA`, and `⟹` in the DOM only). Confirm `'TM'`, `'RM'`, `'5R'`, `'75'`, `I(2)` and `v>1` are all absent.
- **Per-side axes: the symmetric path must not move.** Every asymmetry (`binc`, `p.badd`, `p.binc`, `bdrawEvery`, `drawState`) has a null form — field absent, or equal to White's — and in that form the emitted engine must be **byte-identical** to the pre-feature output. This is the headline invariant for all of them; a 4032-config sweep over level × UI × notation × info × clock model × period shape × draw limit × bot covers it. Use a **snapshot of the pre-change file** as the reference — two harnesses reading the *same* `index.html` will happily report "no differences" while both sit on the new code.
- **Run the matrix, don't just parse it.** A missing runtime binding is syntactically valid, so `new Function(src)` passes and the bug ships. The prompt+strict `Z` failure survived every parse sweep and only appeared when 49152 configs were actually **executed** in a `vm` (and jsdom for DOM). Execute a few plies, including a `=` draw input, not just the state line.
- **Cross-axis residue.** For each level, scan for constructs that level is supposed to have removed — at Armageddon and L4/L3 that means no `n[+W]`, no `,e=1,`, no `e^=`, no `'DA'`. Do it *after* adding any feature that touches `e` or `n`, because a new field can reintroduce state the level strips.
- **The `n` collision.** `n` is either the draw cooldown's two-slot array or the bot's reservoir counter, never both. Assert that no engine contains `n[+W]`/`n[+T]` **and** `n=0,s.map(` — and that `bot:"R"` never emits a cooldown at all.
- **Semantic spot-checks, with the right stub.** Byte counts and parses say nothing about whether White actually got 5 and Black 3. Drive a few plies and read `U`/`N`. Watch the stub: with `setInterval:()=>0` the Bronstein accumulator `c` never advances, so Bronstein credits `min(0,cap)=0` and looks broken — set `ctx.c` by hand before each move to test its cap.
- **The highlighter's two hard invariants.** (1) **Lossless.** Strip every `<span>` from `highlight()`'s output and you must get the source back, **byte for byte, on every config** — the panel is copyable, so a dropped character is a dropped line of code, not just a dropped colour. (An earlier build failed this on 1728 of 2752 configs: the `setInterval` rule jumped past the tick's closing quote without emitting the `,D())` it jumped over.) (2) **Solid tags.** Independently parse `document.write`'s template, track when an HTML tag is open, and require *every* character seen while open — literal text, `${` `}` delimiters, and hole contents — to be `.tag`. One stray non-tag character inside an open tag and the tag renders mottled.
- **RegPack is not a rubber stamp — measure through it.** Every Number golf so far survives packing and keeps its full gain (hex, the `'126'` promotion map, the short-circuit status slot, and `.join```: the packed output shrinks by the same bytes as the plain one, and no config grows). But RegPack is a greedy tokeniser, so a change that shortens a *repeated* string can shift which repeats it picks and cost back more than it saved. Pack the whole matrix through `regpackCompressF(form, g, l, c, RP_KEEP)` over `RP_FACTORS` with the parse guard, and compare **packed** deltas, not just plain ones. `RP_KEEP` is mandatory: without it RegPack reassigns names the emitted markup depends on and the packed engine dies at load with `n is not defined` / `u is not defined`.
- **The Number render is hex, and only Number.** Every text-interface Number board prints **one hex digit per square**, so a rank is 8 characters and the grid split is `/.{8}/`. After any change here, check all four row shapes — labelled (input/counted), bare (input/strict), and the two prompt shapes — plus **both rotations**, and confirm no `/.{16}/` survives anywhere in a Number engine. **The prompt board carries no clock any more**: both clocks moved into the header (`00 1 0 M0 R1 W600 B600`), which leaves the board a pure 8×8 hex block with no per-row logic in either rotation — one `.replace(/.{8}/g,m=>m+`\n`)` for both. That is what makes it cheaper: unrotated it drops the row-aware callback (`(m,i)=>m+(i?'':` B${N}`)+`\n``) and rotated it drops the whole three-way separator ternary that used to ride the per-cell map, which is why rotation saves about twice as much (measured **−17 B** unrotated, **−33 B** rotated). Two consequences to keep in mind: `/.{8}/g` matches the last rank too, so the board ends with a newline and the dialog shows **one blank line** under it (restoring `(?!$)` removes it for +4 B, deliberately not done); and the Letter build still clips its clocks onto board rows, so **Letter must stay byte-identical** — it keeps `s.join(' ')`, its own `/.{16}/`, and its `B: …`/`W: …` row labels.
- **The two Number encodings must not be conflated.** Squares are typed in **decimal, two digits** (`5236`); pieces are printed in **hex, one digit** (`4c26a2c4`). A test that types a board code, or a doc that says "type `c` for a knight", is wrong. The promotion suffix is a **third** numbering: a menu index (`0`/`1`/`2`) into `'126'`, whose contents are the internal piece codes (1/2/6), which are neither of the other two. An out-of-range index yields `undefined` and lands on `M`'s `p=3` default (queen) — there is no `||3` at the call site any more, so a test that asserts one is stale. `test.js` carries this as `NUM_PROMO_DIGIT` (what a human types) vs `NUM_PROMO` (what `M()` receives) — they are deliberately different and merging them is a silent-wrong-piece bug that no assertion catches, because every value still promotes to *something* legal.
- **Promotion cannot reach an illegal piece.** Drive the fifth character over digits, hex letters, `q`/`r`/`b`/`n`, `=`, a space and the empty string, and confirm the result is always one of bishop/rook/queen/knight — never a pawn, a king, or an out-of-range kind. The naive port `+i[4]||3` fails this (`4`→pawn, `5`→king) and is the reason the lookup string exists at all.
- **The status slot is short-circuit on `input`, a ternary chain on `prompt`, two independent arms on `dom`, and its off-state is a bare 0 at every info level.** `input` folds the result into the slot and can use a short-circuit: `z||e&&13||J(T)*4` at L5, `z||J(T)*4` below (counted). `prompt` never puts `z` in the slot — it stops rendering the moment the game ends — so it carries the chain without the `z` arm: `e?13:J(T)*4` at L5, `J(T)*4` below. `dom` splits the two indicators instead of chaining them (`(e&&13)+J(T)*4` in Number, two optional arms in Letter) and *does* carry `z`, but in front of the whole line: `z||LABEL+SLOT+M+R`, so the result **replaces** the status line rather than sharing it. Strict and blindfold print `${z}`, which is `0` while the game runs and the result code once it ends. `J()` returns a **boolean**, so the check arm must be `J(T)*4` — `J(T)&&4` renders the string `false` when there is no check, and a `?4:0` ternary costs 3 B to print the same `0` the multiply gives free. After touching it, read the header in **five** states (idle, in check, draw offered, *both at once*, game over) in **all three interfaces** and confirm none of them prints `false`, `true`, `NaN` or `undefined` — and that the dom Number slot reads 0/4/13/**17** across those states, not a concatenated `134`.
- **The opening-paint drops must never leave a board blank forever.** Both the input and DOM rules are gated on `/setInterval\(/` being present in the emitted script, because the tick is the only thing that repaints afterwards. After touching either, assert for **every** level × notation × interface that `hasTick || hasOpeningPaint` — a config with neither is unplayable, not merely terse. Then go further and *execute* one tick: build the engine, capture the `setInterval` callback (it is a **string**, so `eval` it rather than calling it), and confirm a square is populated afterwards. The DOM anchor is `;D();setInterval` specifically — the engine contains two other `D()` calls (inside `H`'s click handler and inside the tick string itself) and a looser pattern will eat one of them, which parses fine and silently breaks per-click or per-second rendering.
- **Inline CSS must be asserted through a PARSER, never by grepping the markup.** A non-zero CSS length without a unit — `margin-left:16` — is invalid, and a browser discards that declaration *silently* while keeping the rest of the `style` attribute. The emitted string looks exactly right, `new Function` is happy, the jsdom layout checks pass, and the gap simply never appears on screen. This shipped once (the ⚐ spacing, copied in from the reference dom build, which has the same bug) and no string-matching test could have caught it, because the string was present. Test by reading the **parsed** property: build each dom config, walk every `[style]` element, split the attribute into declarations, and assert `el.style[camelCaseProp]` is non-empty for each one — an empty string means the declaration was thrown away. Run it over the whole level × info × notation grid, since different levels emit different style attributes.
- **Read the clocks' TEXT, with asymmetric times, in both notations.** When the status line was folded into the render map (`[d,W,v].map((d,j)=>…)`), the two clock boxes moved from `j`=0,1 to `j`=1,2. The `PICK` expressions were shifted to match, but Number's **side-letter** rewrite was not: `'BW'[j]` kept indexing a two-character string with 1 and 2, so the bottom box rendered `'BW'[2]` — `undefined` — and every Number DOM engine at L3+ printed **`undefined600`**. Nothing failed: indexing past a string yields `undefined` rather than throwing, the byte counts moved plausibly, the markup parsed, and no suite in the repo had ever read a clock's text. The lesson is the test, not the fix: render each clocked config and assert each box (a) contains no `undefined`/`NaN`/`null`, (b) matches `^[WB]\d+$` in Number, (c) has a side letter whose value equals *that side's* clock, and (d) differs from the other box. **Set `wt` and `bt` to different values** — with equal clocks a swapped pair is invisible, which is why the default symmetric 600/600 hid this for as long as it did. Run it over both info levels, both notations, both rotations and both turns; rot-on is turn-dependent, so `T` has to vary or half the mapping goes unchecked.

- **Armageddon's winner tag survives into Number as a residue test — and it is safe only because of which codes are reachable.** The char build appends `WA`/`BA` with `z>'W'` (every White result code sorts above the letter `W`). Once `z` is a number that comparison is dead — `6 > 'W'` is `false` — so Number used to drop the suffix entirely, leaving those players a bare code and no verdict while Letter players got one. It is now rewritten to `z+' '+(z%5==1)`, printing `6 true` / `17 false`: code first, verdict second, the same order Letter uses. `true`/`false` rather than `1`/`0` because the boolean falls straight out of the comparison while `1`/`0` needs a ternary (+3 B), and a bare `1` would collide with the turn indicator, where `1` already means White. Cost: **+13 B**, Armageddon × Number only.
  **The `%5` trick is a property of the REACHABLE code set, not of the numbering.** The White codes Armageddon can produce are `W#`=1, `WT`=6, `WR`=16 — all ≡ 1 (mod 5) — and no reachable Black or draw code is. But `75`=11 is also ≡ 1, and would render a *draw* as a White win. It is safe today only because Armageddon inherits L4's rule set, which has no 75-move rule. **If the numbering table changes, or Armageddon's rule set gains a code, re-derive the test.** The suite guards this directly: it reads the reachable set out of the Letter build rather than assuming it, asserts the residue verdict equals the `z>'W'` verdict for each member, and separately asserts that `75` really is absent.

- **The turn indicator is emitted only where nothing else reveals the side to move.** One rule decides it:

  > `needsIndicator = !tickingClock && !(rot && hasBoard)`

  **`tickingClock`** — `dom` and `input` run `setInterval` from L3 up, so the box that is counting down *is* the cue and no letter is needed. `prompt` never qualifies: its clock is the **elapsed** model, advancing only when you move, so neither box is visibly running and the indicator is required at every level. **`rot && hasBoard`** — a rotated board flips its own coordinate (`a8-h8` for White's view, `h1-a1` for Black's), which states the turn on its own, so rotated builds print the coordinate alone. `blindfold` has no board at all, so rotation is never a cue there; at L3+ its `><` arrow between the clocks carries the turn instead, and below L3 it falls back to the side letter. Working the rule through: at **L3–L5 (and Armageddon) only `prompt` + `counted` + rot-off** needs an indicator; at **L2 and below every rot-off build** needs one (counted and blindfold alike, in all three interfaces) and every rotated board build needs none. The indicator has three spellings — `'BW'[T]` (Letter), a bare `T` (Number), and the `><`/`T` arrow in blindfold — so a test that greps for one shape misses the others; assert the *rule* over the whole grid instead, and check that it fails on a build with redundant indicators, or it is not measuring anything.

- **Three dom-render optimisations, and what makes each safe.** The UI work above cost ~+59 B on the worst config; these take it back to ~+46 while leaving every pixel identical. (1) **The move list is computed on selection, not on render.** `h=G(k=c)` in `H` — `D()` never calls `G` at all, so the once-per-second clock tick stops regenerating a list that cannot have changed. The paint arm carries its own `~k&&` guard, which is what lets `h` go uninitialised and unc­leared: with nothing selected the guard short-circuits before `h` is ever read, so neither the initialiser nor `K` needs to touch it. `H`'s own membership test then reads `h` instead of recomputing `G(k)`. **`h` specifically**, not a shared scratch: the list must survive from the click that set it until the next selection change, and `RESULT`'s insufficient-material test clobbers `a`. `h` is free in *every* dom counted config (it is strict's move-list element id, and strict has no highlight), `inclHoist` never assigns it on dom (dom takes `t`/`n`; only prompt takes `h`), and it is already in `RP_KEEP` so RegPack will not reassign it. (2) **One map writes the status line and both clocks.** `[d,W,v].map((d,j)=>d.innerHTML=j?CLOCK:STATUS)` drops the standalone `d.innerHTML=…;` head; the clock-side picks each subtract one because the status took index 0. The arrow's `d` shadows the outer `d`, which is safe — the array literal is evaluated in the enclosing scope before the callback runs. Only applies where a clock exists; at L2 and below the status keeps its own write. (3) **The ⚐ gap is an EM SPACE, not `margin-left`.** 3 bytes of UTF-8 against 15 of CSS, same 1em. It survives HTML whitespace collapsing because the collapsible set is only space/tab/LF/FF/CR, and the dom engines are already non-ASCII so it costs no BOM. Test the *separation*, not the mechanism — an assertion pinned to `style.marginLeft` passes on the old form and silently misses the new one, and vice versa.
- **Measured and NOT applied: em spaces in the status line.** Replacing the status string's ASCII spaces with U+2003 would let `;word-spacing:1em` go, worth −9 to −13 B depending on variant. It is not applied because every Number rewrite key in `_numResultCodes` matches the status arms *including their spaces* — changing them silently breaks the keys rather than failing loudly, which is the exact hazard documented under the pipeline-ordering note. The gap would also be 1em rather than space+1em. Revisit only with the key updates and the 960 residue scan in the same change.
- **RegPack was NOT re-measured for the dom UI work.** The packer lives in `tools/Siorki_Regpack.html`, which is loaded at runtime and is not part of the generator, so the deltas above are **plain** bytes. Before trusting them, pack the dom matrix through `regpackCompressF(form, g, l, c, RP_KEEP)` over `RP_FACTORS` and compare packed deltas: the new markup adds a repeated `style=color:#00f` and removes a repeated `margin-left:1em`, both the kind of change that can shift which repeats the greedy tokeniser picks.
- **The legal-move highlight is `G()` rendered, so it inherits each level's rules — and `G` must be hoisted.** While a piece is selected, `D()` paints its legal destinations `#c91`. **`counted` only:** `strict` already prints the full move list, so painting the same information on the board is redundant there, and the hoist plus the extra ternary arm are not free — both are gated off together (leaving the hoist behind would compute a list nothing reads). Because `build()` forces `counted` below L3, this only removes the highlight from L3/L4/L5 and Armageddon; a request for `strict` at L0–L2 is really counted and keeps it. The list is the engine's own `G(k)`, which means the highlight is automatically as legal as the level is: L1–L5 filter self-check (`G` replays the move and tests `J`), while **L0 has no check concept and paints pure geometry**, so a king is offered squares that walk into capture. That is correct at L0 — it is won by taking the king — and it is the one level whose highlight legitimately differs from "legal chess". Test it as a contrast pair on the *same* position: a lone king with an enemy rook on the file, and assert the attacked square is painted at L0 and not at L1. Two implementation traps. (1) **Hoist `G(k)` out of the 64-square loop.** The reference build calls it per square (`h(i)[q](u)` inside the loop body), recomputing the same list 64 times — measured ~22 ms per render at L5, and `D()` runs on every clock tick, not just on clicks. Once, into a scratch, is ~0.4 ms for an identical picture. (2) **The empty-selection guard must produce an array, not a falsy.** With nothing selected `k` is −1, and `G(-1)` reads `s[-1]` and throws on `V(undefined)`; but `a=~k&&G(k)` then leaves `a` as `0`, and `0.includes(i)` throws too. Use `a=~k?G(k):[]`. Also assert the highlight tracks the **board** index under rotation (compare against `rotU`, exactly as the selection outline does), and that it clears once the move commits.
- **The ½ label wraps ½ and nothing else.** The `<label>` exists to make the ½ *glyph* a click target, not just the 13px radio dot. It must close immediately after ½: ⚐ is a separate widget and does not belong inside a control it has nothing to do with. Assert both halves with a real HTML parser (the emitted string looks fine either way, and `new Function` cannot see DOM nesting): `#x.closest('label')` exists, and that label does **not** contain the ⚐ button. Then click the label itself and confirm the offer toggles, and click ⚐ and confirm it resigns. An earlier build left the label unclosed so it spanned both controls; that passed every functional test because HTML5 cancels a label's synthetic click on interactive targets, which is exactly why a structural assertion is needed rather than a behavioural one. Note the label is gated on the ½ existing, so **Armageddon emits no label at all** (−7 B there) — it has a resign button and no draw offer.
- **The dom status line carries the result, and the clocks must survive the game ending.** `d` holds the coordinate, the two indicators, `M=` and `R=` while the game runs, and the *result alone* once it ends (`z||…`, or `z?Zs:…` on Armageddon so the score expression survives). The clock boxes no longer carry a `z` arm at all, which is the point: they simply stop and **hold their final time**, where they used to be overwritten by the reason. Test all five states (idle, check, offer, offer+check, finished) and assert (a) the finished line is the result and nothing else, (b) both clocks still read a time afterwards, (c) no `<font` tag survives in a counted build — the blue is a style on the `<p>`, not a wrapper on the text. **strict now has a `d` of its own** and works the same way: its line carries only the result (the move list already shows everything counted puts in the indicators), so it is empty during play and holds the result at the end — `z||''`, exactly like input strict, and the empty `<p>` still reserves its row so nothing jumps when the result appears. No dom build emits `<font>` any more; assert that across the whole grid.
- **The offer lives exactly one move, and `e` and the radio must agree.** K clears both together (`x.checked=e=0`) after `kArm` and `histK` have read `e` and after `RESULT_dom` has read `.checked`. Play the full sequence — offer, move, opponent replies — and assert `e` is 0 at every point from the mover's own move onward; a version that cleared only `.checked` left a live offer behind an empty radio with no writer to restore it. Because `e` is no longer pre-masked at the head of K, `kArm` must carry its own `e&2-T` test: seed the *opponent's* offer bit, move without offering, and confirm the mover's cooldown slot is only decremented, never armed to the reload value. A bare `e` there passes every ordinary game and silently spends the wrong player's slot.
- **The ½ control must round-trip AND survive a select.** Two separate tests, because the control carries two states and a fix for one silently breaks the other. (1) *Offer:* offer, retract, offer again — without moving — and assert `x.checked` tracks `e&2-T` at every step; a radio does not untoggle itself, so any path that leaves `.checked` latched keeps the dot filled after a retract, and the result chain then reads that stale value as a **claim** on the next move. (2) *Claim:* from a position at halfmove 99, tick the box, **click your piece to select it**, then complete the move — the 50-move draw must still fire. Use a QUIET move for this (a knight, say): a pawn move or a capture resets the halfmove clock in `M()`, so the claim can never fire and the test fails for the wrong reason. The select step is the whole point: it triggers a render, and a re-sync placed in `D()` will wipe the claim there (`e` is 0 for a claim), which no offer-only test can see. Check the yellow ring separately (`e&T+1`, the *opponent's* pending offer) — different bit, different seat. Run both at `drawEvery` 1 and >1, since the cooldown rewrites `X`'s offer arm. L5 DOM only.
- **Toggling a draw offer must be free — test it by clicking, not by reading the code.** With `drawEvery > 1`, click the offer control an even number of times *without moving* and assert the slot store `n` is byte-identical to its starting value, then assert a further click can still raise an offer (`e` set). A guard that both tests and arms the slot in one expression passes every parse check, plays a normal game, and still fails this: arming happens on the click, the retract short-circuits past the refund, and the player's right is gone before the opponent ever saw an offer. Run it for **both** cooldown forms — the countdown (`n[+T]<1`) and the periods timestamp (`B>=n[+T]`) — and on **both** the DOM and text interfaces, since they carry the logic separately and only one of them has been wrong at a time. Then check the complements: a slot *is* spent when the offer rides a real move, and **accepting** is never gated even with the slot closed.
- **Parse-check** every generated engine (`new Function(engine)`).
- **The bot ladder.** With `bot:"off"` every engine must stay **byte-identical** to the pre-bot output across the whole matrix — that is the headline invariant, and `bot:"R"` must stay byte-identical to its own pre-ladder output too. For `B1`–`B5`, four things need checking beyond "does it move". (1) **State integrity:** snapshot `s`/`Y`/`C`/`o` (and `T`/`z`/`b`/`P`), call the search directly, and assert every one is restored *exactly* — an unwind bug does not throw, it just plays on a corrupted position several plies later. (2) **The chosen move is legal and Black's:** assert `G(k).includes(l)` and that `s[k]` is a Black piece. (3) **The depth axis:** build with `botDepth` out of range and confirm it *clamps* rather than emitting a `n(0,…)` root call, and that the root call and the root-record test `D==<depth>` always agree. (4) **The clock:** stub `Date` so each search costs a fixed interval, then assert the deduction lands on `N`, that an increment is eaten by a long think rather than lifting the bot back above zero, and that a flag falling mid-think is scored `WT` — on **both** orderings, since dom/input charge after the commit and prompt charges before it. Also confirm the search body is emitted in the *right notation* (no `V(`, no bare `_`, no `<u` comparison in a Number engine) and that its snapshot names all exist at that level. With `bot:"R"`, drive a real game in each interface at each level and confirm Black actually replies (a bot that costs bytes and silently never fires is the failure mode the driver-tail anchoring exists to prevent — see the `K2` hoist notes). Confirm the **`n` invariant**: no engine may contain more than one of `n[+T]`/`n[+W]` (the cooldown array), `n=0,s.map(` (the reservoir counter) and `n=(D,a,b,` (the search function) — `dk` gates on `o.bot==="off"`, so a bot build drops the cooldown. In the highlighter, check the picker renders as **one unbroken `.eng` run through its commit call** — a `</span>` anywhere inside it means a broader rule stole the inner `G(i)`, and a run that stops before `,K()` / `,K2()` means the span was cut short. Then confirm the **human** `K`/`K2` sites are still `.iface`: `K(0)` / `K(2)` (from/to parse), `K2(/[rbn]…)` (typed promotion), `p.hidden=0:K` (dom click-commit).
- **Move-generation correctness via perft.** Start-position counts 20/400/8902 (L2–L5), 12/144/2124 (L1/L0, pawns move one square; L0 takes no promotion arg). Matching old vs new is the strongest check that a core change is behaviour-neutral.
- **Chesseus levels.** `chesseus:'L5'` (the default) must stay **byte-identical to the pre-Chesseus engine** across the full matrix (the one sanctioned exception is the **`Q` bishop-branch fix**, which changes L5/FIDE only). For L4–L0, run a **residue scan**: confirm each level's dropped mechanism leaves no orphan (no `setInterval`/clock at L2−, no `o>99` at L2−, no `P=`/`b=`/`3R`/`I(2)` at L3−, no castle `R`/EP `Y`/two-square fragments at L1−, no `L`/`J`/self-check filter/promotion-choice parse at L0), and that what each level keeps still works. Confirm `strict → counted` is forced at L2 and below.
- **No char-form residue in a Number engine — scan all 960 arrangements, not one.** After any change to either numeric converter, build `notation:number` × `rules:960` over **every** arrangement (not just 518/standard) at L5–L2 and assert the emitted engine contains no `==_`, no bare `_`, no `V(`, no **comparison against** the `u` threshold (`<u`/`>u` — probe the comparison, **not** the bare name: `inclHoist` runs after the converter and legitimately rebinds `u` to `'includes'`, so `u` itself is present in every Number engine and a bare-name probe fires on all of them), and no `D?`/`C!` indicator literals. A rewrite rule keyed on a literal offset passes on the standard start position and fails on 40% of 960: the historical case was `/s\[r\+1\]==_/`, which missed the `s[r+3]` (276 arrangements) and `s[r+5]` (108) forms that `clause()` emits, shipping an engine that threw `_ is not defined` on the first castling move generation. **Parsing cannot see this** — the residue is valid JS — so the scan must be a string assertion on the output plus an execution that actually reaches the castling clause. The **second** historical case had a different shape and is worth contrasting: the queenside discovered-check guard was not an offset problem at all but a whole char *expression* (`<u` plus `V()`) left untranslated, so no amount of generalising the offset would have caught it — see the FIXED entry below.
- **FIXED — the 960 castling clause no longer carries char-form residue in Number.** The scan above used to report `V(` (and the `<u` colour threshold) surviving in the queenside branch, in the shape `(s[r]<u==W|V(s[r])<'Q')`: **252** arrangements (the b-file long-rook skeletons, `rlf===1`) × **5** levels with castling = 1,260 level×arrangement combinations, ×3 interfaces = **3,780 engines**, every one of which threw `V is not defined` on the first queenside move generation — queenside castling was simply dead there. Both numeric converters now rewrite the whole guard to `(s[r]^W|2)!=7` (**−10 B**); see *The queenside discovered-check guard* for the derivation and for why the parentheses are load-bearing. **The expected count for every probe in this scan is now zero** — a non-zero `V(`/`<u` is a regression to fix, not a baseline to tolerate. The `D?`/`C!` half was always clean and stays clean. Note the failure was invisible to `new Function` and to any test that merely *loads* an engine: it needs an execution that reaches the castling clause, which is what the b-file-long-rook sweep below exists to do.
- **A rewrite key must be spelled for the point in the pipeline where it runs.** `_numResultCodes` is called from **two** places at **different stages**: near the start of the input/prompt pass, but LAST in `toNumericDom` — after the `'a8-h8'` → `'00-07'` coordinate rewrite and after `'BW'[T]` → `T`. So the same logical shape needs different keys depending on which caller reaches it: the dom rules must be written in the already-converted form (`'00-07 '+T+…`), while the text-UI rules are written pre-conversion. Getting this backwards produces a rule that matches *nothing*, which is silent — the build succeeds, the engine parses, and the Letter fragment simply survives into the Number output. That is how the `C!` in L2/L1 dom went unnoticed. When adding a rule here, print the actual emitted line for one config in each interface and match against **that text**, never against the shape you expect from reading `build()`.
- **960 sweeps**: genuine castles on both sides + edge cases across all 56 skeletons — including a king stepping (without the right) onto a vacated rook square, and off-corner positions with an *enemy* piece on the freed corner (it must be preserved). **Include the queenside discovered-check case on the b-file-long-rook skeletons** (`rlf===1`): from an `NR…` start, reach a position with the a-file knight moved away and an enemy rook/queen on a1, and confirm queenside castling is now **rejected** while the same castle with a1 empty or a friendly piece stays legal. This bug surfaces in perft **only at depth ≥ 5** — use d5 (or the targeted position) on these skeletons.
- **Clock models.** Drive games under each of the four models in each UI. In `input`/`dom` the tick runs `setInterval`; in `prompt` the clock is the elapsed-time model (no `setInterval`, no `c`/`g`). Bronstein and simple delay are identical in `prompt`; confirm the multi-period delay/increment switches at the right boundary in every UI.
- **Driven / self-play games** for playability and clock logic.
- **An exhibit panel builds its own options object, and a MISSING field is not a default.** Both Introduction panels call `build()` (via `bareCore()`) with a hand-written object rather than through `opts()`, and `build()` does not read its options uniformly: `chesseus` is defaulted at one site (`o.chesseus||"L5"`) but compared strictly at another (`inclHoist`'s `o.chesseus!=="L5"`), and the cooldown gate `dk` tests `o.bot==="off"`. An absent field therefore fails the strict tests while passing the lenient ones. Both panels shipped with this: panel 2 omitted `bot`, so `dk` never opened and the Draw Request Limit button toggled, re-rendered, diffed two identical strings and showed nothing — a dead control with no error; panel 3 omitted `chesseus`, so `inclHoist` never ran and the panel exhibited an engine 5 B larger than the real one (11 B on dom+Indicators), with a raw `.includes(` on screen that no downloaded engine contains and a byte badge to match. Spell every field out in these objects even where the fallback would match, and if this class appears a third time, harden the comparisons in `build()` instead of patching a fourth object.
- **The exhibit needs no sync.** All three Introduction panels derive from `build()` (panels 1 and 2 through `bareCore()`, panel 3 directly), so a fragment change propagates automatically — there is no segment table to hand-update. What *can* still break is the **strip itself**: `bareCore()` finds the interface by anchoring on `,K=v=>`, `,setInterval(` and `,onkeyup=` and then rewriting the driver with a handful of regexes. If you rename one of those, or reshape the input driver's head/tail, the anchors miss and the panels show a mangled core. After any change to the driver or the `K`/`D` boundary, load the page and check that panels 1 and 2 are **identical at panel 2's default** and that neither contains `onkeyup`, `X.value`, `D()` or `t.innerHTML`. Panel 1's own drift guard (the red `stateDrift` banner) covers the concept map. **The second thing that drifts is `CONCEPTS`**, and it fails quietly in two different ways.

  *Failure A — the probe matches nothing.* Each entry highlights by literal substring, so a golf change inside a fragment empties that concept while the panel still renders perfectly. The banner catches these and names them (*"no span matches: …"*). One full audit pass turned up **nine** dead probes at once, in `state`, `time`, `flag`, `threat`, `draw`, `resign` and `plumbing` (two). Their causes are worth knowing because each recurs: a **min-select flip** (`state` was pinned to the board initialiser's template-literal spelling after `build()` chose the shorter `.padEnd(48,…)` form — and since `state` is what `render()` opens on, the panel greeted every visitor with zero highlighting); an **inline fold**, where `y=…` and `D=…` moved from statements into `f`'s argument list and stranded the probes for `G`'s head, `f`'s call and all of `L`; the **`inclHoist` alias**, which turned `.includes(` into `[x](` under `flag`'s `Q` probe; a **guard inserted in front of a group** (`Z?` became `Z?z||(`); an **operator change** (`f=='r'?` became `&&`); and plain **stale text** (`W?'BT':'WT'` had become `U?'WT':'BT'`).

  *Failure B — the probe matches the wrong thing, and the banner cannot see it.* The guard only asserts non-emptiness. A concept that paints a real span which happens to belong to a different rule looks perfectly healthy. The live case was `rook`, which highlighted the whole slider ternary and so coloured the *bishop's* arm; the mirror was `bishop`, missing the discriminator that routes it. `counter` painted a stray `s` from the board that has nothing to do with the 50-move rule, and `flag` painted a lone `T`. **This class needs a human reading the highlights**, concept by concept — the banner will never report it.

  Two habits prevent most of both: **never pin a probe to one side of a min-select** (list every shape the fold can emit; `sub` returns `[]` on a miss, so extra spellings are free and the entry self-heals), and **remember `sub()` takes the FIRST match** — when the text is not unique, anchor on something that is and slice with `seg`.
- **If you touched anything the RegPacked pipeline keys on** (a variable's scope, a helper prefix, the board initialiser), re-check that `rpPlanKey` still classifies every config correctly, that each plan step still passes its apply-time guards, and that `rpPackSmallest` still matches the measured bytes. The whole pipeline must leave `build()` byte-identical. Note `rpPlanKey` reads the **build options**, not the engine text, so adding a level or a UI means adding a key branch — a config with no row silently falls back to the greedy search rather than failing loudly. The search bots are handled by returning `null` outright: they add 400–600 B of top-level code with a scope shape no table was measured against, and the *worse* outcome is not "no row" but borrowing the `off` row, which looks authoritative and whose apply-time guards check shapes rather than provenance.