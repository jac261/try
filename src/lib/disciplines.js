/* Try — discipline display metadata (name, colour, gradient, icon key). UI-facing,
   imported widely, so it lives apart from the pure plan-domain constants. */

export const DISCIPLINES = {
  /* grad is a CSS custom-property reference, not a literal: the gradients
     live in styles.css :root so the smoked theme can rebind them to its 30%
     translucent fills. color stays literal — dots and chart strokes are
     status, identical in both materials, and SVG attributes consume them
     where var() would not resolve. */
  swim:     { name: 'Swim',     color: '#38bdf8', grad: 'var(--grad-swim)', icon: 'swim' },
  bike:     { name: 'Bike',     color: '#fb923c', grad: 'var(--grad-bike)', icon: 'bike' },
  run:      { name: 'Run',      color: '#34d399', grad: 'var(--grad-run)', icon: 'run' },
  brick:    { name: 'Brick',    color: '#c084fc', grad: 'var(--grad-brick)', icon: 'brick' },
  strength: { name: 'Strength', color: '#94a3b8', grad: 'var(--grad-strength)', icon: 'strength' },
  rest:     { name: 'Rest',     color: '#3a3f4a', grad: 'var(--grad-rest)', icon: 'rest' },
};
