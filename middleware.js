/* Konum tabanlı dil yönlendirmesi — Vercel Routing Middleware.
 *
 * Kök URL (/) İngilizce. Türkiye'den gelen ve daha önce kendi dilini
 * seçmemiş ziyaretçi /tr'ye gider.
 *
 * Üç şey bilerek böyle:
 *   1) Yalnızca / üzerinde çalışır. /tr'ye hiç dokunmaz, yani her iki URL
 *      de doğrudan taranabilir kalır — hreflang zinciri kopmaz.
 *   2) fl-lang çerezi varsa konuma bakılmaz. Kullanıcının açık seçimi
 *      her zaman coğrafyayı yener.
 *   3) 307 (geçici). Kalıcı yönlendirme önbelleğe girer ve aynı URL'i
 *      başka konumdan açan ziyaretçiyi de yanlış dile kilitler.
 *
 * Googlebot ağırlıklı olarak ABD'den tarıyor, dolayısıyla kökü İngilizce
 * görür — canonical'ın söylediğiyle aynı.
 */

export const config = { matcher: '/' };

export default function middleware(request) {
  const cookie = request.headers.get('cookie') || '';
  const pref = /(?:^|;\s*)fl-lang=(tr|en)/.exec(cookie);

  if (pref) {
    if (pref[1] === 'en') return;              /* açık tercih: kökte kal */
  } else if (request.headers.get('x-vercel-ip-country') !== 'TR') {
    return;                                     /* Türkiye dışı: kökte kal */
  }

  const url = new URL(request.url);
  url.pathname = '/tr';
  return Response.redirect(url, 307);
}
