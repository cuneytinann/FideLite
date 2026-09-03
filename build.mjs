#!/usr/bin/env node
/* build.mjs — index.html'den dil basina tek statik dosya uretir.
 *
 *   index.html  (master, iki dil bir arada)
 *        |
 *        +--> dist/index.html      Turkce  — canonical /
 *        +--> dist/en/index.html   Ingilizce — canonical /en
 *
 * Her ciktida karsi dilin blogu DOM'dan tamamen cikarilir. Boylece:
 *   - <title>, <meta description> ve <html lang> sunucudan dogru gelir
 *   - tarayicinin JS calistirmasi gerekmez, sosyal medya onizlemeleri duzelir
 *   - her URL'in metni tek dilli, yani icerik belirsiz degil
 *   - dosya ~yariya iner
 *
 * Bagimlilik yok. Kullanim:  node build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const SITE = 'https://www.fidelite.art';
const SRC  = 'index.html';
const OUT  = 'dist';

const VOID = new Set(['area','base','br','col','embed','hr','img','input',
                      'link','meta','source','track','wbr']);

/* ---------------------------------------------------------------- yardimcilar */

/** Bir baslangic etiketinin attribute'larini okur. i = '<' konumu. */
function readTag(src, i) {
  const m = /^<([a-zA-Z][\w-]*)/.exec(src.slice(i, i + 40));
  if (!m) return null;
  const name = m[1].toLowerCase();
  let j = i + m[0].length, attrs = [];
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '>') { j++; break; }
    if (src[j] === '/' && src[j + 1] === '>') { j += 2; break; }
    const a = /^([^\s=/>]+)/.exec(src.slice(j));
    if (!a) { j++; continue; }
    const key = a[1];
    j += a[1].length;
    let val = null, vs = -1, ve = -1;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '=') {
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        vs = j + 1; ve = src.indexOf(q, vs); val = src.slice(vs, ve); j = ve + 1;
      } else {
        vs = j; while (j < src.length && !/[\s>]/.test(src[j])) j++;
        ve = j; val = src.slice(vs, ve);
      }
    }
    attrs.push({ key, val, start: j - (val === null ? key.length : 0) });
  }
  return { name, attrs, end: j, selfClosing: VOID.has(name) || src[j - 2] === '/' };
}

/** i'deki baslangic etiketinin kapanisindan sonraki konumu bulur. */
function endOfElement(src, i, tag) {
  const t = readTag(src, i);
  if (!t) return -1;
  if (t.selfClosing) return t.end;
  const re = new RegExp('<(/?)' + tag + '(?=[\\s/>])', 'gi');
  re.lastIndex = t.end;
  let depth = 1, m;
  while ((m = re.exec(src))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const gt = src.indexOf('>', re.lastIndex);
      return gt < 0 ? -1 : gt + 1;
    }
  }
  return -1;
}

/** body icindeki lang="drop" tasiyan butun elementleri kaldirir. */
function stripLang(html, drop) {
  const bodyAt = html.indexOf('<body>');
  let out = html, removed = 0;
  for (;;) {
    const re = new RegExp('<[a-zA-Z][\\w-]*[^>]*\\slang="' + drop + '"', 'g');
    re.lastIndex = bodyAt;
    const m = re.exec(out);
    if (!m) break;
    const t = readTag(out, m.index);
    const end = endOfElement(out, m.index, t.name);
    if (end < 0) throw new Error('kapanmayan <' + t.name + '> @' + m.index);
    /* Onundeki girintiyi de al ki bos satir kalmasin. */
    let s = m.index;
    while (s > 0 && (out[s - 1] === ' ' || out[s - 1] === '\t')) s--;
    let e = end;
    if (out[e] === '\n') e++;
    out = out.slice(0, s) + out.slice(e);
    removed++;
  }
  return { html: out, removed };
}

