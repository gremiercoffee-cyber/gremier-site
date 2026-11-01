/* Home hero "film": eight product stills, each with a slow camera move (pan / push in), crossfading
   into the next. Under the headline, the width of the two discovery cards. A tap opens the shop (or
   coffee bars on the last shot). Reduced motion: no camera moves, just a slow crossfade.
   Not live yet: shown only with ?hero=preview (remembered for the visit) until LIVE is true. */
(function () {
  'use strict';
  const LIVE = false;
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  let preview = false;
  try {
    if (new URLSearchParams(location.search).get('hero') === 'preview') sessionStorage.setItem('gremier_hero_preview', '1');
    preview = sessionStorage.getItem('gremier_hero_preview') === '1';
  } catch (_) {}
  if (!LIVE && !preview) return;

  // [file, English caption, Hebrew caption, page, move from → to as [scale, x%, y%], optional framing (object-position)]
  // Each shot drifts on a diagonal while slowly zooming in, in a different direction from the one before;
  // on the tall bottle shots the drift rises toward the cap, so caps and labels stay in the frame.
  // The image can move (scale − 1) / 2 of its size each way before an edge shows; every move stays inside that.
  const SHOTS = [
    ['01-lineup', 'Five cold brews, one favourite', 'חמישה קולד ברו, אחד אהוב', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['02-classic', 'Classic Dark Roast · smooth & strong', 'קלאסיק קלייה כהה · חלק וחזק', 'shop', [1.03, -1.5, -1], [1.1, 4, 3]],
    ['04-colombia', 'Colombia Light Roast · bright & fruity', 'קולומביה קלייה בהירה · רענן ופירותי', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['05-sweetened', 'Sweetened Classic · add milk if you like', 'קלאסיק ממותק · עם חלב, אם בא לכם', 'shop', [1.03, -1.5, -1], [1.1, 4, 3]],
    ['06-syrups', 'Vanilla Bean & Caramel syrups', 'סירופ וניל ושל קרמל', 'shop', [1.03, 1.5, 1], [1.1, -4, -3]],
    ['07-minis', 'Cremier minis · grab and go', 'קרמייר מיני · לוקחים והולכים', 'shop', [1.03, -1.5, 1], [1.1, 4, -3]],
    ['08-five-liter', '5 litres for the office or family', '5 ליטר למשרד או למשפחה', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['09-coffee-bar', 'Coffee bars for your event', 'עמדות קפה לאירוע שלכם', 'coffeebars', [1.03, -1.5, -1], [1.1, 4, 3]],
  ];
  const HOLD = 5600, FADE = 1200;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
  .hero-film{position:relative;max-width:900px;margin:4px auto 26px;aspect-ratio:3/2;border-radius:22px;overflow:hidden;background:#ece6dd;cursor:pointer;isolation:isolate}
  .hero-film-shot{position:absolute;inset:0;opacity:0;transition:opacity ${FADE}ms ease}
  .hero-film-shot.on{opacity:1}
  .hero-film-shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:transform}
  .hero-film-cap{position:absolute;inset-inline-start:18px;bottom:16px;z-index:2;background:rgba(255,255,255,.88);backdrop-filter:blur(6px);color:#1a1a1a;font-size:.86rem;font-weight:600;padding:8px 14px;border-radius:999px;box-shadow:0 2px 12px rgba(0,0,0,.08);transition:opacity .4s}
  .hero-film-dots{position:absolute;inset-inline-end:18px;bottom:20px;z-index:2;display:flex;gap:6px}
  .hero-film-dots button{width:8px;height:8px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.6);cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
  .hero-film-dots button[aria-current="true"]{background:#fff;width:20px;border-radius:4px}
  @media(max-width:948px){.hero-film{margin:4px 24px 22px}}
  @media(max-width:640px){.hero-film{margin:0 16px 18px;aspect-ratio:4/5;border-radius:18px}.hero-film-cap{font-size:.78rem;inset-inline-start:12px;bottom:12px;max-width:calc(100% - 24px)}.hero-film-dots{inset-inline-end:auto;inset-inline-start:50%;transform:translateX(-50%);top:12px;bottom:auto}}`;
  document.head.appendChild(css);

  function build() {
    const hero = document.querySelector('#homePage .hero');
    if (!hero || document.querySelector('.hero-film')) return;
    const film = document.createElement('div');
    film.className = 'hero-film'; film.setAttribute('role', 'region'); film.setAttribute('aria-roledescription', 'carousel');
    film.innerHTML = SHOTS.map(([f, , , , , , focus], i) => `<div class="hero-film-shot${i ? '' : ' on'}"><img alt="" decoding="async"${focus ? ` style="object-position:${focus}"` : ''} ${i ? 'loading="lazy"' : 'fetchpriority="high"'} sizes="(max-width:948px) 100vw, 900px" srcset="/hero/${f}-900.webp 900w, /hero/${f}.webp 1536w" src="/hero/${f}.webp"></div>`).join('')
      + `<div class="hero-film-cap" aria-live="polite"></div><div class="hero-film-dots">${SHOTS.map((_, i) => `<button type="button" aria-label="${i + 1}"></button>`).join('')}</div>`;
    hero.insertAdjacentElement('afterend', film);
    const shots = [...film.querySelectorAll('.hero-film-shot')], cap = film.querySelector('.hero-film-cap'), dots = [...film.querySelectorAll('.hero-film-dots button')];
    let i = 0, timer = null, anim = null;
    const t = ([s, x, y]) => `translate(${x}%, ${y}%) scale(${s})`;
    function show(n) {
      shots[i].classList.remove('on');
      i = (n + SHOTS.length) % SHOTS.length;
      const [, en, hebrew, , from, to] = SHOTS[i], img = shots[i].querySelector('img');
      // Warm up the next photo so it's ready before its turn.
      const next = shots[(i + 1) % SHOTS.length].querySelector('img'); if (next.loading === 'lazy') next.loading = 'eager';
      shots[i].classList.add('on');
      cap.textContent = he() ? hebrew : en;
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
      film.setAttribute('aria-label', he() ? hebrew : en);
      if (!still && img.animate) { anim = img.animate([{ transform: t(from) }, { transform: t(to) }], { duration: HOLD + FADE * 2, easing: 'ease-in-out', fill: 'both' }); }
      clearTimeout(timer); timer = setTimeout(() => show(i + 1), HOLD + (still ? 1500 : 0));
    }
    dots.forEach((d, k) => d.onclick = (e) => { e.stopPropagation(); show(k); });
    film.onclick = () => { if (typeof showPage === 'function') showPage(SHOTS[i][3]); };
    // Pause while it's off screen or the tab is hidden.
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!timer) show(i); } else { clearTimeout(timer); timer = null; anim?.pause(); } }) : null;
    show(0);
    io?.observe(film);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; anim?.pause(); } else if (!timer) show(i); });
    // Captions follow the language switch.
    const toggle = window.toggleLang;
    if (typeof toggle === 'function') window.toggleLang = function () { const r = toggle.apply(this, arguments); cap.textContent = he() ? SHOTS[i][2] : SHOTS[i][1]; return r; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
