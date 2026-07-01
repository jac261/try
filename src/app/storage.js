/* ---------------- persistence ---------------- */
export const NS = 'try.';
// One-time migration: copy any legacy "triflow.*" data to "try.*" so saved plans
// survive the rename to Try. Only copies when the new key is absent.
['plan', 'log', 'moves'].forEach(k => {
  try { const old = localStorage.getItem('triflow.' + k); if (old != null && localStorage.getItem(NS + k) == null) localStorage.setItem(NS + k, old); } catch (e) {}
});
export const LS = {
  load(k, fb) { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
  save(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} },
  clear() { ['plan', 'log', 'moves'].forEach(k => localStorage.removeItem(NS + k)); },
};
