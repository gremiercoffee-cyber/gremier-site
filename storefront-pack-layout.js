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
  // Coordinates measured from the generated shallow tray. Bottle bases sit
  // below the compartment rim so the foreground walls hide the bare glass.
  function geometry(slot, pool) {
    const back = slot < 3, col = slot % 3;
    const tray = {left:15,width:70,bottom:5,ratio:pool === 'minis' ? 5.7 : 5.2};
    const trayHeight = tray.width * 1.65 / tray.ratio;
    const floor = back ? .30 : .72;
    const center = back ? [.24,.50,.76][col] : [.17,.50,.83][col];
    const width = pool === 'minis' ? (back ? 20 : 21.5) : (back ? 13 : 14);
    const insertionDepth = 3.2;
    return {left:tray.left+tray.width*center-width/2, bottom:tray.bottom+trayHeight*(1-floor)-insertionDepth,width,height:back?76:80,z:back?5:15};
  }
  return {reconcile,geometry};
});
