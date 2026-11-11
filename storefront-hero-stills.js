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
  // The burst film (logo, minis burst, product burst, closing shot): for everyone while BURST_LIVE; otherwise only with ?burst=preview
  // (BURST_LIVE false brings back the slow film).
  const BURST_LIVE = true;
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
    ['15-classic-liter', 'Classic Dark Roast · smooth & strong', 'קלאסיק קלייה כהה · חלק וחזק', 'shop', [1.03, -1.5, -1], [1.1, 4, 3]],
    ['16-colombia-liter', 'Colombia Light Roast · bright & fruity', 'קולומביה קלייה בהירה · רענן ופירותי', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['17-sweetened-liter', 'Sweetened Classic · add milk if you like', 'קלאסיק ממותק · עם חלב, אם בא לכם', 'shop', [1.03, -1.5, -1], [1.1, 4, 3]],
    ['18-vanilla-pump', 'Vanilla Bean Syrup', 'סירופ וניל', 'shop', [1.03, 1.5, 1], [1.1, -4, -3]],
    ['19-original-cream-latte', 'Original Cream Latte', 'קרים לאטה אוריג׳ינל', 'shop', [1.03, -1.5, 1], [1.1, 4, -3]],
    ['22-vanilla-cream-latte', 'Vanilla Cream Latte', 'קרים לאטה וניל', 'shop', [1, 0, 0], [1.06, 0, 0]],
    ['23-caramel-cream-latte', 'Caramel Cream Latte', 'קרים לאטה קרמל', 'shop', [1, 0, 0], [1.06, 0, 0]],
    ['24-caramel-pump', 'Caramel Syrup', 'סירופ קרמל', 'shop', [1, 0, 0], [1.06, 0, 0]],
    ['25-sugar-pump', 'Sugar Syrup', 'סירופ סוכר', 'shop', [1, 0, 0], [1.06, 0, 0], '22% center'],
    ['28-classic-jug-wide', '5 litres for the office or family', '5 ליטר למשרד או למשפחה', 'shop', [1.03, 1.5, -1], [1.1, -4, 3]],
    ['09-coffee-bar', 'Coffee bars for your event', 'עמדות קפה לאירוע שלכם', 'coffeebars', [1.03, -1.5, -1], [1.1, 4, 3]],
    // The closing shot is a tall photo with its own words: the camera tilts down it (TILT below). No caption.
    ['10-elevate', '', '', 'shop', [1.02, 0, 0], [1.08, 0, 0], '50% 0%'],
  ];
  // The burst version of the film (BURSTS below): the opening, the minis burst, the product burst,
  // then the closing shot, which pulls back (ends wider) as it tilts down. No captions.
  const BURST_SHOTS = [SHOTS[0], ['burst-minis', '', '', 'shop'], ['burst-products', '', '', 'shop'],
    ['10-elevate', '', '', 'shop', [1.1, 0, 0], [1, 0, 0], '50% 0%']];
  // Bump when a photo is replaced, so browsers fetch the new one instead of a cached copy.
  const IMG_V = '20261103d';
  const HOLD = 5600, FADE = 1200, INTRO_HOLD = 3000;
  // Photos whose files aren't the usual 900 / 1536 wide. TILT: tall photos the camera tilts down (top to bottom).
  const SIZES = { '10-elevate': [720, 1024] }, TILT = { '10-elevate': 7200 };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // BURSTS: each beat flashes white, the photo punches in (zoomed, a little blurred, alternating sides)
  // and settles, and a big word slams in, then snaps out before the next flash. [photo, English, Hebrew].
  // Minis: quick beats, one flavour each, with the flash. Products: a little longer, so the bigger products
  // register, in a calmer GLIDE: each photo sweeps in on a slanted wipe and settles, the word rises in.
  const BURSTS = {
    'burst-minis': { beat: 850, frames: [
      ['21-classic-mini', 'CLASSIC.', 'קלאסיק.'],
      ['19-original-cream-latte', 'ORIGINAL.', 'אוריג׳ינל.'],
      ['22-vanilla-cream-latte', 'VANILLA.', 'וניל.'],
      ['23-caramel-cream-latte', 'CARAMEL.', 'קרמל.'],
      ['14-burst-unfiltered', 'UNFILTERED.', 'לא מסונן.'],
    ] },
    'burst-products': { beat: 1300, glide: true, frames: [
      ['15-classic-liter', 'DARK ROAST.', 'קלייה כהה.'],
      ['16-colombia-liter', 'COLOMBIA.', 'קולומביה.'],
      ['17-sweetened-liter', 'SWEETENED.', 'ממותק.'],
      ['26-house-liter', 'HOUSE BLEND.', 'תערובת הבית.'],
      ['27-decaf-liter', 'DECAF.', 'נטול קפאין.'],
      ['18-vanilla-pump', 'VANILLA SYRUP.', 'סירופ וניל.'],
      ['24-caramel-pump', 'CARAMEL SYRUP.', 'סירופ קרמל.'],
      ['25-sugar-pump', 'SUGAR SYRUP.', 'סירופ סוכר.'],
      ['28-classic-jug-wide', '5 LITRES.', '5 ליטר.'],
      ['09-coffee-bar', 'COFFEE BARS.', 'עמדות קפה.', 'coffeebars'],
    ] },
  };
  // The product words' letters: [in, out] keyframes per letter (j of n), one style per beat.
  const mid = (j, n) => j - (n - 1) / 2;
  const LETTERS = [
    [() => [{ transform: 'translateY(70%)', opacity: 0 }, { transform: 'none', opacity: 1 }], () => [{ opacity: 1 }, { transform: 'translateY(-60%)', opacity: 0 }]],
    [() => [{ transform: 'translateY(-80%) rotate(-8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], () => [{ opacity: 1 }, { transform: 'translateY(70%)', opacity: 0 }]],
    [() => [{ transform: 'scale(1.6)', filter: 'blur(10px)', opacity: 0 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], () => [{ opacity: 1 }, { filter: 'blur(8px)', opacity: 0 }]],
    [() => [{ transform: 'perspective(500px) rotateX(90deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], () => [{ opacity: 1 }, { transform: 'perspective(500px) rotateX(-90deg)', opacity: 0 }]],
    [(j, n) => [{ transform: `translateX(${mid(j, n) * 18}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], (j, n) => [{ opacity: 1 }, { transform: `translateX(${mid(j, n) * 22}px) scale(.8)`, opacity: 0 }]],
    [() => [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], () => [{ opacity: 1 }, { transform: 'scale(0)', opacity: 0 }]],
  ];
  // Burst film for preview (or when BURST_LIVE); the slow film otherwise and for reduced motion.
  if (!still && (BURST_LIVE || burstPreview)) SHOTS.splice(0, SHOTS.length, ...BURST_SHOTS);

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
  .hero-film-intro.play .hi-art img{animation:hiReveal 1.2s cubic-bezier(.3,.6,.3,1) both}
  .hero-film-intro.play .hi-glint{animation:hiGlint 1.5s ease-in-out .9s both}
  .hero-film-intro.play .hi-glow{animation:hiGlow 3.6s ease-in-out infinite alternate}
  @keyframes hiReveal{from{-webkit-mask-position:0 100%;mask-position:0 100%;filter:brightness(.55)}to{-webkit-mask-position:0 0;mask-position:0 0;filter:brightness(1)}}
  @keyframes hiGlint{0%{background-position:120% 0;opacity:0}20%{opacity:1}80%{opacity:1}100%{background-position:-20% 0;opacity:0}}
  @keyframes hiGlow{from{opacity:.22}to{opacity:.7}}
  @media(prefers-reduced-motion:reduce){.hero-film-intro.play .hi-art img,.hero-film-intro.play .hi-glint,.hero-film-intro.play .hi-glow{animation:none}}
  .hero-film-shot{position:absolute;inset:0;opacity:0;transition:opacity ${FADE}ms ease}
  .hero-film-shot.on{opacity:1}
  .hero-film-shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:transform}
  @media(max-width:640px){.hero-film-shot img[src*="/28-classic-jug-wide.webp"]{object-fit:contain;background:#17130f}}
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
  @media(max-width:640px){.hero-film{margin:0 16px 18px;aspect-ratio:4/5;border-radius:18px}.hero-film-cap{font-size:.78rem;inset-inline-start:12px;bottom:12px;max-width:calc(100% - 24px)}.hero-film-dots{inset-inline-end:auto;inset-inline-start:50%;transform:translateX(-50%);top:12px;bottom:auto}}
  /* The headline sits on the film: a thin line and a small Shop button over a soft dark fade.
     The separate hero block (logo, headline, paragraph) is folded away; the logo is already in the header. */
  #homePage .hero.hero-folded{display:none}
  #homePage .hero-film{max-width:min(1152px,calc((100svh - 150px) * 1.5));margin:18px auto 26px}
  .hero-film-over{position:absolute;inset:auto 0 0 0;z-index:2;display:flex;align-items:flex-end;justify-content:space-between;gap:14px;padding:70px 26px 22px;background:linear-gradient(to top,rgba(14,10,7,.62),rgba(14,10,7,.28) 55%,transparent);pointer-events:none}
  .hero-film-over .hero-title{font-family:'Playfair Display',serif;font-size:clamp(1.25rem,2.3vw,1.8rem);font-weight:500;line-height:1.15;color:#fff;margin:0;text-align:start;text-shadow:0 1px 12px rgba(0,0,0,.25);transition:opacity .5s}
  .hero-film-over .hero-title br{display:none}
  .hero-film-over .hero-title em{color:#fff!important;font-weight:500;font-style:italic;margin-inline-start:.28em}
  .hero-film-shop{pointer-events:auto;flex-shrink:0;border:0;border-radius:999px;background:#fff;color:#1a1a1a;font:600 .82rem 'DM Sans',sans-serif;padding:10px 18px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.18)}
  .hero-film-shop:hover{background:#f3ede4}
  .hero-film-shop:focus-visible{outline:3px solid #b9854c;outline-offset:3px}
  .hero-film.at-intro .hero-film-over{background:none}
  .hero-film.at-intro .hero-film-over .hero-title{opacity:0}
  .hero-film-cap{bottom:auto;top:16px}
  .hero-film-dots{bottom:auto;top:20px}
  @media(max-width:948px){#homePage .hero-film{max-width:none;margin:14px 24px 22px}}
  @media(max-width:640px){#homePage .hero-film{margin:10px 16px 18px}.hero-film-over{padding:56px 16px 16px;gap:10px}.hero-film-over .hero-title{font-size:1.2rem}.hero-film-shop{padding:9px 15px;font-size:.78rem}.hero-film-cap{top:30px}}`;
  document.head.appendChild(css);

  function build() {
    const hero = document.querySelector('#homePage .hero');
    if (!hero || document.querySelector('.hero-film')) return;
    const film = document.createElement('div');
    film.className = 'hero-film'; film.setAttribute('role', 'region'); film.setAttribute('aria-roledescription', 'carousel');
    const src = (f) => `sizes="(max-width:948px) 100vw, 900px" srcset="/hero/${f}-900.webp?v=${IMG_V} 900w, /hero/${f}.webp?v=${IMG_V} 1536w" src="/hero/${f}.webp?v=${IMG_V}"`;
    film.innerHTML = SHOTS.map(([f, , , , , , focus], i) => BURSTS[f] ? `<div class="hero-film-shot hero-film-burst">${BURSTS[f].frames.map(([bf]) => `<img class="hb-img" alt=""${bf === '25-sugar-pump' ? ' style="object-position:22% center"' : ''} decoding="async" loading="lazy" ${src(bf)}>`).join('')}<div class="hb-dim"></div><div class="hb-word" aria-hidden="true"></div><div class="hb-flash"></div></div>` : f === '00-intro' ? `<div class="hero-film-shot hero-film-intro${i ? '' : ' on'}"><div class="hi-stage"><div class="hi-art"><picture><source media="(max-width:640px)" srcset="/hero/00-intro-720.webp?v=${IMG_V} 720w, /hero/00-intro.webp?v=${IMG_V} 1024w" sizes="100vw"><img alt="Gremier Coffee Co. · Cold Brew · Elevate Every Day" fetchpriority="high" decoding="async" sizes="(max-width:948px) 100vw, 900px" srcset="/hero/00-intro-wide-900.webp?v=${IMG_V} 900w, /hero/00-intro-wide.webp?v=${IMG_V} 1536w" src="/hero/00-intro-wide.webp?v=${IMG_V}"></picture><div class="hi-glint"></div></div><div class="hi-glow"></div></div></div>` : `<div class="hero-film-shot${i ? '' : ' on'}"><img alt="" decoding="async"${focus ? ` style="object-position:${focus}"` : ''} ${i ? 'loading="lazy"' : 'fetchpriority="high"'} sizes="(max-width:948px) 100vw, 900px" srcset="/hero/${f}-${(SIZES[f] || [900])[0]}.webp?v=${IMG_V} ${(SIZES[f] || [900])[0]}w, /hero/${f}.webp?v=${IMG_V} ${(SIZES[f] || [0, 1536])[1]}w" src="/hero/${f}.webp?v=${IMG_V}"></div>`).join('')
      + `<div class="hero-film-cap" aria-live="polite"></div><div class="hero-film-dots">${SHOTS.map((_, i) => `<button type="button" aria-label="${i + 1}"></button>`).join('')}</div>`;
    hero.insertAdjacentElement('afterend', film);
    // The headline moves onto the film, with a small Shop button; the rest of the hero block is hidden.
    const over = document.createElement('div');
    over.className = 'hero-film-over';
    const title = hero.querySelector('.hero-title');
    if (title) over.appendChild(title);
    const shopBtn = document.createElement('button');
    shopBtn.type = 'button'; shopBtn.className = 'hero-film-shop';
    shopBtn.setAttribute('data-discovery-en', 'Shop now'); shopBtn.setAttribute('data-discovery-he', 'לחנות');
    shopBtn.textContent = he() ? 'לחנות' : 'Shop now';
    shopBtn.onclick = (e) => { e.stopPropagation(); if (typeof showPage === 'function') showPage('shop'); };
    over.appendChild(shopBtn);
    film.appendChild(over);
    hero.classList.add('hero-folded');
    const shots = [...film.querySelectorAll('.hero-film-shot')], cap = film.querySelector('.hero-film-cap'), dots = [...film.querySelectorAll('.hero-film-dots button')];
    let i = 0, timer = null, anim = null, beats = [], moving = [];
    // Each beat's animations are cancelled before the next, so a page left open doesn't pile them up.
    const settle = () => { moving.forEach((a) => a.cancel()); moving = []; };
    const stopBurst = () => { beats.forEach(clearTimeout); beats = []; settle(); };
    let page = null;   // a burst beat can send the tap elsewhere (coffee bars)
    function burst(el, { beat: BEAT, frames: BURST, glide }) {
      const imgs = [...el.querySelectorAll('.hb-img')], word = el.querySelector('.hb-word'), flash = el.querySelector('.hb-flash');
      const pop = () => flash.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0 }], { duration: 240, easing: 'ease-out' });
      BURST.forEach(([, en, hebrew, to], k) => beats.push(setTimeout(() => {
        const dir = k % 2 ? -1 : 1;
        page = to || null;
        word.textContent = he() ? hebrew : en;
        // Long words (UNFILTERED.) shrink to fit the frame's width.
        word.style.fontSize = `min(15cqw, ${(135 / word.textContent.length).toFixed(1)}cqw)`;
        if (glide) {
          // The new photo wipes in over the previous one (which keeps moving until it's covered).
          const prev = k ? imgs[k - 1] : null;
          moving.filter((a) => a.effect.target !== prev).forEach((a) => a.cancel());
          moving = moving.filter((a) => a.effect.target === prev);
          imgs.forEach((im, j) => { im.classList.toggle('on', j === k || im === prev); im.style.zIndex = j === k ? 2 : im === prev ? 1 : 0; });
          const wipe = dir > 0 ? ['polygon(120% 0, 100% 0, 100% 100%, 100% 100%)', 'polygon(0% 0, 100% 0, 100% 100%, -20% 100%)']
            : ['polygon(0 0, 0% 0, -20% 100%, 0 100%)', 'polygon(0 0, 120% 0, 100% 100%, 0 100%)'];
          if (k) moving.push(imgs[k].animate([{ clipPath: wipe[0] }, { clipPath: wipe[1] }], { duration: 560, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' }));
          moving.push(imgs[k].animate([{ transform: `translateX(${dir * 2}%) scale(1.14)` }, { transform: 'translateX(0) scale(1.02)' }], { duration: BEAT + 600, easing: 'cubic-bezier(.2,.6,.2,1)', fill: 'both' }));
          if (prev) beats.push(setTimeout(() => moving.filter((a) => a.effect.target === prev).forEach((a) => a.cancel()), 600));
          // Each word letter by letter, with its own way in and out (LETTERS), so no two beats look alike.
          const [inF, outF] = LETTERS[k % LETTERS.length];
          const chars = [...word.textContent];
          word.innerHTML = chars.map((c) => `<span style="display:inline-block;white-space:pre">${c === ' ' ? ' ' : c.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]))}</span>`).join('');
          const spans = [...word.children], n = spans.length, gap = Math.min(45, 360 / n);
          word.style.opacity = '1'; word.style.transform = 'none';
          spans.forEach((sp, j) => {
            moving.push(sp.animate(inF(j, n), { duration: 460, delay: j * gap, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
            moving.push(sp.animate(outF(j, n), { duration: 260, delay: BEAT - 300 + j * Math.min(18, 140 / n), easing: 'ease-in', fill: 'forwards' }));
          });
          return;
        }
        settle();
        pop();
        imgs.forEach((im, j) => im.classList.toggle('on', j === k));
        moving.push(imgs[k].animate([
          { transform: `translateX(${dir * 3}%) scale(1.24)`, filter: 'blur(5px)' },
          { transform: 'translateX(0) scale(1.07)', filter: 'blur(0)', offset: 0.22 },
          { transform: `translateX(${-dir * 1.5}%) scale(1.03)`, filter: 'blur(0)' }], { duration: BEAT + 160, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' }));
        moving.push(word.animate([
          { transform: 'scale(1.8)', opacity: 0, letterSpacing: '.3em' },
          { transform: 'scale(.95)', opacity: 1, letterSpacing: '.02em', offset: 0.2 },
          { transform: 'scale(1)', opacity: 1, offset: 0.78 },
          { transform: 'scale(1.08)', opacity: 0 }], { duration: BEAT, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
      }, k * BEAT)));
      if (!glide) beats.push(setTimeout(pop, BURST.length * BEAT - 120));   // a last flash into what follows
    }
    const t = ([s, x, y]) => `translate(${x}%, ${y}%) scale(${s})`;
    function show(n) {
      stopBurst(); page = null;
      shots[i].classList.remove('on');
      i = (n + SHOTS.length) % SHOTS.length;
      const [file, en, hebrew, , from, to] = SHOTS[i], intro = file === '00-intro', img = shots[i].querySelector(intro ? '.hi-stage' : 'img');
      // Warm up the next photo(s) so they're ready before their turn.
      shots[(i + 1) % SHOTS.length].querySelectorAll('img').forEach((im) => { if (im.loading === 'lazy') im.loading = 'eager'; });
      // The opening replays its reveal, glint and glow each time it comes round.
      if (intro) { shots[i].classList.remove('play'); void shots[i].offsetWidth; shots[i].classList.add('play'); }
      shots[i].classList.add('on');
      film.classList.toggle('at-intro', intro);   // the opening graphic carries its own words
      cap.textContent = he() ? hebrew : en; cap.style.opacity = cap.textContent ? '1' : '0';
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
      film.setAttribute('aria-label', (he() ? hebrew : en) || 'Gremier Coffee Co.');
      if (BURSTS[file]) { burst(shots[i], BURSTS[file]); clearTimeout(timer); timer = setTimeout(() => show(i + 1), BURSTS[file].frames.length * BURSTS[file].beat); return; }
      const hold = intro ? INTRO_HOLD : TILT[file] || HOLD;
      if (!still && img.animate) {
        anim = TILT[file]
          ? img.animate([{ objectPosition: '46% 0%', transform: `scale(${from[0]})` }, { objectPosition: '54% 100%', transform: `scale(${to[0]})` }], { duration: hold + FADE * 2, easing: 'ease-in-out', fill: 'both' })
          : img.animate([{ transform: t(from) }, { transform: t(to) }], { duration: hold + FADE * 2, easing: 'ease-in-out', fill: 'both' });
      }
      clearTimeout(timer); timer = setTimeout(() => show(i + 1), hold + (still ? 1500 : 0));
    }
    dots.forEach((d, k) => d.onclick = (e) => { e.stopPropagation(); show(k); });
    film.onclick = () => { if (typeof showPage === 'function') showPage(page || SHOTS[i][3]); };
    // Pause while it's off screen or the tab is hidden.
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!timer) show(i); } else { clearTimeout(timer); timer = null; stopBurst(); anim?.pause(); } }) : null;
    show(0);
    io?.observe(film);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; stopBurst(); anim?.pause(); } else if (!timer) show(i); });
    // Captions follow the language switch.
    const toggle = window.toggleLang;
    if (typeof toggle === 'function') window.toggleLang = function () { const r = toggle.apply(this, arguments); shopBtn.textContent = he() ? 'לחנות' : 'Shop now'; cap.textContent = he() ? SHOTS[i][2] : SHOTS[i][1]; cap.style.opacity = cap.textContent ? '1' : '0'; return r; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
