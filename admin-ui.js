/* Shared overflow actions. Only explicitly marked, non-React controls are moved. */
(function () {
  'use strict';
  let active = null, sequence = 0;
  function close(restoreFocus = false) {
    if (!active) return;
    const { panel, trigger, restore } = active;
    active = null;
    restore?.(panel);
    panel.remove();
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }
  function open(trigger, content, restore) {
    if (active?.trigger === trigger) { close(true); return; }
    close();
    const panel = document.createElement('div');
    panel.className = 'app-action-popover';
    panel.id = 'app-actions-' + (++sequence);
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'More actions');
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'true');
    content(panel);
    document.body.append(panel);
    active = { panel, trigger, restore };
    const rect = trigger.getBoundingClientRect(), box = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(rect.right - box.width, innerWidth - box.width - 8)) + 'px';
    panel.style.top = Math.max(8, rect.bottom + box.height + 8 <= innerHeight ? rect.bottom + 6 : rect.top - box.height - 6) + 'px';
    panel.querySelector('button:not(:disabled),a[href],select:not(:disabled)')?.focus();
  }
  // React callers provide callbacks; their rendered nodes remain under React's ownership.
  window.adminShowActions = function (event, items) {
    event.stopPropagation();
    open(event.currentTarget, panel => items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = item.label;
      button.disabled = !!item.disabled;
      if (item.danger) button.className = 'action-danger';
      button.onclick = () => { close(true); item.run(); };
      panel.append(button);
    }));
  };
  function enhance() {
    document.querySelectorAll('[data-action-menu]:not([data-menu-ready])').forEach(group => {
      group.dataset.menuReady = 'true';
      // A menu with a single action only adds a tap: leave that control in place.
      if (group.children.length <= 1) return;
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'app-more-button'; trigger.textContent = '⋯';
      trigger.setAttribute('aria-label', group.dataset.actionMenu || 'More actions');
      trigger.title = trigger.getAttribute('aria-label');
      trigger.setAttribute('aria-expanded', 'false');
      const items = document.createElement('span');
      items.hidden = true;
      while (group.firstChild) items.append(group.firstChild);
      group.append(trigger, items);
      trigger.onclick = event => {
        event.stopPropagation();
        // Close restores the previous group's actual controls and their listeners.
        if (active?.trigger === trigger) { close(true); return; }
        close();
        open(trigger, panel => { while (items.firstChild) panel.append(items.firstChild); },
          panel => { while (panel.firstChild) items.append(panel.firstChild); });
      };
    });
  }
  document.addEventListener('click', event => {
    if (!active) return;
    if (active.panel.contains(event.target)) {
      if (event.target.closest('button,a')) close(true);
    } else if (!active.trigger.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (event.target.tagName === 'SELECT' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const items = [...active.panel.querySelectorAll('button:not(:disabled),a[href],select:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', event => { if (active && !active.panel.contains(event.target)) close(); }, true);
  let queued = false;
  new MutationObserver(() => {
    if (active && !active.trigger.isConnected) close();
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; enhance(); }); }
  }).observe(document.documentElement, { childList: true, subtree: true });
  enhance();
})();
