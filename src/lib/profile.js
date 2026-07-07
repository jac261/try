/* Workout profile: turn a session's segments into drawable intensity blocks
   (x = time, height/colour = zone) for the interval graphic. A segment either
   carries explicit `blocks` (interval patterns, expanded rep by rep at build
   time) or a `zone` for one steady bar; timed segments without either come
   from builds that predate the profile, in which case no profile is shown
   rather than a misleading partial one. Untimed segments (T2, swim distances)
   never draw. */

export const ZONE_COLORS = { Z1: '#2dd4bf', Z2: '#34d399', Z3: '#facc15', Z4: '#fb923c', Z5: '#ef4444' };
export const ZONE_LEVEL = { Z1: 0.3, Z2: 0.48, Z3: 0.66, Z4: 0.84, Z5: 1 };

export function workoutBlocks(w) {
  const out = [];
  for (const s of (w && w.segments) || []) {
    if (s.blocks) s.blocks.forEach(b => { if (b.min > 0) out.push(b); });
    else if (s.min && s.zone) out.push({ min: s.min, zone: s.zone });
    else if (s.min) return []; // pre-profile build → hide rather than mislead
  }
  return out;
}
