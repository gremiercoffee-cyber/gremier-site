/* Card payment without leaving the site: PayMe's secure payment page opens in a sheet
   over the checkout instead of replacing the whole page. When PayMe sends the buyer back
   (/?payment=return…), the frame hands that address to the main window (see the first
   script in index.html), and the normal confirmation runs there. */
(function () {
  'use strict';
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);

  // Trial switch until a real payment has gone through the sheet: open the site once with
  // ?paysheet=1 to use it on that device (?paysheet=0 turns it off). Everyone else is redirected as before.
  const FLAG = 'gremier_pay_sheet';
  try {
    const q = new URLSearchParams(location.search).get('paysheet');
    if (q === '1') localStorage.setItem(FLAG, '1');
    if (q === '0') localStorage.removeItem(FLAG);
  } catch (_) {}
  const enabled = () => { try { return localStorage.getItem(FLAG) === '1'; } catch (_) { return false; } };

  function sheet() {
    let el = document.getElementById('payFrame');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'payFrame';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="pf-box">
        <div class="pf-head">
          <span class="pf-title"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span class="pf-title-text"></span></span>
          <button type="button" class="pf-close">×</button>
        </div>
        <div class="pf-body"><div class="spinner pf-spin"></div><iframe title="PayMe" allow="payment *" referrerpolicy="origin"></iframe></div>
        <a class="pf-out" target="_top"></a>
      </div>`;
    el.querySelector('.pf-close').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    el.querySelector('iframe').addEventListener('load', () => el.classList.add('loaded'));
    document.body.appendChild(el);
    return el;
  }

  function close() {
    const el = document.getElementById('payFrame');
    if (!el) return;
    el.classList.remove('open', 'loaded');
    el.querySelector('iframe').src = 'about:blank';
    document.documentElement.classList.remove('pf-lock');
  }

  window.GremierPay = {
    /** Show PayMe's page in the sheet. Our own addresses (e.g. a saved-card payment that
        already completed) still load as a normal page. */
    open(url) {
      let target;
      try { target = new URL(url, location.href); } catch (_) { location.href = url; return; }
      if (!enabled() || target.origin === location.origin || !/(^|\.)payme(service)?\.(io|com)$/i.test(target.hostname)) {
        location.href = url;
        return;
      }
      const el = sheet();
      el.setAttribute('aria-label', T('Secure payment', 'תשלום מאובטח'));
      el.querySelector('.pf-title-text').textContent = T('Secure payment · PayMe', 'תשלום מאובטח · PayMe');
      el.querySelector('.pf-close').setAttribute('aria-label', T('Close payment', 'סגירת התשלום'));
      const out = el.querySelector('.pf-out');
      out.href = url;
      out.textContent = T('Trouble paying? Open the payment page', 'בעיה בתשלום? לפתיחת דף התשלום');
      el.classList.remove('loaded');
      el.querySelector('iframe').src = url;
      el.classList.toggle('rtl', he());
      el.classList.add('open');
      document.documentElement.classList.add('pf-lock');
    },
    close,
  };
  // The frame reports PayMe's return address; finish there in the main window.
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'gremier-payme-return') return;
    let url;
    try { url = new URL(e.data.url); } catch (_) { return; }
    if (url.origin !== location.origin || !/[?&]payment=return/.test(url.search)) return;
    location.replace(url.href);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('payFrame')?.classList.contains('open')) close();
  });
})();
