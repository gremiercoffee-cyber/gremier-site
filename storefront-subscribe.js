/* Subscription builder: every "Subscribe" on the site opens this room (like the coffee bar builder).
   The customer fills a box that lands on a doorstep; a progress bar shows when it's enough to deliver
   (two coffee items or a 5L, same rule as the server) and when delivery becomes free (the area's
   threshold, on prices before the 10% discount). Adds the same cart item the product window did. */
(function () {
  'use strict';
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const all = () => (typeof products !== 'undefined' && Array.isArray(products) ? products : []);
  const zones = () => (typeof deliveryZones !== 'undefined' && Array.isArray(deliveryZones) ? deliveryZones : []);
  const M = () => window.GremierSubscriptionModel;
  const nameOf = (p) => (he() ? (p.name_he || p.name_en) : p.name_en);
  const money = (n) => '₪' + (Math.round(n * 100) / 100).toLocaleString('en-IL', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_UNITS = 14;   // drawn on the doorstep; more shows as "+N"

  // Cut-out photos for the doorstep, and their width:height, so the row can be laid out before they load.
  function art(p) {
    const n = String(p.name_en || '').toLowerCase(), M_ = M();
    if (M_.syrup(p)) return { src: /caramel/.test(n) ? '/bar/caramel.webp' : '/bar/vanilla.webp', ratio: 0.395, h: 17, kind: 'syrup' };
    if (p.category === 'minis') return { src: `/packs/studio/minis-${/vanilla/.test(n) ? 'vanilla' : /caramel/.test(n) ? 'caramel' : /classic/.test(n) ? 'classic' : 'original'}-v1.webp`, ratio: 0.90, h: 16, kind: 'mini', count: 4 };
    if (M_.large(p)) return { src: `/bar/jer_${/house/.test(n) ? 'house' : /colombia/.test(n) ? 'colombia' : 'classic'}.webp`, ratio: 0.683, h: 23, kind: 'jug', count: Number((n.match(/^(\d+)\s*[×x]/) || [])[1]) || 1 };
    return { src: `/packs/studio/bottles-${/decaf/.test(n) ? 'decaf' : /sweetened/.test(n) ? 'sweetened' : /house/.test(n) ? 'house' : /colombia/.test(n) ? 'colombia' : 'classic'}-v2.webp`, ratio: 0.293, h: 21, kind: 'bottle' };
  }
  const groups = [
    ['bottle', 'Liter bottles', 'בקבוקי ליטר'],
    ['mini', 'Mini 4-packs', 'רביעיות מיני'],
    ['jug', '5 liters', '5 ליטר'],
    ['syrup', 'Syrups · full price, with coffee', 'סירופים · מחיר מלא, עם קפה'],
  ];

  let state = null, el = null, backdrop = null, lastFocus = null, savedY = 0, afterClose = null;
  const units = () => Object.entries(state.picks).filter(([, n]) => n > 0);
  function quote() {
    const chosen = units().map(([product_id, qty]) => ({ product_id, qty }));
    if (!chosen.length) return null;
    try { return M().quote(chosen, all()); } catch (_) { return null; }
  }
  // Delivery for the chosen area: its fee and free-delivery threshold. Before an area is chosen, the
  // lowest threshold of the areas that have one (as the cart does).
  function area() {
    const list = zones(), z = list.find((x) => x.id === state.area);
    const fallbackFee = typeof deliveryDefaults !== 'undefined' ? Number(deliveryDefaults.default_regular_price) || 0 : 0;
    if (state.area === 'other') return { fee: fallbackFee, free: 0, name: T('your area', 'האזור שלכם') };
    if (z) return { fee: Number(z.regular_price) || 0, free: Number(z.free_above) || 0, name: (he() ? z.name_he : z.name_en) || '', chosen: true };
    const withFree = list.filter((x) => Number(x.free_above) > 0).sort((a, b) => Number(a.free_above) - Number(b.free_above));
    return withFree.length ? { fee: Number(withFree[0].regular_price) || 0, free: Number(withFree[0].free_above), name: (he() ? withFree[0].name_he : withFree[0].name_en) || '' } : { fee: fallbackFee, free: 0, name: '' };
  }
  const title = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);

  // Where the customer stands: coffee items toward "ready to deliver", then ₪ toward free delivery.
  function progress() {
    const q = quote(), a = area();
    const coffee = units().reduce((n, [id, qty]) => { const p = all().find((x) => String(x.id) === id); return n + (p && !M().syrup(p) ? qty : 0); }, 0);
    const regular = units().reduce((n, [id, qty]) => { const p = all().find((x) => String(x.id) === id); return n + (p ? Number(p.price) * qty : 0); }, 0);
    const ready = !!q?.deliveryEligible;
    const freeOk = ready && (a.fee === 0 || (a.free > 0 && regular >= a.free));
    const noFree = a.fee > 0 && !a.free;
    const toFree = a.free ? Math.max(0, a.free - regular) : 0;
    const A = ready ? 1 : Math.min(coffee / 2, 0.9), B = freeOk ? 1 : noFree ? 0 : a.free ? Math.min(regular / a.free, 0.97) : 0;
    return { q, a, coffee, regular, ready, freeOk, noFree, toFree, fill: ready ? 0.42 + 0.58 * B : 0.42 * A };
  }
  function headline(g) {
    const every = state.interval === 'weekly' ? T('every week', 'כל שבוע') : T('every month', 'כל חודש');
    if (!g.coffee && !units().length) return [T('Fill your box', 'מלאו את הקופסה'), T('Pick your coffee below. Two coffee items (or one 5L) and we bring it to your door.', 'בחרו קפה למטה. שני פריטי קפה (או 5 ליטר אחד) ואנחנו מביאים עד הדלת.')];
    if (!g.coffee) return [T('Add coffee', 'הוסיפו קפה'), T('Syrups come along with coffee. Add a coffee item to start.', 'סירופים מצטרפים לקפה. הוסיפו פריט קפה כדי להתחיל.')];
    if (!g.ready) return [T('1 more coffee to deliver', 'עוד קפה אחד למשלוח'), T('Add one more coffee item (or a 5L) and it comes to your door. With just this, it’s pickup only.', 'הוסיפו עוד פריט קפה (או 5 ליטר) והמשלוח מגיע עד הדלת. כרגע — איסוף עצמי בלבד.')];
    if (g.freeOk) return [T(`Free delivery, ${every} 🎉`, `משלוח חינם, ${every} 🎉`), g.a.fee === 0 ? T(`Delivery to ${title(g.a.name)} is always free.`, `המשלוח ל${g.a.name} תמיד חינם.`) : T('Your box arrives at your door at no extra cost.', 'הקופסה מגיעה עד הדלת בלי תוספת.')];
    if (g.noFree) return [T('Ready to deliver ✓', 'מוכן למשלוח ✓'), T(`Delivery ${money(g.a.fee)} each time.`, `משלוח ${money(g.a.fee)} בכל פעם.`)];
    return [T(`${money(Math.ceil(g.toFree))} more for free delivery`, `עוד ${money(Math.ceil(g.toFree))} למשלוח חינם`), T(`Ready to deliver ✓ · delivery ${money(g.a.fee)} until then${g.a.chosen ? '' : ` (${title(g.a.name)})`}. Counted before the 10% discount.`, `מוכן למשלוח ✓ · משלוח ${money(g.a.fee)} עד אז${g.a.chosen ? '' : ` (${g.a.name})`}. נספר לפני הנחת ה-10%.`)];
  }
  // One tap that closes the gap: a coffee to reach delivery, else the item that just crosses free delivery.
  function suggestion(g) {
    const pool = all().filter((p) => M().eligible(p));
    if (!g.coffee) return pool.find((p) => /classic dark/i.test(p.name_en) && p.category === 'bottles') || pool.find((p) => !M().syrup(p));
    if (!g.ready) { const mine = units().map(([id]) => id); return pool.find((p) => p.category === 'bottles' && !M().syrup(p) && mine.includes(String(p.id))) || pool.find((p) => p.category === 'bottles' && !M().syrup(p)); }
    if (!g.freeOk && !g.noFree && g.toFree > 0) {
      const over = pool.filter((p) => !M().large(p) && Number(p.price) >= g.toFree).sort((a, b) => Number(a.price) - Number(b.price));
      return over.find((p) => !M().syrup(p)) || over[0] || null;
    }
    return null;
  }
  const unitPrice = (p) => (M().syrup(p) ? Number(p.price) : Math.round(Number(p.price) * 90) / 100);

  const icons = {
    box: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 7.5 12 12l9-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    van: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6h11v10H2zM13 9h4.5l3.5 3.5V16h-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.5" cy="17.5" r="1.8" fill="currentColor"/><circle cx="17" cy="17.5" r="1.8" fill="currentColor"/></svg>',
  };
  const VAN = `<svg viewBox="0 0 220 120" aria-hidden="true"><ellipse cx="110" cy="112" rx="100" ry="6" fill="#00000022"/><path d="M8 26c0-9 7-16 16-16h106v84H8z" fill="#f8f4ee"/><path d="M130 30h38c6 0 11 3 14 8l20 28c2 3 3 6 3 9v19h-75z" fill="#ece5da"/><path d="M140 38h26c3 0 6 2 8 4l14 20h-48z" fill="#3b4a55"/><rect x="8" y="78" width="197" height="16" fill="#2a211b"/><text x="69" y="58" text-anchor="middle" font-family="DM Sans,sans-serif" font-weight="800" font-size="19" letter-spacing="3" fill="#2a211b">GREMIER</text><text x="69" y="74" text-anchor="middle" font-family="DM Sans,sans-serif" font-size="9" letter-spacing="2" fill="#80582e">COLD BREW</text><circle cx="48" cy="96" r="15" fill="#1d1712"/><circle cx="48" cy="96" r="6" fill="#bdb3a5"/><circle cx="168" cy="96" r="15" fill="#1d1712"/><circle cx="168" cy="96" r="6" fill="#bdb3a5"/><rect x="196" y="70" width="9" height="6" rx="2" fill="#f2c46b"/></svg>`;
  const PLANT = `<svg viewBox="0 0 80 140" aria-hidden="true"><path d="M40 92C30 70 12 64 6 40c16 6 28 22 34 44zM40 90c4-26 18-44 34-52-2 24-18 40-34 54zM40 92C38 62 30 36 36 8c10 22 10 54 4 84z" fill="#5f7a52"/><path d="M40 92C34 74 22 58 18 30c12 14 20 36 22 62z" fill="#78966a"/><path d="M18 92h44l-6 46H24z" fill="#b8865a"/><path d="M16 88h48v8H16z" fill="#a3734b"/></svg>`;

  function sceneHtml() {
    return `<div class="sb-scene sb-scene-photo" role="img">
      <div class="sb-wall"></div>
      <div class="sb-lamp"><i></i></div>
      <div class="sb-door"><div class="sb-door-window"></div><div class="sb-door-panel a"></div><div class="sb-door-panel b"></div><i class="sb-door-knob"></i>
        <div class="sb-tag"><b class="sb-tag-when"></b><span class="sb-tag-state"></span><em class="sb-stamp">${T('FREE<br>DELIVERY', 'משלוח<br>חינם')}</em></div></div>
      <div class="sb-number">7</div>
      <div class="sb-plant">${PLANT}</div>
      <div class="sb-floor"></div>
      <div class="sb-mat"><span>GREMIER</span></div>
      <div class="sb-van">${VAN}</div>
      <div class="sb-stage"><div class="sb-row"></div></div>
      <p class="sb-empty">${T('Your box lands here', 'הקופסה שלכם תגיע לכאן')}</p>
    </div>`;
  }
  // The doorstep: one live group per mini 4-pack, with four bottles arranged in two rows, dropped in as they're added.
  function updateScene(g) {
    const scene = el.querySelector('.sb-scene'), row = scene.querySelector('.sb-row'), stage = scene.querySelector('.sb-stage');
    const want = [];
    for (const [id, qty] of units()) {
      const p = all().find((x) => String(x.id) === id); if (!p) continue;
      const a = art(p);
      for (let i = 0; i < qty * (a.kind === 'mini' ? 1 : (a.count || 1)); i++) want.push({ key: id + ':' + i, p, a });
    }
    const bottleCount = want.reduce((sum, x) => sum + (x.a.kind === 'mini' ? 4 : 1), 0);
    const shown = want.slice(0, MAX_UNITS), keys = new Set(shown.map((x) => x.key));
    row.querySelectorAll('.sb-item:not(.leaving)').forEach((n) => { if (!keys.has(n.dataset.key)) { n.classList.remove('entering'); n.classList.add('leaving'); setTimeout(() => n.remove(), 260); } });
    let prev = null;
    for (const x of shown) {
      let n = row.querySelector(`.sb-item[data-key="${CSS.escape(x.key)}"]:not(.leaving)`);
      if (!n) {
        n = document.createElement('div'); n.className = 'sb-item entering sb-' + x.a.kind; n.dataset.key = x.key;
        n.style.setProperty('--h', x.a.h); n.style.setProperty('--r', x.a.ratio);
        const img = document.createElement('img'); img.src = x.a.src; img.alt = ''; img.draggable = false; n.append(img);
        if (x.a.kind === 'mini') {
          n.setAttribute('aria-label', nameOf(x.p) + ' · 4 minis');
          for (let j = 1; j < 4; j++) n.append(img.cloneNode());
        }
        setTimeout(() => n.classList.remove('entering'), 600);
      }
      if (prev ? prev.nextSibling !== n : row.firstChild !== n) prev ? prev.after(n) : row.prepend(n);
      prev = n;
    }
    row.querySelector('.sb-more')?.remove();
    if (want.length > MAX_UNITS) row.insertAdjacentHTML('beforeend', `<span class="sb-more">+${want.length - MAX_UNITS}</span>`);
    // Shrink the row to fit the step: widths are known from each photo's proportions.
    const H = scene.clientHeight || 300, W = stage.clientWidth || 400;
    const need = shown.reduce((s, x) => s + (x.a.h / 100) * H * x.a.ratio + 2, 0);
    scene.style.setProperty('--k', Math.min(1, W / Math.max(1, need)).toFixed(3));
    scene.classList.toggle('empty', !want.length);
    scene.classList.toggle('ready', g.ready);
    scene.classList.toggle('free', g.freeOk);
    scene.querySelector('.sb-tag-when').textContent = state.interval === 'weekly' ? T('Every week', 'כל שבוע') : state.window === 'early' ? T('1st–5th monthly', '1–5 בחודש') : state.window === 'mid' ? T('15th–20th monthly', '15–20 בחודש') : T('Every month', 'כל חודש');
    scene.querySelector('.sb-tag-state').textContent = g.ready ? T('Delivery ✓', 'משלוח ✓') : g.coffee ? T('Pickup only', 'איסוף עצמי') : T('Nothing yet', 'עוד ריק');
    scene.setAttribute('aria-label', T(`Your box at the door: ${bottleCount} bottles`, `הקופסה שלכם בדלת: ${bottleCount} בקבוקים`));
  }

  function progressHtml(g) {
    const [big, small] = headline(g), s = suggestion(g), pct = Math.round(g.fill * 100);
    const freeLabel = g.noFree ? T('Delivery', 'משלוח') : T('Free delivery', 'משלוח חינם');
    const freeSub = g.a.fee === 0 ? T('Always, in your area', 'תמיד, באזור שלכם') : g.noFree ? money(g.a.fee) + T(' each time', ' בכל פעם') : T(`${money(g.a.free)}+${g.a.chosen ? '' : ' · ' + title(g.a.name)}`, `${money(g.a.free)}+${g.a.chosen ? '' : ' · ' + g.a.name}`);
    return `<div class="sb-progress">
      <div class="sb-status" role="status" aria-live="polite"><b>${esc(big)}</b><span>${esc(small)}</span></div>
      <div class="sb-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${T('Progress to delivery and free delivery', 'התקדמות למשלוח ולמשלוח חינם')}">
        <i class="sb-fill" style="width:${pct}%"></i>
        <span class="sb-node one${g.ready ? ' done' : ''}">${icons.box}</span>
        <span class="sb-node two${g.freeOk ? ' done' : ''}${g.noFree ? ' off' : ''}">${icons.van}</span>
      </div>
      <div class="sb-legend"><span class="one${g.ready ? ' done' : ''}"><b>${T('Ready to deliver', 'מוכן למשלוח')}</b><small>${T('2 coffees or a 5L', '2 פריטי קפה או 5 ליטר')}</small></span><span class="two${g.freeOk ? ' done' : ''}"><b>${freeLabel}</b><small>${esc(freeSub)}</small></span></div>
      ${s ? `<button type="button" class="sb-quick" data-sb-add="${esc(s.id)}"><img src="${esc(art(s).src)}" alt=""><span>${T('Add', 'הוספת')} <b>${esc(nameOf(s))}</b></span><em>+${money(unitPrice(s))}</em></button>` : ''}
    </div>`;
  }
  function tile(p) {
    const n = state.picks[p.id] || 0, a = art(p), syrup = M().syrup(p);
    return `<div class="sb-tile${n ? ' on' : ''}">
      <button type="button" class="sb-tile-pic" data-sb-add="${esc(p.id)}" aria-label="${T('Add', 'הוספת')} ${esc(nameOf(p))}"><img src="${esc(a.src)}" alt="" loading="lazy">${a.count > 1 ? `<i>×${a.count}</i>` : ''}</button>
      <span class="sb-tile-name">${esc(nameOf(p))}<small>${money(unitPrice(p))}${syrup ? '' : ` <s>${money(Number(p.price))}</s>`}</small></span>
      <span class="sb-step"><button type="button" data-sb-step="${esc(p.id)}" data-d="-1" ${n ? '' : 'disabled'} aria-label="${T('One less', 'אחד פחות')} ${esc(nameOf(p))}">−</button><b aria-live="polite">${n}</b><button type="button" data-sb-step="${esc(p.id)}" data-d="1" ${n >= 20 ? 'disabled' : ''} aria-label="${T('One more', 'עוד אחד')} ${esc(nameOf(p))}">+</button></span>
    </div>`;
  }
  function panelHtml(g) {
    const pool = all().filter((p) => M().eligible(p));
    const per = state.interval === 'weekly' ? T('/week', '/שבוע') : T('/month', '/חודש');
    const q = g.q, saved = q ? q.regular - q.total : 0;
    const others = (typeof cart !== 'undefined' ? cart : []).filter((i) => !i.is_subscription).length;
    const areaChips = zones().map((z) => `<button type="button" data-sb-area="${esc(z.id)}" class="${state.area === z.id ? 'on' : ''}">${esc(title(he() ? z.name_he || z.name_en : z.name_en))}</button>`).join('') + `<button type="button" data-sb-area="other" class="${state.area === 'other' ? 'on' : ''}">${T('Other area', 'אזור אחר')}</button>`;
    return `<div class="sb-panel">
      <h2>${T('What should we bring?', 'מה להביא לכם?')}</h2>
      <div class="sb-chips sb-freq" role="group" aria-label="${T('How often', 'באיזו תדירות')}"><button type="button" data-sb-interval="monthly" class="${state.interval === 'monthly' ? 'on' : ''}">${T('Every month', 'כל חודש')}</button><button type="button" data-sb-interval="weekly" class="${state.interval === 'weekly' ? 'on' : ''}">${T('Every week', 'כל שבוע')}</button></div>
      <p class="sb-lead">${T('10% off every coffee, delivered on repeat. Pause or cancel any time.', '10% הנחה על כל קפה, במשלוח קבוע. אפשר להשהות או לבטל בכל עת.')}</p>
      ${groups.map(([kind, en, hebrew]) => { const list = pool.filter((p) => art(p).kind === kind); return list.length ? `<h3>${T(en, hebrew)}</h3><div class="sb-grid">${list.map(tile).join('')}</div>` : ''; }).join('')}
      <h3>${T('Delivery area', 'אזור משלוח')}</h3>
      <div class="sb-chips sb-areas" role="group" aria-label="${T('Delivery area', 'אזור משלוח')}">${areaChips}</div>
      ${state.interval === 'monthly' ? `<h3>${T('When should it arrive?', 'מתי להגיע?')}</h3>
      <div class="sb-chips sb-when" role="group" aria-label="${T('Delivery window', 'חלון משלוח')}"><button type="button" data-sb-window="early" aria-pressed="${state.window === 'early'}" class="${state.window === 'early' ? 'on' : ''}"><b>${T('Start of the month', 'תחילת החודש')}</b><small>${T('usually the 1st–5th', 'בדרך כלל 1–5 בחודש')}</small></button><button type="button" data-sb-window="mid" aria-pressed="${state.window === 'mid'}" class="${state.window === 'mid' ? 'on' : ''}"><b>${T('Middle of the month', 'אמצע החודש')}</b><small>${T('usually the 15th–20th', 'בדרך כלל 15–20 בחודש')}</small></button></div>` : ''}
      <p class="sb-fine">${T('Syrups stay full price and come with coffee. Billed each cycle until you cancel; delivery is charged per delivery unless it’s free. Delivery dates are targets and can move a few days.', 'סירופים במחיר מלא ומצטרפים לקפה. חיוב בכל מחזור עד לביטול; משלוח נגבה בכל משלוח אלא אם הוא חינם. תאריכי המשלוח הם יעד ועשויים לזוז בכמה ימים.')}</p>
      <div class="sb-foot">
        ${state.confirm && others ? `<div class="sb-confirm" role="alert"><p>${T(`A subscription checks out on its own. Your cart has ${others} other item${others > 1 ? 's' : ''}.`, `מנוי מוזמן לבד. בעגלה יש עוד ${others} פריטים.`)}</p><button type="button" class="sb-cta" data-sb-replace>${T('Remove them and add my subscription', 'להסיר אותם ולהוסיף את המנוי')}</button><button type="button" class="sb-ghost" data-sb-keep>${T('Keep my cart', 'להשאיר את העגלה')}</button></div>`
        : `<button type="button" class="sb-cta" data-sb-go ${q ? '' : 'disabled'}>${q ? `${g.ready ? T('Add subscription', 'הוספת המנוי') : T('Add · pickup only', 'הוספה · איסוף עצמי')} <b>${money(q.total)}${per}</b>` : T('Pick your coffee', 'בחרו קפה')}</button>
        ${q && saved > 0 ? `<small class="sb-saved">${T(`You save ${money(saved)} ${state.interval === 'weekly' ? 'every week' : 'every month'}`, `חוסכים ${money(saved)} ${state.interval === 'weekly' ? 'בכל שבוע' : 'בכל חודש'}`)}</small>` : ''}`}
      </div>
    </div>`;
  }

  function render() {
    if (!el || !state) return;
    const g = progress(), body = el.querySelector('.sb-body'), scroll = el.scrollTop;
    const focused = document.activeElement?.closest?.('[data-sb-step],[data-sb-add],[data-sb-area],[data-sb-interval],[data-sb-window]');
    const focusSel = focused ? ['data-sb-step', 'data-sb-add', 'data-sb-area', 'data-sb-interval', 'data-sb-window'].filter((k) => focused.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(focused.getAttribute(k))}"]`).join('') + (focused.dataset.d ? `[data-d="${focused.dataset.d}"]` : '') : null;
    const inQuick = !!focused?.closest('.sb-quick');
    if (!body.querySelector('.sb-scene')) body.querySelector('.sb-view').insertAdjacentHTML('afterbegin', sceneHtml());
    body.querySelector('.sb-progress-mount').innerHTML = progressHtml(g);
    body.querySelector('.sb-panel-mount').innerHTML = panelHtml(g);
    const per = state.interval === 'weekly' ? T('/wk', '/שבוע') : T('/mo', '/חודש');
    el.querySelector('.sb-total').textContent = g.q ? money(g.q.total) + per : '';
    el.querySelector('.sb-topline i').style.width = Math.round(g.fill * 100) + '%';
    el.querySelector('.sb-topline').classList.toggle('done', g.freeOk);
    updateScene(g);
    el.scrollTop = scroll;
    if (focusSel) (el.querySelector((inQuick ? '.sb-panel ' : '') + focusSel) || el.querySelector(focusSel))?.focus({ preventScroll: true });
  }

  function open(startId, qty = 1) {
    if (!M() || !all().length) return false;
    const start = all().find((p) => String(p.id) === String(startId));
    state = { picks: {}, interval: 'monthly', window: (typeof cart !== 'undefined' && cart.find((i) => i.is_subscription)?.subscription_window) || '', area: '', confirm: false };
    if (start && M().eligible(start)) state.picks[start.id] = Math.max(1, Math.min(20, qty));
    try { const c = (JSON.parse(localStorage.getItem('gremier_checkout_details_v1') || 'null') || {}).city; const z = c && zones().find((x) => [x.name_en, x.name_he].map((s) => String(s || '').toLowerCase()).includes(String(c.en || c.he || '').toLowerCase())); if (z) state.area = z.id; } catch (_) {}
    if (!el) {
      lastFocus = document.activeElement; savedY = scrollY;
      backdrop = document.createElement('div'); backdrop.className = 'sb-backdrop';
      el = document.createElement('section'); el.className = 'sb-world'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'sbTitle'); el.tabIndex = -1;
      el.innerHTML = `<header class="sb-top"><button type="button" class="sb-close" data-sb-close aria-label="${T('Close', 'סגירה')}">×</button><h1 id="sbTitle">${T('Your subscription', 'המנוי שלכם')}</h1><span class="sb-total"></span><span class="sb-topline"><i></i></span></header>
        <div class="sb-body"><div class="sb-view"><div class="sb-progress-mount"></div></div><div class="sb-panel-mount"></div></div>`;
      document.body.append(backdrop, el);
      document.documentElement.classList.add('sb-on');
      if (!history.state?.sbBuild) history.pushState({ ...(history.state || {}), layer: null, sbBuild: true }, '', location.href);
      requestAnimationFrame(() => el?.classList.add('in'));
    }
    render();
    el.querySelector('[data-sb-close]').focus({ preventScroll: true });
    return true;
  }
  function teardown() {
    if (!el) return;
    el.remove(); backdrop.remove(); el = backdrop = state = null;
    document.documentElement.classList.remove('sb-on');
    window.scrollTo(0, savedY);
    lastFocus?.focus?.({ preventScroll: true });
    const then = afterClose; afterClose = null; then?.();
  }
  // Closing walks back the history entry the builder added, so the phone's Back button closes it too.
  function close(then) { afterClose = then || null; if (history.state?.sbBuild) history.back(); else teardown(); }
  addEventListener('popstate', () => { if (el && !history.state?.sbBuild) teardown(); });

  function add() {
    const g = progress(); if (!g.q) return;
    const others = cart.filter((i) => !i.is_subscription);
    if (others.length && !state.confirm) { state.confirm = true; render(); el.querySelector('.sb-confirm [data-sb-replace]')?.focus({ preventScroll: true }); return; }
    const chosen = units().map(([id, qty]) => all().find((p) => String(p.id) === id) && { p: all().find((p) => String(p.id) === id), qty }).filter(Boolean);
    const base = chosen.find((x) => !M().syrup(x.p))?.p;
    const items = chosen.map(({ p, qty }) => ({ product_id: String(p.id), name_en: p.name_en, name_he: p.name_he || p.name_en, price: parseFloat(p.price) || 0, qty, image: typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(p.images?.[0] || '', 100) : '' }));
    const fees = chosen.map((x) => x.p.delivery_price).filter((v) => v != null);
    cart = [{
      id: [base.id, state.interval, ...items.map((i) => `${i.product_id}x${i.qty}`)].join('_'),
      base_product_id: base.id, name_en: 'Coffee subscription', name_he: 'מנוי קפה', price: g.q.total, images: base.images, category: base.category,
      delivery_price: fees.length ? Math.max(...fees.map(Number)) : null, qty: 1, selected_variations: {}, selected_addons: [], bar_extras: null, coffee_bar_configuration: null, selected_guest_price: null,
      is_subscription: true, subscription_interval: state.interval, subscription_window: state.interval === 'monthly' ? state.window || null : null, subscription_items: items,
    }];
    if (typeof updateCartCount === 'function') updateCartCount();
    if (typeof showToast === 'function') showToast(T('Subscription added ✓', 'המנוי נוסף ✓'));
    close(() => { if (typeof openCart === 'function') openCart(); });
  }
  function step(id, d) { const n = Math.max(0, Math.min(20, (state.picks[id] || 0) + d)); if (n) state.picks[id] = n; else delete state.picks[id]; state.confirm = false; render(); }

  document.addEventListener('click', (e) => {
    if (!el) return;
    if (e.target === backdrop) { close(); return; }
    if (!el.contains(e.target)) return;
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    if (t.matches('[data-sb-close]')) close();
    else if (t.dataset.sbStep) step(t.dataset.sbStep, Number(t.dataset.d));
    else if (t.dataset.sbAdd) step(t.dataset.sbAdd, 1);
    else if (t.dataset.sbInterval) { state.interval = t.dataset.sbInterval; render(); }
    else if (t.dataset.sbWindow) { state.window = t.dataset.sbWindow; render(); }
    else if (t.dataset.sbArea) { state.area = state.area === t.dataset.sbArea ? '' : t.dataset.sbArea; render(); }
    else if (t.matches('[data-sb-go],[data-sb-replace]')) add();
    else if (t.matches('[data-sb-keep]')) { state.confirm = false; render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!el) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const list = [...el.querySelectorAll('button:not(:disabled)')], first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  addEventListener('resize', () => { if (el) updateScene(progress()); });

  window.openSubscriptionBuilder = open;
  // Every way into a subscription opens the builder: the card's Subscribe, the product window's
  // Subscribe option, subscription products, and Subscriptions links.
  function hook() {
    window.startProductSubscription = (id) => { document.querySelectorAll(`input[name="subscribe-${CSS.escape(String(id))}"]`).forEach((r) => { r.checked = false; }); open(id); };
    const setSub = window.pdSetSubscribe;
    if (typeof setSub === 'function') window.pdSetSubscribe = function (on) {
      if (!on) return setSub.apply(this, arguments);
      const p = typeof pdCurrentProduct !== 'undefined' ? pdCurrentProduct : null, qty = typeof pdQty !== 'undefined' ? pdQty : 1;
      document.querySelector('#pdSubscriptionSection input[name="pdPurchaseMode"]')?.click?.();
      // Close the product window the normal way (it walks back its own history entry), then open.
      let done = false;
      const go = () => { if (done) return; done = true; removeEventListener('popstate', go); setTimeout(() => open(p?.id, qty), 30); };
      addEventListener('popstate', go); setTimeout(go, 450);
      if (typeof closeProductDrawer === 'function') closeProductDrawer();
    };
    for (const fn of ['openProductDrawer', 'addToCart']) {
      const orig = window[fn];
      if (typeof orig === 'function') window[fn] = function (id) { const p = all().find((x) => String(x.id) === String(id)); if (p && (p.is_subscription || p.category === 'subscriptions')) { open(); return; } return orig.apply(this, arguments); };
    }
    const lang_ = window.toggleLang;
    if (typeof lang_ === 'function') window.toggleLang = function () { const r = lang_.apply(this, arguments); if (el) { el.querySelector('#sbTitle').textContent = T('Your subscription', 'המנוי שלכם'); el.querySelector('.sb-scene')?.remove(); render(); } return r; };
    // "Subscriptions" links (the footer) show the shop and open the builder over it.
    const cat = window.setCategory;
    if (typeof cat === 'function') window.setCategory = function (c) { const r = cat.apply(this, arguments); if (c === 'subscriptions') setTimeout(() => open(), 350); return r; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();