/** data-en-* ikizlerini uygular (en) ya da siler (tr). */
function resolveAttrs(html, lang) {
  const ATTRS = ['aria-label', 'title', 'alt'];
  let out = html, applied = 0;
  for (const a of ATTRS) {
    const re = new RegExp('\\sdata-en-' + a + '="([^"]*)"', 'g');
    out = out.replace(re, (full, v) => {
      applied++;
      return lang === 'en' ? '\u0000EN:' + a + '=' + v + '\u0000' : '';
    });
  }
  if (lang === 'en') {
    /* Isaretlenen yerlerde asil attribute'u degistir, isareti sil. */
    out = out.replace(/\u0000EN:([a-z-]+)=([^\u0000]*)\u0000/g, (f, a, v) => {
      return '\u0001' + a + '\u0002' + v + '\u0003';
    });
    for (const a of ATTRS) {
      const re = new RegExp('\\s' + a + '="[^"]*"([^>]*?)\\u0001' + a + '\\u0002([^\\u0003]*)\\u0003', 'g');
      out = out.replace(re, (f, mid, v) => ' ' + a + '="' + v + '"' + mid);
    }
    out = out.replace(/\u0001[a-z-]+\u0002([^\u0003]*)\u0003/g, '');
  }
  return { html: out, applied };
}

/* ---------------------------------------------------------------- FLT'den basliklar */

const src = readFileSync(SRC, 'utf8');
const fltAt = src.indexOf('var FLT = {');
if (fltAt < 0) throw new Error('FLT tablosu bulunamadi');
let d = 0, k = src.indexOf('{', fltAt);
const fltStart = k;
for (; k < src.length; k++) {
  if (src[k] === '{') d++;
  else if (src[k] === '}') { d--; if (!d) break; }
}
const FLT = (0, eval)('(' + src.slice(fltStart, k + 1) + ')');
for (const l of ['tr', 'en']) {
  if (!FLT[l]?.title || !FLT[l]?.desc) throw new Error(l + ' basligi eksik');
}

/* ---------------------------------------------------------------- uretim */

const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/* Kok Ingilizce: en cok paylasilan, en cok baglanti alan ve aramanin en
   yetkili saydigi adres o. Turkce /tr'de, konum tabanli yonlendirmeyle
   (middleware.js) ve dil seridiyle ulasilabiliyor. */
const TARGETS = [
  { lang: 'en', drop: 'tr', out: 'index.html',    url: SITE + '/',   alt: '/tr' },
  { lang: 'tr', drop: 'en', out: 'tr/index.html', url: SITE + '/tr', alt: '/'   },
];
const XDEFAULT = SITE + '/';

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

