/* Home hero "film": an animated brand opening, seven product stills and a closing tilt shot, each with a slow camera move (pan / push in), crossfading
   into the next. Under the headline, the width of the two discovery cards. A tap opens the shop (or
   coffee bars on the last shot). Reduced motion: no camera moves, just a slow crossfade.
   LIVE turns it on for everyone; with LIVE false it shows only with ?hero=preview. */
(function () {
  'use strict';
  const LIVE = true;
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  let preview = false;
  try {
    if (new URLSearchParams(location.search).get('hero') === 'preview') sessionStorage.setItem('gremier_hero_preview', '1');
    preview = sessionStorage.getItem('gremier_hero_preview') === '1';
  } catch (_) {}
  if (!LIVE && !preview) return;
  // The minis BURST (quick flash + punch-in + a big word per beat) is shown only with ?burst=preview
  // until BURST_LIVE is true.
  const BURST_LIVE = false;
  let burstPreview = false;
  try {
    if (new URLSearchParams(location.search).get('burst') === 'preview') sessionStorage.setItem('gremier_burst_preview', '1');
    burstPreview = sessionStorage.getItem('gremier_burst_preview') === '1';
  } catch (_) {}

  // [file, English caption, Hebrew caption, page, move from → to as [scale, x%, y%], optional framing (object-position)]
  // Each shot drifts on a diagonal while slowly zooming in, in a different direction from the one before;
  // on the tall bottle shots the drift rises toward the cap, so caps and labels stay in the frame.
  // The image can move (scale − 1) / 2 of its size each way before an edge shows; every move stays inside that.
  const SHOTS = [
    // The opening: the brand graphic, animated (see INTRO below). No caption.
    ['00-intro', '', '', 'shop', [1, 0, 0], [1.06, 0, 0]],
    ['02-classic', 'Classic Dark Roast · smooth & strong', 'קלאסיק קלייה כהה · חלק וחזק', 'shop', [1.03, -1.5, -1], [1.1, 4, 3]],
    ['04-colombia', 'Colombia Light Roast · bright & fruity', 'קולומביה קלייה בהירה · רענן ופירותי', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['05-sweetened', 'Sweetened Classic · add milk if you like', 'קלאסיק ממותק · עם חלב, אם בא לכם', 'shop', [1.03, -1.5, -1], [1.1, 4, 3]],
    ['06-syrups', 'Vanilla Bean & Caramel syrups', 'סירופ וניל ושל קרמל', 'shop', [1.03, 1.5, 1], [1.1, -4, -3]],
    ['07-minis', 'Cremier minis · grab and go', 'קרמייר מיני · לוקחים והולכים', 'shop', [1.03, -1.5, 1], [1.1, 4, -3]],
    ['08-five-liter', '5 litres for the office or family', '5 ליטר למשרד או למשפחה', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['09-coffee-bar', 'Coffee bars for your event', 'עמדות קפה לאירוע שלכם', 'coffeebars', [1.03, -1.5, -1], [1.1, 4, 3]],
    // The burst: several photos in quick beats (BURST below), then into the closing shot. No caption.
    ['burst', '', '', 'shop', [1, 0, 0], [1, 0, 0]],
    // The closing shot is a tall photo with its own words: the camera tilts down it (TILT below). No caption.
    ['10-elevate', '', '', 'shop', [1.02, 0, 0], [1.08, 0, 0], '50% 0%'],
  ];
  // Bump when a photo is replaced, so browsers fetch the new one instead of a cached copy.
  const IMG_V = '20261103c';
  const HOLD = 5600, FADE = 1200, INTRO_HOLD = 7400;
  // Photos whose files aren't the usual 900 / 1536 wide. TILT: tall photos the camera tilts down (top to bottom).
  const SIZES = { '10-elevate': [720, 1024] }, TILT = { '10-elevate': 7200 };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // BURST: each beat flashes white, the photo punches in (zoomed, a little blurred, alternating sides)
  // and settles, and a big word slams in, then snaps out before the next flash.
  // The photos are stand-ins until the single minis shots are made.
  const BEAT = 850;
  const BURST = [
    ['07-minis', 'GRAB.', 'חוטפים.'],
    ['06-syrups', 'CHILL.', 'מצננים.'],
    ['02-classic', 'SIP.', 'לוגמים.'],
    ['05-sweetened', 'REPEAT.', 'שוב.'],
  ];
  if (still || !(BURST_LIVE || burstPreview)) SHOTS.splice(SHOTS.findIndex((x) => x[0] === 'burst'), 1);

  const css = document.createElement('style');
  css.textContent = `
  .hero-film{position:relative;max-width:900px;margin:4px auto 26px;aspect-ratio:3/2;border-radius:22px;overflow:hidden;background:#ece6dd;cursor:pointer;isolation:isolate;container-type:size}
  /* INTRO: the brand graphic (widened with its own paper on computers; the square original on phones,
     where it fills the taller frame). It reveals top to bottom, a warm glint sweeps across the logo,
     and the side light breathes. */
  .hero-film-intro{background:#0f0c0a}
  .hi-stage{position:absolute;inset:0;will-change:transform}
  .hi-art{position:absolute;inset:0}
  .hi-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;-webkit-mask-image:linear-gradient(#000 40%,transparent 60%);mask-image:linear-gradient(#000 40%,transparent 60%);-webkit-mask-size:100% 300%;mask-size:100% 300%;-webkit-mask-position:0 0;mask-position:0 0}
  .hi-glint{position:absolute;inset:0;background:linear-gradient(110deg,transparent 36%,rgba(255,222,176,.22) 47%,rgba(255,238,206,.42) 50%,rgba(255,222,176,.22) 53%,transparent 64%);background-size:300% 100%;background-position:120% 0;mix-blend-mode:screen;opacity:0;pointer-events:none}
  .hi-glow{position:absolute;inset:0;background:radial-gradient(55% 75% at 6% 45%,rgba(255,146,56,.38),transparent 70%);mix-blend-mode:screen;opacity:.35;pointer-events:none}
  .hero-film-intro.play .hi-art img{animation:hiReveal 2.4s cubic-bezier(.3,.6,.3,1) both}
  .hero-film-intro.play .hi-glint{animation:hiGlint 2.6s ease-in-out 2.1s both}
  .hero-film-intro.play .hi-glow{animation:hiGlow 3.6s ease-in-out infinite alternate}
  @keyframes hiReveal{from{-webkit-mask-position:0 100%;mask-position:0 100%;filter:brightness(.55)}to{-webkit-mask-position:0 0;mask-position:0 0;filter:brightness(1)}}
  @keyframes hiGlint{0%{background-position:120% 0;opacity:0}20%{opacity:1}80%{opacity:1}100%{background-position:-20% 0;opacity:0}}
  @keyframes hiGlow{from{opacity:.22}to{opacity:.7}}
  @media(prefers-reduced-motion:reduce){.hero-film-intro.play .hi-art img,.hero-film-intro.play .hi-glint,.hero-film-intro.play .hi-glow{animation:none}}
  .hero-film-shot{position:absolute;inset:0;opacity:0;transition:opacity ${FADE}ms ease}
  .hero-film-shot.on{opacity:1}
  .hero-film-shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:transform}
  .hero-film-cap{position:absolute;inset-inline-start:18px;bottom:16px;z-index:2;background:rgba(255,255,255,.88);backdrop-filter:blur(6px);color:#1a1a1a;font-size:.86rem;font-weight:600;padding:8px 14px;border-radius:999px;box-shadow:0 2px 12px rgba(0,0,0,.08);transition:opacity .4s}
  .hero-film-dots{position:absolute;inset-inline-end:18px;bottom:20px;z-index:2;display:flex;gap:6px}
  .hero-film-dots button{width:8px;height:8px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.6);cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
  .hero-film-dots button[aria-current="true"]{background:#fff;width:20px;border-radius:4px}
  .hero-film-burst{background:#111;transition-duration:160ms}
  .hero-film-burst .hb-img{opacity:0}
  .hero-film-burst .hb-img.on{opacity:1}
  .hb-dim{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(15,10,6,.18),rgba(15,10,6,.42));pointer-events:none}
  .hb-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3}
  .hb-word{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',system-ui,sans-serif;font-weight:900;font-size:clamp(2.6rem,15cqw,8.5rem);letter-spacing:.02em;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,.35);opacity:0;pointer-events:none;will-change:transform,opacity}
  @media(max-width:948px){.hero-film{margin:4px 24px 22px}}
  @media(max-width:640px){.hero-film{margin:0 16px 18px;aspect-ratio:4/5;border-radius:18px}.hero-film-cap{font-size:.78rem;inset-inline-start:12px;bottom:12px;max-width:calc(100% - 24px)}.hero-film-dots{inset-inline-end:auto;inset-inline-start:50%;transform:translateX(-50%);top:12px;bottom:auto}}`;
  document.head.appendChild(css);

  function build() {
    const hero = document.querySelector('#homePage .hero');
    if (!hero || document.querySelector('.hero-film')) return;
    const film = document.createElement('div');
    film.className = 'hero-film'; film.setAttribute('role', 'region'); film.setAttribute('aria-roledescription', 'carousel');
    const src = (f) => `sizes="(max-width:948px) 100vw, 900px" srcset="/hero/${f}-900.webp?v=${IMG_V} 900w, /hero/${f}.webp?v=${IMG_V} 1536w" src="/hero/${f}.webp?v=${IMG_V}"`;
    film.innerHTML = SHOTS.map(([f, , , , , , focus], i) => f === 'burst' ? `<div class="hero-film-shot hero-film-burst">${BURST.map(([bf]) => `<img class="hb-img" alt="" decoding="async" loading="lazy" ${src(bf)}>`).join('')}<div class="hb-dim"></div><div class="hb-word" aria-hidden="true"></div><div class="hb-flash"></div></div>` : f === '00-intro' ? `<div class="hero-film-shot hero-film-intro${i ? '' : ' on'}"><div class="hi-stage"><div class="hi-art"><picture><source media="(max-width:640px)" srcset="/hero/00-intro-720.webp?v=${IMG_V} 720w, /hero/00-intro.webp?v=${IMG_V} 1024w" sizes="100vw"><img alt="Gremier Coffee Co. · Cold Brew · Elevate Every Day" fetchpriority="high" decoding="async" sizes="(max-width:948px) 100vw, 900px" srcset="/hero/00-intro-wide-900.webp?v=${IMG_V} 900w, /hero/00-intro-wide.webp?v=${IMG_V} 1536w" src="/hero/00-intro-wide.webp?v=${IMG_V}"></picture><div class="hi-glint"></div></div><div class="hi-glow"></div></div></div>` : `<div class="hero-film-shot${i ? '' : ' on'}"><img alt="" decoding="async"${focus ? ` style="object-position:${focus}"` : ''} ${i ? 'loading="lazy"' : 'fetchpriority="high"'} sizes="(max-width:948px) 100vw, 900px" srcset="/hero/${f}-${(SIZES[f] || [900])[0]}.webp?v=${IMG_V} ${(SIZES[f] || [900])[0]}w, /hero/${f}.webp?v=${IMG_V} ${(SIZES[f] || [0, 1536])[1]}w" src="/hero/${f}.webp?v=${IMG_V}"></div>`).join('')
      + `<div class="hero-film-cap" aria-live="polite"></div><div class="hero-film-dots">${SHOTS.map((_, i) => `<button type="button" aria-label="${i + 1}"></button>`).join('')}</div>`;
    hero.insertAdjacentElement('afterend', film);
    const shots = [...film.querySelectorAll('.hero-film-shot')], cap = film.querySelector('.hero-film-cap'), dots = [...film.querySelectorAll('.hero-film-dots button')];
    let i = 0, timer = null, anim = null, beats = [], moving = [];
    // Each beat's animations are cancelled before the next, so a page left open doesn't pile them up.
    const settle = () => { moving.forEach((a) => a.cancel()); moving = []; };
    const stopBurst = () => { beats.forEach(clearTimeout); beats = []; settle(); };
    function burst(el) {
      const imgs = [...el.querySelectorAll('.hb-img')], word = el.querySelector('.hb-word'), flash = el.querySelector('.hb-flash');
      const pop = () => flash.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0 }], { duration: 240, easing: 'ease-out' });
      BURST.forEach(([, en, hebrew], k) => beats.push(setTimeout(() => {
        const dir = k % 2 ? -1 : 1;
        settle();
        pop();
        imgs.forEach((im, j) => im.classList.toggle('on', j === k));
        moving.push(imgs[k].animate([
          { transform: `translateX(${dir * 3}%) scale(1.24)`, filter: 'blur(5px)' },
          { transform: 'translateX(0) scale(1.07)', filter: 'blur(0)', offset: 0.22 },
          { transform: `translateX(${-dir * 1.5}%) scale(1.03)`, filter: 'blur(0)' }], { duration: BEAT + 160, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }));
        word.textContent = he() ? hebrew : en;
        moving.push(word.animate([
          { transform: 'scale(1.8)', opacity: 0, letterSpacing: '.3em' },
          { transform: 'scale(.95)', opacity: 1, letterSpacing: '.02em', offset: 0.2 },
          { transform: 'scale(1)', opacity: 1, offset: 0.78 },
          { transform: 'scale(1.08)', opacity: 0 }], { duration: BEAT, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
      }, k * BEAT)));
      beats.push(setTimeout(pop, BURST.length * BEAT - 120));   // a last flash into the closing shot
    }
    const t = ([s, x, y]) => `translate(${x}%, ${y}%) scale(${s})`;
    function show(n) {
      stopBurst();
      shots[i].classList.remove('on');
      i = (n + SHOTS.length) % SHOTS.length;
      const [file, en, hebrew, , from, to] = SHOTS[i], intro = file === '00-intro', img = shots[i].querySelector(intro ? '.hi-stage' : 'img');
      // Warm up the next photo(s) so they're ready before their turn.
      shots[(i + 1) % SHOTS.length].querySelectorAll('img').forEach((im) => { if (im.loading === 'lazy') im.loading = 'eager'; });
      // The opening replays its reveal, glint and glow each time it comes round.
      if (intro) { shots[i].classList.remove('play'); void shots[i].offsetWidth; shots[i].classList.add('play'); }
      shots[i].classList.add('on');
      cap.textContent = he() ? hebrew : en; cap.style.opacity = cap.textContent ? '1' : '0';
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
      film.setAttribute('aria-label', (he() ? hebrew : en) || 'Gremier Coffee Co.');
      if (file === 'burst') { burst(shots[i]); clearTimeout(timer); timer = setTimeout(() => show(i + 1), BURST.length * BEAT); return; }
      const hold = intro ? INTRO_HOLD : TILT[file] || HOLD;
      if (!still && img.animate) {
        anim = TILT[file]
          ? img.animate([{ objectPosition: '46% 0%', transform: `scale(${from[0]})` }, { objectPosition: '54% 100%', transform: `scale(${to[0]})` }], { duration: hold + FADE * 2, easing: 'ease-in-out', fill: 'both' })
          : img.animate([{ transform: t(from) }, { transform: t(to) }], { duration: hold + FADE * 2, easing: 'ease-in-out', fill: 'both' });
      }
      clearTimeout(timer); timer = setTimeout(() => show(i + 1), hold + (still ? 1500 : 0));
    }
    dots.forEach((d, k) => d.onclick = (e) => { e.stopPropagation(); show(k); });
    film.onclick = () => { if (typeof showPage === 'function') showPage(SHOTS[i][3]); };
    // Pause while it's off screen or the tab is hidden.
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!timer) show(i); } else { clearTimeout(timer); timer = null; stopBurst(); anim?.pause(); } }) : null;
    show(0);
    io?.observe(film);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; stopBurst(); anim?.pause(); } else if (!timer) show(i); });
    // Captions follow the language switch.
    const toggle = window.toggleLang;
    if (typeof toggle === 'function') window.toggleLang = function () { const r = toggle.apply(this, arguments); cap.textContent = he() ? SHOTS[i][2] : SHOTS[i][1]; cap.style.opacity = cap.textContent ? '1' : '0'; return r; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
