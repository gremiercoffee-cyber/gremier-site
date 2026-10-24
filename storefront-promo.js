/* Weekly delivery banner in the top bar (in place of the member banner on those days):
   Tuesday and Wednesday: free delivery before Shabbat (shabbatPromoActive() in index.html).
   Thursday: choose expedited delivery to get it by Shabbat. Israel time. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const KEY = 'gremier_promo_banner_closed';

  function israelDay() {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date());
  }
  function kind() {
    const day = israelDay();
    if (day === 'Tue' || day === 'Wed') return day;
    if (day === 'Thu') return 'Thu';
    return null;
  }
  function closed() {
    try { return sessionStorage.getItem(KEY) === new Date().toDateString(); } catch (_) { return false; }
  }

  function html(k) {
    const shop = `<a class="promo-shop" onclick="showPage('shop')">${T('Shop now →', 'לחנות ←')}</a>`;
    if (k === 'Thu') {
      return `🚚 <span>${T('Want it by Shabbat? Choose expedited delivery at checkout.', 'רוצים עד שבת? בחרו משלוח מהיר בקופה.')}</span>${shop}`;
    }
    const main = k === 'Tue'
      ? T('Free delivery before Shabbat when you order by Wednesday*', 'משלוח חינם לפני שבת בהזמנה עד יום רביעי*')
      : T('Last day: free delivery before Shabbat. Order today*', 'יום אחרון: משלוח חינם לפני שבת. הזמינו היום*');
    return `🕯️ <span>${main}</span>${shop}
      <small class="promo-note">${T('*Guaranteed in Jerusalem and Beit Shemesh; elsewhere we\'ll do our best.', '*מובטח בירושלים ובבית שמש; בשאר הארץ כמיטב יכולתנו.')}</small>`;
  }

  function render() {
    const k = kind();
    const b = $('memberBanner');
    if (!k || !b || closed()) return false;
    b.classList.add('promo');
    b.innerHTML = `${html(k)}<button class="banner-close" onclick="dismissBanner()" aria-label="Close">×</button>`;
    b.classList.remove('hidden');
    document.body.classList.add('has-banner', 'promo-banner');
    fit();
    return true;
  }

  // The note can wrap to more lines than the member banner: push the nav down by the real height.
  function fit() {
    const b = $('memberBanner');
    if (b && !b.classList.contains('hidden')) document.body.style.setProperty('--promo-h', b.offsetHeight + 'px');
  }
  window.addEventListener('resize', fit);

  // The promo replaces the member banner for everyone, signed in or not, until closed for the day.
  const show = window.showMemberBanner;
  window.showMemberBanner = function () { if (!render() && typeof show === 'function') show.apply(this, arguments); };
  const hide = window.hideMemberBanner;
  window.hideMemberBanner = function () { if (!render() && typeof hide === 'function') hide.apply(this, arguments); };
  window.dismissBanner = function () {
    try { sessionStorage.setItem(KEY, new Date().toDateString()); } catch (_) {}
    $('memberBanner')?.classList.add('hidden');
    document.body.classList.remove('has-banner', 'promo-banner');
  };
  for (const fn of ['applyTranslations', 'toggleLang']) {
    const orig = window[fn];
    if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); if ($('memberBanner')?.classList.contains('promo')) render(); return r; };
  }
  render();
})();