for (const t of TARGETS) {
  let h = src;

  const a = stripLang(h, t.drop);  h = a.html;
  const b = resolveAttrs(h, t.lang); h = b.html;

  /* Her degisiklik dogrulanir: sessizce eslesmeyen bir regex, dilin
     URL yerine tarayiciya gore secilmesine yol acar. */
  const must = (re, to, what) => {
    /* Yeni deger eskisiyle ayni olabilir (Turkce ciktida basliklar zaten
       Turkce), o yuzden "degisti mi" degil "eslesti mi" diye bakiyoruz. */
    if (!re.test(h)) throw new Error(t.lang + ': ' + what + ' eslesmedi');
    h = h.replace(re, to);
  };

  must(/^<html lang="[^"]*">/m,
       `<html lang="${t.lang}" data-lang="${t.lang}" data-alt-url="${t.alt}">`, '<html>');
  must(/<title>[^<]*<\/title>/, `<title>${esc(FLT[t.lang].title)}</title>`, '<title>');
  must(/<meta name="description" content="[^"]*">/,
       `<meta name="description" content="${esc(FLT[t.lang].desc)}">`, 'description');
  must(/<link rel="canonical" href="[^"]*">/,
       `<link rel="canonical" href="${t.url}">`, 'canonical');

  /* hreflang listesi TARGETS'tan uretiliyor ki elle tutulan bir kopya
     sessizce eskimesin. */
  must(/<!--hreflang-->[\s\S]*?<!--\/hreflang-->/,
       TARGETS.map(o => `<link rel="alternate" hreflang="${o.lang}" href="${o.url}">`).join('\n')
       + `\n<link rel="alternate" hreflang="x-default" href="${XDEFAULT}">`,
       'hreflang');

  /* Dil artik URL ile sabit. Head'deki sezme blogu kalirsa <html data-lang>'i
     tarayici diline gore ezer ve iki URL'in ayrimi bozulur. */
  const dStart = h.indexOf('/* Dil de boyamadan once cozulur');
  const dMark  = "document.documentElement.setAttribute('data-lang', l);";
  const dEnd   = h.indexOf(dMark, dStart);
  if (dStart < 0 || dEnd < 0) throw new Error(t.lang + ': head dil sezme blogu bulunamadi');
  h = h.slice(0, dStart)
    + '/* Dil URL ile sabit; sezme derleme sirasinda kaldirildi. */'
    + h.slice(dEnd + dMark.length);

  /* Capa id'leri: bir bolumun id'si yalnizca bir dilin ikizinde durabilir.
     Karsi dil hayatta kalinca id de onunla gelsin diye ikiz data-id tasir;
     strip'ten sonra hayatta kalan data-id gercek id'ye terfi eder. */
  h = h.replace(/ data-id="/g, ' id="');

  /* Tekrarli id kontrolu — data-id terfisi cakisma yaratmamali. */
  const seen = new Set();
  for (const m of h.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(m[1])) throw new Error(t.lang + ': tekrarli id "' + m[1] + '"');
    seen.add(m[1]);
  }
  /* Kirik ic baglanti kontrolu. */
  for (const m of h.matchAll(/href="#([^"]+)"/g)) {
    if (!seen.has(m[1])) throw new Error(t.lang + ': kirik ic baglanti #' + m[1]);
  }

  /* Varlik yollarini koke sabitle. /en URL'i bir dizin gibi ele alinirsa
     goreli yollar /en/images/... olur ve 404 verir; koke sabitlemek bu
     riski tamamen kaldirir. */
  let paths = 0;
  h = h.replace(/(\s(?:src|href)=")(images\/|icons\/|builds\/|special\/|test\.zip)/g,
                (f, p1, p2) => { paths++; return p1 + '/' + p2; });
  h = h.replace(/var DIR = 'builds\/';/, () => { paths++; return "var DIR = '/builds/';"; });

  /* Icerik ozeti. /images ve /icons uzun sureli ve immutable onbellekleniyor;
     ozet olmadan bir gorseli guncellemek ziyaretcide bir yil gorunmez kalir.
     URL degisince tarayici yeniden indirmek zorunda kalir. */
  let stamped = 0;
  h = h.replace(/((?:src|href)="\/(?:images|icons)\/[^"?]+)"/g, (full, path) => {
    const rel = path.replace(/^[^"]*"\//, '');   /* src="/images/x.svg  ->  images/x.svg */
    if (!existsSync(rel)) return full;            /* dosya yoksa dokunma */
    const v = createHash('sha1').update(readFileSync(rel)).digest('hex').slice(0, 8);
    stamped++;
    return path + '?v=' + v + '"';
  });

  const dest = join(OUT, t.out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, h);

  console.log(`${t.out.padEnd(15)} ${String(h.length).padStart(7)} bayt   ` +
              `-${a.removed} blok, ${b.applied} attr, ${paths} yol, ${stamped} ozet`);
}

/* Statik varliklar */
for (const dir of ['images', 'icons', 'builds', 'special']) {
  if (existsSync(dir)) cpSync(dir, join(OUT, dir), { recursive: true });
}
for (const f of ['test.zip', 'robots.txt']) {
  if (existsSync(f)) cpSync(f, join(OUT, f));
}

/* Sitemap */
writeFileSync(join(OUT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${TARGETS.map(t => `  <url>
    <loc>${t.url}</loc>
${TARGETS.map(o => `    <xhtml:link rel="alternate" hreflang="${o.lang}" href="${o.url}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${XDEFAULT}"/>
  </url>`).join('\n')}
</urlset>
`);

console.log('sitemap.xml    yazildi');
console.log('\ndist/ hazir.');
