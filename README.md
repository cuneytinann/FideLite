# FideLite

*[Türkçe ↓](#türkçe)*

A full-FIDE chess arbiter in **1,883 bytes** of plain JavaScript — no dependencies, no install,
no server. Packed into a playable game it comes to **1,792 bytes**; with a clickable board, a
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
decided wrongly. This engine gets **197,493** of them right. The 3,567
it misses are all blocked positions, and nearly every one of them has a bishop on the board.
[Chess LUX](https://github.com/cuneytinann/Chess-LUX), a sibling project on `engine_4x` with a looser byte budget, extends
the lock detector to bishops and closes all but 11 of them: the right verdict in 201,049 of the
201,060 games (99.99%).

The difference fits in one sentence: **the platforms look at the board at the moment the flag fell;
the book asks what that board is forced to become.**

## The files

| File | Bytes | What it is |
| --- | --- | --- |
| `builds/engine.js` | 1,883 | The rule engine. One line, no front end. |
| `builds/engine_4x.js` | 1,963 | The same rules, +80 bytes, two to ten times the speed. |
| `builds/engine_string.js` | 1,999 | The same rules on a board of FEN letters instead of numbers. |

Every file under `builds/` and `special/` runs on its own — download an HTML file and double-click
it. The `.cjs` builds run in a terminal with `node`.

**Eleven front ends carry the full arbiter.** `L3` and `L3_light` are played by clicking;
`numerical`, `prompt`, `prompt_blindfold`, `input`, `input_blindfold`, `prompt_string`,
`prompt_string_flip` and two terminal builds take moves as text. The rules are identical in all
eleven. `L1` and `L2` vary the *rules* instead of the interface; each has its own set of front
ends and a build with a bot, and both sit outside the claim. `special/` holds what fits no level: the builds of five sibling projects, each with a
repository of its own — [lichess-equivalent](https://github.com/cuneytinann/lichess-equivalent), [chesscom-equivalent](https://github.com/cuneytinann/chesscom-equivalent),
[chessarbiter2kb](https://github.com/cuneytinann/chessarbiter2kb), [chessinbytes](https://github.com/cuneytinann/chessinbytes) and [Chess-LUX](https://github.com/cuneytinann/Chess-LUX) — and Toledo's program. The two
packed `L3` builds live there too; they are `L3` itself, but open under *special* because their
unpacker relies on `with` and `eval`.
[Details.](https://www.fidelite.art/#builds)

## Detailed documentation

Everything below is on the site, in English and Turkish.

| Topic | Link |
| --- | --- |
| How the rules read, article by article | [/#rules](https://www.fidelite.art/#rules) |
| Dead position — 5.2.2 and its two branches | [/#dead](https://www.fidelite.art/#dead) |
| Resignation and flag fall — 5.1.2 and 6.9 | [/#flag](https://www.fidelite.art/#flag) |
| The builds — two axes and the `L3` family | [/#builds](https://www.fidelite.art/#builds) |
| How the main-axis builds are played | [/#gameplay](https://www.fidelite.art/#gameplay) |
| The fifteen result codes | [/#codes](https://www.fidelite.art/#codes) |
| `L1` and `L2` — the rules axis | [/#levels](https://www.fidelite.art/#levels) |
| Special builds — five sibling projects and Toledo | [/#special](https://www.fidelite.art/#special) |
| Engine structure, board representation, driver API | [/#engine](https://www.fidelite.art/#engine) |
| Line-by-line source analysis | [/#flow](https://www.fidelite.art/#flow) |
| The pipeline of endings — which result wins when two coincide | [/#endings](https://www.fidelite.art/#endings) |
| Perft tests, and running them yourself | [/#tests](https://www.fidelite.art/#tests) |
| Architectures tried and eliminated | [/#alternatives](https://www.fidelite.art/#alternatives) |
| The previous generation — the letter board | [/#letters](https://www.fidelite.art/#letters) |
| `engine_4x` and the speed measurements | [/#speed](https://www.fidelite.art/#speed) |
| The driver's three parsers — click, UCI, numeric | [/#parsing](https://www.fidelite.art/#parsing) |
| Packing, RegPack, obsolete techniques | [/#packing](https://www.fidelite.art/#packing) |
| Pitfalls and fragile spots | [/#pitfalls](https://www.fidelite.art/#pitfalls) |

## Running the tests

The rule claims are checked with perft against published reference values: the CPW positions, van
Kervinck's tricky list, the 6,838-position Vajolet corpus, and a move-list comparison against
Stockfish — about **1.5 billion nodes, zero deviations**.

You do not have to take my word for it. [`test.zip`](https://www.fidelite.art/test.zip) (241 KB)
contains the suite, copies of the four engines, the Vajolet position list and eight clickable
`.bat` files. Five of the eight runs need only Node; two need Stockfish, which is not in the
package. On any other platform, `node test.js <command>`.

## Also in the repository

Five files kept here because they are part of how the engine got where it is. The first two can
also be played on the site, under *special*.

| File | What it is |
| --- | --- |
| [`special/Toledos-ES6-optimized.html`](special/Toledos-ES6-optimized.html) | Oscar Toledo G.'s chess in an ES6 rewrite — the best-known tiny chess program, and the benchmark this project measured itself against. |
| [`special/ToledosOpponentbyMe.html`](special/ToledosOpponentbyMe.html) | The opponent I wrote for it, on this engine. Two tiny programs playing each other. |
| [`extra/2kbfullfidejs.com_index.html`](extra/2kbfullfidejs.com_index.html) | A generator built on the same ideas: it emits standalone engines of roughly 0.6–2.7 KB across several rule levels. |
| [`extra/2kbfullfidejs.com_README.md`](extra/2kbfullfidejs.com_README.md) | That generator's own documentation — architecture, option axes, the optimisation rules it follows. |
| [`extra/Chess960_Skeletons.html`](extra/Chess960_Skeletons.html) | All 56 castling skeletons of Chess960, laid out. Where the castling rules go once the back rank is no longer fixed. |

## Licence

MIT — see [LICENSE](LICENSE). The claim is falsifiable and should be: it falls the moment someone
ships something smaller. Until then it stands.

---

# Türkçe

Tam FIDE kurallı satranç hakem motoru, **1.883 bayt** saf JavaScript — bağımlılık yok, kurulum
yok, sunucu yok. Paketlenip oynanabilir bir oyuna dönüştüğünde **1.792 bayt**; tıklanabilir
tahtası, saati ve göstergeleriyle birlikte **2,7 KB**.

**→ [www.fidelite.art/tr](https://www.fidelite.art/tr)** — oynanabilir sürümler, kural kitabı,
satır satır kaynak çözümlemesi, testler ve ölçümler.

## Ne bu

İki insan aynı ekranda oynar. Motor hamle önermez, oyunu yönetir: tek işi hamlenin kurallara uygun
olup olmadığına ve oyunun bitip bitmediğine karar vermektir. Değerlendirme fonksiyonu, arama ağacı,
açılış kitabı yok — bu bir bot motoru değil, hakem motoru.

Rok, geçerken alma, seçimli terfi, pat, ölü pozisyon, üçlü ve beşli tekrar, 50 ve 75 hamle,
anlaşmalı beraberlik, iddia, süre ve terk eksiksiz uygulanır ve motor
[on beş sonuçtan](https://www.fidelite.art/tr#codes) hangisi geldiyse onu adıyla bildirir.

Kısmi kalan tek madde **5.2.2'nin kilitli pozisyon hâli** — materyalin yeterli olduğu ama matın
yine de imkânsız olduğu pozisyonlar. Tahtada yalnız şah ve piyon kaldığında motor pozisyonun
kilitli olup olmadığına karar veriyor; ölçülen kapsama **%93**. Yön de sayı kadar önemli: motorun
ölü dediği her pozisyon gerçekten ölüdür, tanımadığını oynatmaya devam eder.

Kalanı kapatan bir genişletme tasarlandı ve ölçüldü. **782 bayt daha** tutuyor, yani bayt başına
getiri yirmi üç kat düşüyor; hızı da aşağı çekiyor ve fil soruyu üçüncü bir bilinmeyene
dönüştürdüğü için motorun tek ispatlı özelliğini riske atıyor. Askıda, kaybolmuş değil.
[Ayrıntılı gerekçe sitede.](https://www.fidelite.art/tr#dead)

## Neden önemli

Miguel Ambrona'nın CHA-Solver'ı Lichess açık veritabanını baştan sona tarayıp **201.060** haksız
sonuçlanmış oyun saydı. Bu motor onların **197.493'ünü** doğru karara
bağlıyor. Kaçırdığı 3.567 oyunun tamamı kilitli pozisyon ve neredeyse hepsinde tahtada bir fil
var. `engine_4x` üzerine, daha gevşek bir bayt bütçesiyle kurulu kardeş proje
[Chess LUX](https://github.com/cuneytinann/Chess-LUX) kilitli pozisyon dedektörünü fillere genişletip bunların 11'i dışında
hepsini kapatıyor: 201.060 oyunun 201.049'unda doğru hüküm (%99,99).

Fark tek cümleye sığıyor: **platformlar bayrak düştüğü andaki tahtaya bakıyor, kitap ise o tahtanın
zorunlu olarak neye dönüşeceğini soruyor.**

## Dosyalar

| Dosya | Bayt | Ne |
| --- | --- | --- |
| `builds/engine.js` | 1.883 | Kural motoru. Tek satır, önyüz yok. |
| `builds/engine_4x.js` | 1.963 | Aynı kurallar, +80 bayt, iki ilâ on kat hız. |
| `builds/engine_string.js` | 1.999 | Aynı kurallar, tahta sayı yerine FEN harfleriyle. |

`builds/` ve `special/` altındaki her dosya tek başına çalışır — HTML dosyasını indirip çift
tıklamak yeterli. `.cjs` sürümleri terminalde `node` ile koşar.

**On bir önyüz tam hakemi taşıyor.** `L3` ve `L3_light` tıklanarak oynanır; `numerical`,
`prompt`, `prompt_blindfold`, `input`, `input_blindfold`, `prompt_string`, `prompt_string_flip` ve
iki terminal sürümü hamleyi metin olarak alır. Kurallar on birinde de aynıdır. `L1` ve `L2`
arayüzü değil *kuralları* değiştirir; her birinin kendi önyüzleri ve botlu bir sürümü var, ikisi de
iddianın dışındadır. `special/` hiçbir seviyeye girmeyenleri tutar: her birinin kendi deposu olan beş kardeş projenin
sürümleri — [lichess-equivalent](https://github.com/cuneytinann/lichess-equivalent), [chesscom-equivalent](https://github.com/cuneytinann/chesscom-equivalent), [chessarbiter2kb](https://github.com/cuneytinann/chessarbiter2kb),
[chessinbytes](https://github.com/cuneytinann/chessinbytes) ve [Chess-LUX](https://github.com/cuneytinann/Chess-LUX) — ve Toledo'nun programı. Paketli iki `L3` sürümü de
orada; kural seviyeleri `L3`, ama açıcıları `with` ve `eval`'e dayandığı için *special*
altından açılıyorlar.
[Ayrıntı.](https://www.fidelite.art/tr#builds)

## Ayrıntılı belge

Aşağıdakilerin hepsi sitede, Türkçe ve İngilizce.

| Konu | Bağlantı |
| --- | --- |
| Kuralların okunuşu, madde madde | [/tr#rules](https://www.fidelite.art/tr#rules) |
| Ölü pozisyon — 5.2.2 ve iki kolu | [/tr#dead](https://www.fidelite.art/tr#dead) |
| Terk ve süre bitimi — 5.1.2 ve 6.9 | [/tr#flag](https://www.fidelite.art/tr#flag) |
| Varyantlar — iki eksen ve `L3` ailesi | [/tr#builds](https://www.fidelite.art/tr#builds) |
| Asıl eksen varyantları nasıl oynanır | [/tr#gameplay](https://www.fidelite.art/tr#gameplay) |
| On beş sonuç kodu | [/tr#codes](https://www.fidelite.art/tr#codes) |
| `L1` ve `L2` — kural ekseni | [/tr#levels](https://www.fidelite.art/tr#levels) |
| Özel sürümler — beş kardeş proje ve Toledo | [/tr#special](https://www.fidelite.art/tr#special) |
| Motorun yapısı, tahta temsili, sürücü API'si | [/tr#engine](https://www.fidelite.art/tr#engine) |
| Satır satır kaynak çözümlemesi | [/tr#flow](https://www.fidelite.art/tr#flow) |
| Bitişin boru hattı — iki sonuç çakışınca hangisi kazanır | [/tr#endings](https://www.fidelite.art/tr#endings) |
| Perft testleri ve testleri kendiniz koşmak | [/tr#tests](https://www.fidelite.art/tr#tests) |
| Denenip elenen mimariler | [/tr#alternatives](https://www.fidelite.art/tr#alternatives) |
| Önceki nesil — harf tahtası | [/tr#letters](https://www.fidelite.art/tr#letters) |
| `engine_4x` ve hız ölçümleri | [/tr#speed](https://www.fidelite.art/tr#speed) |
| Sürücünün üç ayrıştırıcısı — tıklama, UCI, sayısal | [/tr#parsing](https://www.fidelite.art/tr#parsing) |
| Paketleme, RegPack, eskimiş teknikler | [/tr#packing](https://www.fidelite.art/tr#packing) |
| Tuzaklar ve kırılgan yerler | [/tr#pitfalls](https://www.fidelite.art/tr#pitfalls) |

## Testleri koşmak

Kural iddiaları perft ile, yayımlanmış referans değerlere karşı sınandı: CPW pozisyonları, van
Kervinck'in zor listesi, 6.838 pozisyonluk Vajolet külliyatı ve Stockfish'e karşı hamle listesi
karşılaştırması — yaklaşık **1,5 milyar düğüm, sıfır sapma**.

Bana güvenmeniz gerekmiyor. [`test.zip`](https://www.fidelite.art/test.zip) (241 KB) içinde süit,
dört motorun kopyası, Vajolet pozisyon listesi ve sekiz çift tıklanabilir `.bat` var. Sekiz koşunun
beşi yalnızca Node istiyor; ikisi Stockfish gerektiriyor, o da pakette değil. Başka platformda
`node test.js <komut>`.

## Repoda ayrıca

Motorun bugünkü hâline nasıl geldiğinin parçası oldukları için burada duran beş dosya. İlk ikisi
sitede de, *special* altında oynanabiliyor.

| Dosya | Ne |
| --- | --- |
| [`special/Toledos-ES6-optimized.html`](special/Toledos-ES6-optimized.html) | Oscar Toledo G.'nin satrancının ES6 ile yeniden yazımı — en bilinen küçük satranç programı, ve bu projenin kendini ölçtüğü eşik. |
| [`special/ToledosOpponentbyMe.html`](special/ToledosOpponentbyMe.html) | Ona karşı bu motorla yazdığım rakip. İki küçük program birbiriyle oynuyor. |
| [`extra/2kbfullfidejs.com_index.html`](extra/2kbfullfidejs.com_index.html) | Aynı fikirler üzerine kurulu bir üretici: birkaç kural seviyesinde, kabaca 0,6–2,7 KB arası tek başına çalışan motorlar üretiyor. |
| [`extra/2kbfullfidejs.com_README.md`](extra/2kbfullfidejs.com_README.md) | O üreticinin kendi belgesi — mimari, seçenek eksenleri, uyduğu optimizasyon kuralları. |
| [`extra/Chess960_Skeletons.html`](extra/Chess960_Skeletons.html) | Chess960'ın 56 rok iskeletinin tamamı. Son yatay sabit olmaktan çıkınca rok kurallarının nereye gittiği. |

## Lisans

MIT — bkz. [LICENSE](LICENSE). İddia çürütülebilir, öyle de olmalı: biri daha küçüğünü çıkarırsa
düşer. Çıkana kadar duruyor.
