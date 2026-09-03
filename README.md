# FideLite

*[Türkçe ↓](#türkçe)*

A full-FIDE chess arbiter in 1,826 bytes of plain JavaScript — board, interface and all.
The rule engine on its own is 1,945.

**→ [www.fidelite.art](https://www.fidelite.art)**

## What this is

Two humans play on the same screen. The engine never suggests a move; it arbitrates the game. Its only job is to decide whether a move is legal and whether the game is over. No evaluation function, no search tree, no opening book — this is not a bot engine but an arbiter engine.

Castling, en passant, choice of promotion piece, stalemate, insufficient material, threefold and fivefold repetition, the 50- and 75-move rules, draw by agreement, flag fall and resignation are all implemented in full. **The blocked-position case of 5.2.2** — where the material is sufficient but mate is impossible all the same — is implemented too, in part. When only kings and pawns are left on the board the engine decides whether the position is blocked; measured coverage is **93%**, and every one of the remaining seven per cent involves a bishop. The direction matters as much as the number: there are draws it misses, but none it invents. An extension covering nearly all the bishop cases was designed and measured — it would take coverage to 99.94% — but even golfed it came to close to a thousand bytes, more than half the program again, and 99.94% is still a measured figure rather than a proved bound. It is shelved, not lost. [The full argument is on the site.](https://www.fidelite.art/#dead)

Every file under `builds/` runs on its own — no library, no install, no server. Download an HTML file and double-click it.

The three JavaScript files there are the rule engine without a front end: `engine.js` (1,945 bytes), `engine_4x.js` (the same rules, +48 bytes, two to sixteen times the speed) and `engine_onlyMoveGenerator.js` (move generation only, for the test suite). The site reads them live and documents them in full — [structure and driver API](https://www.fidelite.art/#engine), [line by line](https://www.fidelite.art/#flow), [the speed measurements](https://www.fidelite.art/#speed).

## The builds

`builds/` holds the four builds the site puts in front of you, arranged by **rule level** rather than by interface:

| build | what it enforces | bytes |
|---|---|---|
| `L1.html` | legality only — moves, check, mate, stalemate | 1,598 |
| `L2.html` | + counters and the automatic draws | 2,324 |
| `L3.html` | the full arbiter — clock, claims, resignation, flag fall | 3,227 |
| `L2_aybars.html` | `L2` with a bot on top of it | 7,168 |

`special/` holds the same rule levels wearing different interfaces. Every one of them runs on its own, and every one of them is the same arbiter underneath — what changes is how a move gets in and how the board comes out.

`special/L3/` carries the full arbiter in five further shapes: `numerical.html` takes moves as two-digit square numbers through a `prompt()` dialog, `prompt.html` takes them in UCI through the same dialog, `input.html` in UCI through a text field on the page, and `input_blindfold.html` does the same while drawing no board at all. Alongside them sit the two self-extracting RegPack builds, `dom_packed.html` (2,755 bytes) and `numerical_packed.html` (**1,826 bytes** — the smallest full-FIDE arbiter here).

`special/L2/` and `special/L1/` mirror the same idea one and two levels down, and `special/L1/` also holds the two Toledo comparison files.

The packed pair are the only files that cannot be copied off a screen: their dictionary keys are control characters in the `\x01`–`\x1f` range, and a clipboard or an editor's line-ending fix destroys them. Download those two.

## Documentation

| topic | link |
|---|---|
| Engine structure — board representation, state, driver API | [/#engine](https://www.fidelite.art/#engine) |
| Variable map — 36 names, shadowings, free letters | [/#names](https://www.fidelite.art/#names) |
| Architectures tried and eliminated | [/#alternatives](https://www.fidelite.art/#alternatives) |
| Line-by-line source analysis | [/#flow](https://www.fidelite.art/#flow) |
| Official rules of play and 5.2.2 | [/#rules](https://www.fidelite.art/#rules) |
| The fifteen result codes, the FIDE–USCF difference | [/#codes](https://www.fidelite.art/#codes) |
| Build comparison and `engine_4x` measurements | [/#builds](https://www.fidelite.art/#builds) · [/#speed](https://www.fidelite.art/#speed) |
| Packing, RegPack details, the `dom` exception | [/#packing](https://www.fidelite.art/#packing) |
| Perft tests, verification, and running the tests yourself | [/#tests](https://www.fidelite.art/#tests) |
| Pitfalls and fragile spots | [/#pitfalls](https://www.fidelite.art/#pitfalls) |

## `extra/`

*The two Toledo files listed here now live under `special/L1/`; the links point there.*


Material that sits beside the engine rather than inside it. Every file is standalone — open it in a browser.

**[`Absolute_Distance.html`](extra/Absolute_Distance.html)** — an 8×8 grid where clicking a square lights up every square at a chosen distance from it. Values take decimals (`2.24`) or radicals (`sqrt5`, `2sqrt2`, `√5`, `v8`), several per group, and you can add as many groups as you like. This is the simulation behind the [Euclidean-distance design](https://www.fidelite.art/#alternatives) — the one that looked flawless until the rook's (0,5) collided with (3,4).

**[`Board_Delta_Index.html`](extra/Board_Delta_Index.html)** — the same question asked the other way round: movement as an index delta rather than a distance. Board size is free, any number of rows and columns, so a rule that holds at eight wide can be watched breaking at seven or nine. Groups of deltas with `±` to include the negative and `mul` to include the multiples, reverse indexing, area selection.

Both were written to build intuition rather than to ship: the point is to *see* a piece's reach instead of deriving it on paper.

**[`Chess960_Skeletons.html`](extra/Chess960_Skeletons.html)** — all 56 rook–king–rook skeletons, generated live. Castling in Fischer-random chess depends only on where the king and its two rooks sit, and the king always stands between the rooks, so C(8,3)=56 skeletons cover all 960 setups. Each card holds one skeleton and every Scharnagl ID built on it, with #518 — the orthodox start — marked.

**[`Toledos-ES6-optimized.html`](special/L1/Toledos-ES6-optimized.html)** — not mine, and the odd one out here. Óscar Toledo's [Toledo Javascript Chess](https://nanochess.org/), Unicode-piece variant, 2,299 bytes: a full chess AI plus board plus interface crushed into that space, and it will beat most people who sit down in front of it. A compressed engineering marvel, and one I'm a fan of. This is that build rewritten with ES6 methods — arrow functions, default parameters, template literals — and re-optimised for modern browsers: glyphs and text enlarged, still in quirks mode, content untouched, **1,989 characters** — 1,932 of code plus a 57-character attribution comment, measured the same way as Toledo's 2,299, which carries his own. Characters, not bytes: the piece glyphs are multi-byte in UTF-8, so on disk the file is 2,013 bytes with its BOM. It is the exact opposite of the engine in this repository, which is why it earns a place next to it: Toledo's searches, FideLite's arbitrates.

**[`ToledosOpponentbyMe.html`](special/L1/ToledosOpponentbyMe.html)** — a build written to sit opposite the one above, **2,062 bytes**; it is not on the site and exists only for this comparison. The two enforce the same rule set: castling, en passant, choice of promotion piece, and three endings — White mates, Black mates, stalemate. Nothing beyond that; neither has a clock, repetition, the 50-move rule, a draw offer or resignation, and neither writes a result to the board. In features and in size class they are matched; where they part is the chess they play. Of its 1,941 bytes of script, 1,212 are rules and interface and 729 the bot: the arbiter from this repository, cut down to those same three endings, with a search laid on top.

Given enough thinking time mine plays the stronger game. Comparing the two on milliseconds alone would mislead, though, because the searches run on different principles: Toledo's goes to a fixed depth and answers in single-digit milliseconds, while mine deepens iteratively and spends whatever budget it is given, which can reach half a second. Grant both the same budget and the comparison becomes fair; at the board, neither delay registers as a wait. Toledo's build has stood since 2009, and the point of this file is not to beat it but to see how far an arbiter engine can play under the same rules and in the same byte range.

**[`2kbfullfidejs.com_index.html`](extra/2kbfullfidejs.com_index.html)** and **[`2kbfullfidejs.com_README.md`](extra/2kbfullfidejs.com_README.md)** — the earlier project: a single-page generator that emits standalone engines of roughly 0.6–2.7 KB, one per option combination. FEN entry, a bot with adjustable strength, Chess960, a FIDE/USCF switch, four clock models with multi-period controls, and rule levels running from full FIDE down to capture-the-king. The site is pure frontend, so its source is one view-source away; the repository is private for now, so its README is included here — the full account of the architecture, the rule sets, the clocks and the optimisation log. All of it is coming to fidelite.art as I get it into shape, and this file goes when it does.

## The bot builds

The core of this repository is an arbiter, and it stays that way: evaluation and search sit on top of the engine, never inside it. But what comes out when a search is laid on that core is measured too, and that side is a claim of its own.

The build currently on the site, `L2_aybars.html`, is the first of these: **7,168 bytes** — exactly 7 KiB — in one file. Of that, the arbiter and the interface are the same core as `L2`, and the rest is the bot: alpha-beta with iterative deepening, a transposition table, killer and history heuristics, incremental Zobrist hashing and a tapered evaluation. In testing it held its own against Stockfish set to 2000. On the site it has only a short row in the builds table for now; neither its architecture nor the measurement method has been written up.

That write-up is waiting on purpose. The build I am working on is the stronger one — again a single HTML file, this time aiming at **3000 elo**. When it is finished it will be the most ambitious thing in this repository, and at that point the 2000 build will get the detail it deserves, elo reports included. For now it is in progress, and I am moving it forward as time allows. When it is done it will take its place on the site along with its account.


---

# Türkçe

Tam FIDE kurallı satranç hakemi, 1.826 bayt saf JavaScript — tahtası ve arayüzüyle birlikte.
Kural motoru tek başına 1.945 bayt.

**→ [www.fidelite.art/tr](https://www.fidelite.art/tr)**

## Ne bu

İki insan aynı ekranda oynar. Motor hamle önermez, oyunu yönetir: tek işi hamlenin kurallara uygun olup olmadığına ve oyunun bitip bitmediğine karar vermektir. Değerlendirme fonksiyonu, arama ağacı, açılış kitabı yok — bu bir bot motoru değil, hakem motoru.

Rok, geçerken alma, seçimli terfi, pat, yetersiz materyal, üçlü ve beşli tekrar, 50/75 hamle, karşılıklı anlaşma, süre ve terk eksiksiz uygulanır. **5.2.2'nin kilitli pozisyon hâli** — materyalin yeterli olduğu ama matın yine de imkânsız olduğu durum — artık kısmen uygulanıyor. Tahtada yalnız şah ve piyon kaldığında motor pozisyonun kilitli olup olmadığına karar veriyor; ölçülen kapsama **%93**, kaçan yüzde yedinin tamamı fil içeriyor. Yönü de sayı kadar önemli: kaçırılan beraberlik var, uydurulan beraberlik yok. Filli vakaların neredeyse tamamını kapsayan bir genişletme tasarlandı ve ölçüldü — kapsamayı %99,94'e çıkarıyordu — ama golf edilmiş hâli bile bin bayta yakın tuttu, yani programın yarısından fazlası, ve %99,94 de kanıtlanmış bir sınır değil ölçülmüş bir sayı. Askıda, kaybolmuş değil. [Gerekçenin tamamı sitede.](https://www.fidelite.art/tr#dead)

`builds/` altındaki her dosya tek başına çalışır — kütüphane yok, kurulum yok, sunucu yok. Bir HTML dosyasını indirip çift tıklamak yeterli.

Oradaki üç JavaScript dosyası motorun önyüzsüz hâli: `engine.js` (1.945 bayt), `engine_4x.js` (aynı kurallar, +48 bayt, iki ilâ on altı kat hız) ve `engine_onlyMoveGenerator.js` (yalnız hamle üretimi, test süiti için). Site bu dosyaları canlı okuyor ve ayrıntısıyla belgeliyor — [yapı ve sürücü API'si](https://www.fidelite.art/tr#engine), [satır satır](https://www.fidelite.art/tr#flow), [hız ölçümleri](https://www.fidelite.art/tr#speed).

## Sürümler

`builds/` altında sitenin önünüze koyduğu dört sürüm var, arayüze göre değil **kural seviyesine** göre dizilmiş:

| sürüm | ne uyguluyor | bayt |
|---|---|---|
| `L1.html` | yalnız legallik — hamle, şah, mat, pat | 1.598 |
| `L2.html` | + sayaçlar ve kendiliğinden gelen beraberlikler | 2.324 |
| `L3.html` | tam hakem — saat, talep, terk, bayrak düşmesi | 3.227 |
| `L2_aybars.html` | `L2`'nin üstüne konmuş bot | 7.168 |

`special/` aynı kural seviyelerinin farklı arayüzlerle giyinmiş hâllerini taşıyor. Hepsi tek başına çalışıyor ve hepsinin altında aynı hakem duruyor — değişen tek şey hamlenin nasıl girdiği ve tahtanın nasıl çıktığı.

`special/L3/` tam hakemi beş ayrı biçimde taşıyor: `numerical.html` hamleyi iki basamaklı kare numarası olarak `prompt()` penceresinden alıyor, `prompt.html` aynı pencereden UCI ile alıyor, `input.html` sayfadaki bir metin alanından UCI ile alıyor, `input_blindfold.html` da aynısını yapıp tahtayı hiç çizmiyor. Yanlarında kendi kendini açan iki RegPack sürümü duruyor: `dom_packed.html` (2.755 bayt) ve `numerical_packed.html` (**1.826 bayt** — buradaki en küçük tam FIDE hakemi).

`special/L2/` ile `special/L1/` aynı fikri bir ve iki seviye aşağıda tekrarlıyor; `special/L1/` ayrıca iki Toledo karşılaştırma dosyasını da barındırıyor.

Paketlenmiş ikili, ekrandan kopyalanamayacak tek dosyalar: sözlük anahtarları `\x01`–`\x1f` aralığındaki denetim karakterleri, ve pano ya da bir editörün satır sonu düzeltmesi onları bozuyor. O ikisini indirin.

## Belgeler

| konu | bağlantı |
|---|---|
| Motorun yapısı — tahta temsili, durum, sürücü API'si | [/tr#engine](https://www.fidelite.art/tr#engine) |
| Değişken haritası — 36 isim, gölgelemeler, boşta harfler | [/tr#names](https://www.fidelite.art/tr#names) |
| Denenip elenen mimariler | [/tr#alternatives](https://www.fidelite.art/tr#alternatives) |
| Satır satır kod çözümlemesi | [/tr#flow](https://www.fidelite.art/tr#flow) |
| Resmî oyun kuralları ve 5.2.2 | [/tr#rules](https://www.fidelite.art/tr#rules) |
| On beş sonuç kodu, FIDE–USCF farkı | [/tr#codes](https://www.fidelite.art/tr#codes) |
| Sürüm karşılaştırması ve `engine_4x` ölçümleri | [/tr#builds](https://www.fidelite.art/tr#builds) · [/tr#speed](https://www.fidelite.art/tr#speed) |
| Paketleme, RegPack ayrıntıları, `dom` istisnası | [/tr#packing](https://www.fidelite.art/tr#packing) |
| Perft testleri, doğrulama ve testleri kendiniz koşmak | [/tr#tests](https://www.fidelite.art/tr#tests) |
| Tuzaklar ve kırılgan yerler | [/tr#pitfalls](https://www.fidelite.art/tr#pitfalls) |

## `extra/`

*Buradaki iki Toledo dosyası artık `special/L1/` altında; bağlantılar oraya gidiyor.*


Motorun içinde değil, yanında duran malzeme. Her dosya tek başına çalışır — tarayıcıda açmak yeterli.

**[`Absolute_Distance.html`](extra/Absolute_Distance.html)** — 8×8 ızgara; bir kareye tıklıyorsunuz, seçtiğiniz uzaklıktaki bütün kareler yanıyor. Değerler ondalık (`2.24`) ya da radikal (`sqrt5`, `2sqrt2`, `√5`, `v8`) kabul ediyor, grup başına birden çok değer girilebiliyor, istediğiniz kadar grup ekleniyor. Sitedeki [Öklid uzaklığı tasarımının](https://www.fidelite.art/tr#alternatives) arkasındaki simülasyon bu — kalenin (0,5)'i (3,4) ile çarpışana dek kusursuz görünen tasarımın.

**[`Board_Delta_Index.html`](extra/Board_Delta_Index.html)** — aynı sorunun ters yönden sorulmuş hâli: hareketi uzaklık yerine indeks farkı olarak tanımlamak. Tahta boyutu serbest, satır ve sütun sayısı istediğiniz kadar; böylece sekiz genişlikte tutan bir kuralın yedide veya dokuzda nasıl kırıldığı gözle görülüyor. Delta grupları, negatifi de katmak için `±`, katlarını katmak için `mul`, ters indeksleme, alan seçimi.

İkisi de yayımlanmak için değil, sezgi kurmak için yazıldı: amaç bir taşın erişimini kâğıt üzerinde türetmek değil, *görmek*.

**[`Chess960_Skeletons.html`](extra/Chess960_Skeletons.html)** — 56 kale–şah–kale iskeletinin tamamı, canlı üretiliyor. Fischer rastgele satrançta rok yalnızca şahın ve iki kalesinin hangi dosyalarda durduğuna bağlı, şah da her zaman kalelerin arasında; dolayısıyla C(8,3)=56 iskelet 960 dizilimin hepsini kapsıyor. Her kart bir iskeleti ve o iskelet üzerine kurulan bütün Scharnagl numaralarını taşıyor, klasik başlangıç olan #518 işaretli.

**[`Toledos-ES6-optimized.html`](special/L1/Toledos-ES6-optimized.html)** — bana ait değil, buradaki tek yabancı. Óscar Toledo'nun [Toledo Javascript Chess](https://nanochess.org/) çalışması, Unicode taşlı varyant, 2.299 bayt: tam bir satranç yapay zekâsı, tahtası ve arayüzüyle birlikte o kadarcık yere sıkıştırılmış, ve karşısına oturanların çoğunu yenecek durumda. Muazzam sıkıştırılmış bir mühendislik harikası, ve hayranı olduğum bir iş. Buradaki, o sürümün ES6 metodlarıyla — ok fonksiyonları, varsayılan parametreler, şablon dizeleri — yeniden yazılmış ve modern tarayıcı için yeniden optimize edilmiş hâli: glifler ve yazılar büyütülmüş, hâlâ quirks modda, içerik aynı, **1.989 karakter** — 1.932'si kod, 57'si telif satırı; Toledo'nun 2.299'u da kendi telif satırını içeriyor, yani ölçü aynı temelde. Bayt değil karakter: taş glifleri UTF-8'de çok baytlı olduğu için dosya diskte BOM'uyla birlikte 2.013 bayt. Bu repodaki motorun tam zıddı, ve yanında durmasının sebebi de bu: Toledo'nunki arar, FideLite hakemlik eder.

**[`ToledosOpponentbyMe.html`](special/L1/ToledosOpponentbyMe.html)** — bir üstekinin karşısına konmak üzere yazılmış sürüm, **2.062 bayt**; sitede yok, yalnızca bu karşılaştırma için var. İki dosya aynı kural setini uyguluyor: rok, geçerken alma, seçimli terfi, ve üç bitiş — beyaz mat eder, siyah mat eder, pat. Ötesinde kural yok; ikisinde de saat, tekrar, 50 hamle, beraberlik teklifi ve terk bulunmuyor, ve ikisi de oyun sonucunu ekrana yazmıyor. Yani özellik ve boyut sınıfı olarak denkler; ayrıldıkları yer oynadıkları satranç. Dosyanın 1.941 baytlık script'inin 1.212 baytı kural ve arayüz, 729 baytı bot: bu repodaki hakem, aynı üç bitişe indirgenmiş hâliyle, üstüne bir arama konarak.

Yeterli düşünme süresi verildiğinde benimki daha güçlü oynuyor. Ama ikisini salt milisaniyeye bakarak karşılaştırmak yanıltıcı olur, çünkü aramalar farklı ilkeyle sürüyor: Toledo'nunki sabit derinlikte arayıp tek haneli milisaniyelerde cevap veriyor, benimki artan derinlikle arayıp kendine ayrılan süreyi kullanıyor ve bu yarım saniyeyi bulabiliyor. İkisine aynı bütçe verildiğinde karşılaştırma âdil hâle geliyor; tahta başında ise iki gecikme de bekleme olarak fark edilmiyor. Toledo'nunki 2009'dan beri ayakta duran bir iş, ve bu dosyanın amacı onu yenmek değil — aynı kurallarla ve aynı bayt aralığında bir hakem motorunun ne kadar oynayabildiğini görmek.

**[`2kbfullfidejs.com_index.html`](extra/2kbfullfidejs.com_index.html)** ve **[`2kbfullfidejs.com_README.md`](extra/2kbfullfidejs.com_README.md)** — önceki proje: seçenek kombinasyonu başına bir tane olmak üzere, yaklaşık 0,6–2,7 KB'lık bağımsız motorlar üreten tek sayfalık bir jeneratör. FEN girme, gücü ayarlanabilen bot, Chess960, FIDE/USCF anahtarı, dört saat modeli ve çok periyotlu zaman kontrolleri, tam FIDE'den şah-yeme varyantına inen kural seviyeleri. Site tamamen frontend, yani kaynağı bir "sayfa kaynağını görüntüle" uzağınızda; repo şimdilik private olduğu için README'si buraya kondu — mimarinin, kural setlerinin, saatlerin ve optimizasyon günlüğünün tam dökümü. Toparladıkça hepsi fidelite.art'a taşınacak, o zaman bu dosya da gidecek.


## Botlu sürümler

Bu deponun çekirdeği hakem, ve öyle kalıyor: değerlendirme ve arama motorun içinde değil, üstünde duruyor. Ama aynı çekirdeğin üstüne bir arama konduğunda ne çıktığı da ölçülüyor, ve o taraf ayrı bir iddia.

Şu an sitede duran `L2_aybars.html` bunun ilk örneği: **7.168 bayt** — tam 7 KiB — tek dosya. Hakem ve arayüz `L2` ile aynı çekirdek, kalanı bot: artan derinlikli alfa-beta, transpozisyon tablosu, killer ve history sezgileri, artımlı Zobrist hash ve kademeli değerlendirme. Ölçümlerde Stockfish'in 2000 seviyesiyle başa baş güç gösterdi. Sitede şimdilik yalnızca sürümler tablosunda kısa bir satırı var; ne mimarisi ne de ölçüm yöntemi anlatılmış değil.

Tanıtımı bilerek bekliyor. Üzerinde çalıştığım asıl sürüm daha güçlüsü — yine tek HTML dosyası, hedef **3000 elo**. Bittiğinde bu depodaki en iddialı iş o olacak, ve o zaman 2000'lik sürümü de hak ettiği ayrıntıyla, elo raporlarıyla birlikte yayımlayacağım. Şimdilik yapım aşamasında; vakit buldukça ilerliyorum. Tamamlandığında açıklamasıyla birlikte sitede yerini alacak.
