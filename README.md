# FideLite

*[Türkçe ↓](#türkçe)*

A full-FIDE chess arbiter in **1,872 bytes** of plain JavaScript — no dependencies, no install,
no server. Packed into a playable game it comes to **1,790 bytes**; with a clickable board, a
clock and indicators, **2.7 KB**.

**→ [www.fidelite.art](https://www.fidelite.art)** — playable builds, the rulebook, a line-by-line
source analysis, tests and measurements.

## What this is

Two humans play on the same screen. The engine never suggests a move; it arbitrates the game. Its
only job is to decide whether a move is legal and whether the game is over. No evaluation function,
no search tree, no opening book — this is not a bot engine but an arbiter engine.

Castling, en passant, choice of promotion piece, stalemate, dead position, threefold and fivefold
repetition, the 50- and 75-move rules, draw by agreement, claims, flag fall and resignation are all
implemented in full, and the engine reports which of
[fifteen results](https://www.fidelite.art/#codes) actually occurred.

The one article left partial is the **blocked-position case of 5.2.2** — positions where the
material is sufficient but mate is impossible all the same. When only kings and pawns are left on
the board the engine decides whether the position is blocked; measured coverage is **93%**. The
direction matters as much as the number: every position it calls dead really is dead, and anything
it does not recognise it plays on.

An extension covering the rest was designed and measured. It takes **782 bytes more**, so the
return per byte falls by a factor of twenty-three; it also costs speed, and — because a bishop
turns the question into a third unknown — it puts the engine's only proved property at risk. It is
shelved, not lost. [The full argument is on the site.](https://www.fidelite.art/#dead)

## Why it matters

Across the Lichess open database, Miguel Ambrona's CHA-Solver counted **201,060** games that were
decided wrongly. This engine gets **197,463** of them right. The 3,597
it misses are all blocked positions, and nearly every one of them has a bishop on the board.

The difference fits in one sentence: **the platforms look at the board at the moment the flag fell;
the book asks what that board is forced to become.**

## The files

| File | Bytes | What it is |
| --- | --- | --- |
| `builds/engine.js` | 1,872 | The rule engine. One line, no front end. |
| `builds/engine_4x.js` | 1,940 | The same rules, +68 bytes, two to ten times the speed. |
| `builds/engine_onlyMoveGenerator.js` | 723 | Move generation only, for the test suite. |

Every file under `builds/` and `special/` runs on its own — download an HTML file and double-click
it. The `.cjs` builds run in a terminal with `node`.

**Ten front ends carry the full arbiter.** `L3` is played by clicking; `numerical`, `prompt`,
`prompt_blindfold`, `input`, `input_blindfold`, `prompt_string`, `prompt_string_flip` and two
terminal builds take moves as text. The rule layer is identical in all ten. Four further builds —
`L1`, `L2` and their two bot versions — vary the *rules* instead of the interface, and sit outside
the claim. [Details.](https://www.fidelite.art/#builds)

## Detailed documentation

Everything below is on the site, in English and Turkish.

| Topic | Link |
| --- | --- |
| How the rules read, article by article | [/#rules](https://www.fidelite.art/#rules) |
| Dead position — 5.2.2 and its two branches | [/#dead](https://www.fidelite.art/#dead) |
| Resignation and flag fall — 5.1.2 and 6.9 | [/#flag](https://www.fidelite.art/#flag) |
| The builds, and how to play them | [/#builds](https://www.fidelite.art/#builds) |
| The fifteen result codes | [/#codes](https://www.fidelite.art/#codes) |
| Engine structure, board representation, driver API | [/#engine](https://www.fidelite.art/#engine) |
| Line-by-line source analysis | [/#flow](https://www.fidelite.art/#flow) |
| Perft tests, and running them yourself | [/#tests](https://www.fidelite.art/#tests) |
| `engine_4x` and the speed measurements | [/#speed](https://www.fidelite.art/#speed) |
| Architectures tried and eliminated | [/#alternatives](https://www.fidelite.art/#alternatives) |
| The previous generation — the letter board | [/#letters](https://www.fidelite.art/#letters) |
| Packing, RegPack, obsolete techniques | [/#packing](https://www.fidelite.art/#packing) |
| Pitfalls and fragile spots | [/#pitfalls](https://www.fidelite.art/#pitfalls) |

## Running the tests

The rule claims are checked with perft against published reference values: the CPW positions, van
Kervinck's tricky list, the 6,838-position Vajolet corpus, and a move-list comparison against
Stockfish — about **1.5 billion nodes, zero deviations**.

You do not have to take my word for it. [`test.zip`](https://www.fidelite.art/test.zip) (238 KB)
contains the suite, copies of the three engines, the Vajolet position list and eight clickable
`.bat` files. Five of the eight runs need only Node; two need Stockfish, which is not in the
package. On any other platform, `node test.js <command>`.

## Also in the repository

Five files that the site does not link to, kept here because they are part of how the engine got
where it is.

| File | What it is |
| --- | --- |
| [`special/L1/Toledos-ES6-optimized.html`](special/L1/Toledos-ES6-optimized.html) | Oscar Toledo G.'s chess in an ES6 rewrite — the best-known tiny chess program, and the benchmark this project measured itself against. |
| [`special/L1/ToledosOpponentbyMe.html`](special/L1/ToledosOpponentbyMe.html) | The opponent I wrote for it, on this engine. Two tiny programs playing each other. |
| [`extra/2kbfullfidejs.com_index.html`](extra/2kbfullfidejs.com_index.html) | A generator built on the same ideas: it emits standalone engines of roughly 0.6–2.7 KB across several rule levels. |
| [`extra/2kbfullfidejs.com_README.md`](extra/2kbfullfidejs.com_README.md) | That generator's own documentation — architecture, option axes, the optimisation rules it follows. |
| [`extra/Chess960_Skeletons.html`](extra/Chess960_Skeletons.html) | All 56 castling skeletons of Chess960, laid out. Where the castling rules go once the back rank is no longer fixed. |

## Licence

MIT — see [LICENSE](LICENSE). The claim is falsifiable and should be: it falls the moment someone
ships something smaller. Until then it stands.

---

# Türkçe

Tam FIDE kurallı satranç hakem motoru, **1.872 bayt** saf JavaScript — bağımlılık yok, kurulum
yok, sunucu yok. Paketlenip oynanabilir bir oyuna dönüştüğünde **1.790 bayt**; tıklanabilir
tahtası, saati ve göstergeleriyle birlikte **2,7 KB**.

**→ [www.fidelite.art/tr](https://www.fidelite.art/tr)** — oynanabilir sürümler, kural kitabı,
satır satır kaynak çözümlemesi, testler ve ölçümler.

## Ne bu

İki insan aynı ekranda oynar. Motor hamle önermez, oyunu yönetir: tek işi hamlenin kurallara uygun
olup olmadığına ve oyunun bitip bitmediğine karar vermektir. Değerlendirme fonksiyonu, arama ağacı,
açılış kitabı yok — bu bir bot motoru değil, hakem motoru.

Rok, geçerken alma, seçimli terfi, pat, ölü pozisyon, üçlü ve beşli tekrar, 50 ve 75 hamle,
anlaşmalı beraberlik, iddia, süre ve terk eksiksiz uygulanır, ve motor
[on beş sonuçtan](https://www.fidelite.art/tr#codes) hangisi geldiyse onu adıyla bildirir.

Kısmi kalan tek madde **5.2.2'nin kilitli pozisyon hâli** — materyalin yeterli olduğu ama matın
yine de imkânsız olduğu pozisyonlar. Tahtada yalnız şah ve piyon kaldığında motor pozisyonun
kilitli olup olmadığına karar veriyor; ölçülen kapsama **%93**. Yön de sayı kadar önemli: motorun
ölü dediği her pozisyon gerçekten ölüdür, tanımadığını oynatmaya devam eder.

Kalanı kapatan bir genişletme tasarlandı ve ölçüldü. **782 bayt daha** tutuyor, yani bayt başına
getiri yirmi üç kat düşüyor; hızı da aşağı çekiyor, ve fil soruyu üçüncü bir bilinmeyene
dönüştürdüğü için motorun tek ispatlı özelliğini riske atıyor. Askıda, kaybolmuş değil.
[Ayrıntılı gerekçe sitede.](https://www.fidelite.art/tr#dead)

## Neden önemli

Miguel Ambrona'nın CHA-Solver'ı Lichess açık veritabanını baştan sona tarayıp **201.060** haksız
sonuçlanmış oyun saydı. Bu motor onların **197.463'ünü** doğru karara
bağlıyor. Kaçırdığı 3.597 oyunun tamamı kilitli pozisyon, ve neredeyse hepsinde tahtada bir fil
var.

Fark tek cümleye sığıyor: **platformlar bayrak düştüğü andaki tahtaya bakıyor, kitap ise o tahtanın
zorunlu olarak neye dönüşeceğini soruyor.**

## Dosyalar

| Dosya | Bayt | Ne |
| --- | --- | --- |
| `builds/engine.js` | 1.872 | Kural motoru. Tek satır, önyüz yok. |
| `builds/engine_4x.js` | 1.940 | Aynı kurallar, +68 bayt, iki ilâ on kat hız. |
| `builds/engine_onlyMoveGenerator.js` | 723 | Yalnız hamle üretimi, test süiti için. |

`builds/` ve `special/` altındaki her dosya tek başına çalışır — HTML dosyasını indirip çift
tıklamak yeterli. `.cjs` sürümleri terminalde `node` ile koşar.

**On önyüz tam hakemi taşıyor.** `L3` tıklanarak oynanır; `numerical`, `prompt`,
`prompt_blindfold`, `input`, `input_blindfold`, `prompt_string`, `prompt_string_flip` ve iki
terminal sürümü hamleyi metin olarak alır. Kural katmanı onunda da aynıdır. Dört sürüm daha —
`L1`, `L2` ve iki botlu hâlleri — arayüzü değil *kuralları* değiştirir ve iddianın dışındadır.
[Ayrıntı.](https://www.fidelite.art/tr#builds)

## Ayrıntılı belge

Aşağıdakilerin hepsi sitede, Türkçe ve İngilizce.

| Konu | Bağlantı |
| --- | --- |
| Kuralların okunuşu, madde madde | [/tr#rules](https://www.fidelite.art/tr#rules) |
| Ölü pozisyon — 5.2.2 ve iki kolu | [/tr#dead](https://www.fidelite.art/tr#dead) |
| Terk ve süre bitimi — 5.1.2 ve 6.9 | [/tr#flag](https://www.fidelite.art/tr#flag) |
| Varyantlar ve oynanış | [/tr#builds](https://www.fidelite.art/tr#builds) |
| On beş sonuç kodu | [/tr#codes](https://www.fidelite.art/tr#codes) |
| Motorun yapısı, tahta temsili, sürücü API'si | [/tr#engine](https://www.fidelite.art/tr#engine) |
| Satır satır kaynak çözümlemesi | [/tr#flow](https://www.fidelite.art/tr#flow) |
| Perft testleri ve testleri kendiniz koşmak | [/tr#tests](https://www.fidelite.art/tr#tests) |
| `engine_4x` ve hız ölçümleri | [/tr#speed](https://www.fidelite.art/tr#speed) |
| Denenip elenen mimariler | [/tr#alternatives](https://www.fidelite.art/tr#alternatives) |
| Önceki nesil — harf tahtası | [/tr#letters](https://www.fidelite.art/tr#letters) |
| Paketleme, RegPack, eskimiş teknikler | [/tr#packing](https://www.fidelite.art/tr#packing) |
| Tuzaklar ve kırılgan yerler | [/tr#pitfalls](https://www.fidelite.art/tr#pitfalls) |

## Testleri koşmak

Kural iddiaları perft ile, yayımlanmış referans değerlere karşı sınandı: CPW pozisyonları, van
Kervinck'in zor listesi, 6.838 pozisyonluk Vajolet külliyatı ve Stockfish'e karşı hamle listesi
karşılaştırması — yaklaşık **1,5 milyar düğüm, sıfır sapma**.

Bana güvenmeniz gerekmiyor. [`test.zip`](https://www.fidelite.art/test.zip) (238 KB) içinde süit,
üç motorun kopyası, Vajolet pozisyon listesi ve sekiz çift tıklanabilir `.bat` var. Sekiz koşunun
beşi yalnızca Node istiyor; ikisi Stockfish gerektiriyor, o da pakette değil. Başka platformda
`node test.js <komut>`.

## Repoda ayrıca

Sitenin bağlantı vermediği beş dosya. Motorun bugünkü hâline nasıl geldiğinin parçası oldukları
için burada duruyorlar.

| Dosya | Ne |
| --- | --- |
| [`special/L1/Toledos-ES6-optimized.html`](special/L1/Toledos-ES6-optimized.html) | Oscar Toledo G.'nin satrancının ES6 ile yeniden yazımı — en bilinen küçük satranç programı, ve bu projenin kendini ölçtüğü eşik. |
| [`special/L1/ToledosOpponentbyMe.html`](special/L1/ToledosOpponentbyMe.html) | Ona karşı bu motorla yazdığım rakip. İki küçük program birbiriyle oynuyor. |
| [`extra/2kbfullfidejs.com_index.html`](extra/2kbfullfidejs.com_index.html) | Aynı fikirler üzerine kurulu bir üretici: birkaç kural seviyesinde, kabaca 0,6–2,7 KB arası tek başına çalışan motorlar üretiyor. |
| [`extra/2kbfullfidejs.com_README.md`](extra/2kbfullfidejs.com_README.md) | O üreticinin kendi belgesi — mimari, seçenek eksenleri, uyduğu optimizasyon kuralları. |
| [`extra/Chess960_Skeletons.html`](extra/Chess960_Skeletons.html) | Chess960'ın 56 rok iskeletinin tamamı. Son yatay sabit olmaktan çıkınca rok kurallarının nereye gittiği. |

## Lisans

MIT — bkz. [LICENSE](LICENSE). İddia çürütülebilir, öyle de olmalı: biri daha küçüğünü çıkarırsa
düşer. Çıkana kadar duruyor.
