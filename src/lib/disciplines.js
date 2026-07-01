/* Try — discipline display metadata (name, colour, gradient, icon key). UI-facing,
   imported widely, so it lives apart from the pure plan-domain constants. */

export const DISCIPLINES = {
  swim:     { name: 'Swim',     color: '#38bdf8', grad: 'linear-gradient(135deg, #38bdf8, #2563eb)', icon: 'swim' },
  bike:     { name: 'Bike',     color: '#fb923c', grad: 'linear-gradient(135deg, #fbbf24, #f97316)', icon: 'bike' },
  run:      { name: 'Run',      color: '#34d399', grad: 'linear-gradient(135deg, #4ade80, #10b981)', icon: 'run' },
  brick:    { name: 'Brick',    color: '#c084fc', grad: 'linear-gradient(135deg, #c084fc, #8b5cf6)', icon: 'brick' },
  strength: { name: 'Strength', color: '#94a3b8', grad: 'linear-gradient(135deg, #94a3b8, #64748b)', icon: 'strength' },
  rest:     { name: 'Rest',     color: '#3a3f4a', grad: 'linear-gradient(135deg, #3a3f4a, #2a2f38)', icon: 'rest' },
};
