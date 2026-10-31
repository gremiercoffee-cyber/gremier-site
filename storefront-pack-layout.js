/* Stable physical slots; independent of catalog ordering and cart pricing. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PackSceneSlots = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  function reconcile(previous, picks) {
    const remaining = Object.fromEntries(Object.entries(picks || {}).map(([id, n]) => [id, Math.min(6, Math.max(0, Math.floor(Number(n) || 0)))]));
    const slots = Array.from({length:6}, (_, i) => {
      const id = previous?.[i];
      if (id && remaining[id] > 0) { remaining[id]--; return id; }
      return null;
    });
    for (const [id, count] of Object.entries(remaining)) {
      for (let n=0; n<count; n++) {
        const free = slots.indexOf(null);
        if (free < 0) return slots;
        slots[free] = id;
      }
    }
    return slots;
  }
  return {reconcile};
});
