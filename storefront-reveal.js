/* One quiet entrance for off-screen content. Nothing is hidden while waiting. */
(function () {
  'use strict';
  if (!window.IntersectionObserver || !window.MutationObserver) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const targets = '.discovery-route,.section-header,.shelf-heading,.product-card,.why-item,.cbp-step,.pl-q,.bb-build-title,.bb-take-home,.shop-bar-route,.gcx-preview-col,.gcx-form,.account-profile-card,.account-points-card,.order-card';
  const seen = new WeakSet(), watching = new Set();
  let frame = 0;
  const show = (el, animate) => {
    observer.unobserve(el); watching.delete(el); seen.add(el);
    if (!animate || motion.matches) return;
    el.classList.add('gremier-enter');
    el.addEventListener('animationend', () => el.classList.remove('gremier-enter'), { once: true });
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target.closest('.page.active')) show(entry.target, true);
    }
  }, { rootMargin: '0px 0px 24px 0px', threshold: 0 });
  function scan() {
    frame = 0;
    for (const el of watching) {
      if (!el.isConnected) { observer.unobserve(el); watching.delete(el); }
    }
    if (motion.matches) return;
    const page = document.querySelector('.page.active');
    if (!page) return;
    for (const el of page.querySelectorAll(targets)) {
      if (seen.has(el) || el.parentElement?.closest(targets)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Visible content, including a restored scroll position, is ready immediately.
      if (r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0) show(el, false);
      else if (!watching.has(el)) { watching.add(el); observer.observe(el); }
    }
    for (const img of page.querySelectorAll('img:not([loading])')) {
      if (img.fetchPriority === 'high') continue;
      if (img.getBoundingClientRect().top > innerHeight + 100) { img.loading = 'lazy'; img.decoding = 'async'; }
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
  new MutationObserver(records => {
    if (records.some(r => r.type === 'childList' || r.target.matches?.('.page'))) schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  // Keyboard focus always takes precedence over a decorative entrance.
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.(targets);
    if (el) { show(el, false); el.classList.remove('gremier-enter'); }
  });
  motion.addEventListener?.('change', () => {
    if (motion.matches) {
      observer.disconnect(); watching.clear();
      document.querySelectorAll('.gremier-enter').forEach(el => el.classList.remove('gremier-enter'));
    } else schedule();
  });
  scan();
})();
