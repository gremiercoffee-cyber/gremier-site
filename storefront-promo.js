/* Weekly delivery banner in the top bar (in place of the member banner on those days):
   Beit Shemesh free-delivery days (11–12 Nov 2026 only): that offer shows as a first line, above the weekly one.
   Tuesday and Wednesday: regular delivery to Jerusalem and Beit Shemesh arrives before Shabbat (shabbatPromoActive() in index.html).
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
  // This week's Beit Shemesh free-delivery days (beitShemeshFreeToday() in index.html) take the banner.
  const bsDays = () => (typeof BEIT_SHEMESH_FREE_DAYS !== 'undefined' ? BEIT_SHEMESH_FREE_DAYS : []);
  const israelDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const bsToday = () => typeof beitShemeshFreeToday === 'function' && beitShemeshFreeToday();
  // The weekly Shabbat line for today (Tue, Wed, Thu) or null.
  function kind() {
    const day = israelDay();
    if (day === 'Tue' || day === 'Wed') return day;
    if (day === 'Thu') return 'Thu';
    return null;
  }
  function closed() {
    try { return sessionStorage.getItem(KEY) === new Date().toDateString(); } catch (_) { return false; }
  }

  function weekly(k) {
    if (k === 'Thu') return T('Want it by Shabbat? Choose expedited delivery at checkout.', 'רוצים עד שבת? בחרו משלוח מהיר בקופה.');
    return k === 'Tue'
      ? T('Order by Wednesday, receive by Shabbat*', 'מזמינים עד רביעי, מקבלים עד שבת*')
      : T('Last day: order today, receive by Shabbat*', 'יום אחרון: מזמינים היום, מקבלים עד שבת*');
  }
  function html(k) {
    const shop = `<a class="promo-shop" onclick="showPage('shop')">${T('Shop now', 'לחנות')}</a>`;
    if (bsToday()) {
      const last = israelDate() === bsDays()[bsDays().length - 1];
      const bs = last
        ? T('Last day: free delivery to Beit Shemesh on every order', 'יום אחרון: משלוח חינם לבית שמש על כל הזמנה')
        : T('Free delivery to Beit Shemesh on every order, today and tomorrow', 'משלוח חינם לבית שמש על כל הזמנה, היום ומחר');
      // Both offers, one per line: the Beit Shemesh one, then this week's Shabbat one.
      if (k) return `<span class="promo-lines"><span>🚚 ${bs}</span><span>${k === 'Thu' ? '🚚' : '🕯️'} ${weekly(k)}</span></span>${shop}`;
      return `🚚 <span>${bs}</span>${shop}`;
    }
    return `${k === 'Thu' ? '🚚' : '🕯️'} <span>${weekly(k)}</span>${shop}`;
  }

  // The asterisk's note lives in the page footer, on the days the offer runs.
  function footnote() {
    const k = kind();
    let n = $('promoFootnote');
    if (!k || k === 'Thu') { n?.remove(); return; }
    const bottom = document.querySelector('footer .footer-bottom');
    if (!bottom) return;
    if (!n) { n = document.createElement('p'); n.id = 'promoFootnote'; n.className = 'promo-footnote'; bottom.before(n); }
    n.textContent = T('*Order by Wednesday, receive by Shabbat: applies to regular delivery to Jerusalem and Beit Shemesh', '*מזמינים עד רביעי, מקבלים עד שבת: בתוקף למשלוח רגיל לירושלים ולבית שמש');
  }

  function render() {
    const k = kind();
    const b = $('memberBanner');
    if ((!k && !bsToday()) || !b || closed()) return false;
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
    if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); if ($('memberBanner')?.classList.contains('promo')) render(); footnote(); return r; };
  }
  render();
  footnote();
})();
