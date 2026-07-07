import { workoutBlocks, ZONE_COLORS, ZONE_LEVEL } from '@/lib/profile.js';

/* The session at a glance: one bar per interval block, width proportional to
   time, height and colour by zone. Renders nothing when the workout has no
   drawable structure (pre-profile cached builds, swims, strength). */
export function WorkoutProfile({ w }) {
  const blocks = workoutBlocks(w);
  if (blocks.length < 2) return null;
  const total = blocks.reduce((a, b) => a + b.min, 0);
  if (!total) return null;
  const H = 40;
  let x = 0;
  return (
    <div className="wprof">
      <svg viewBox={'0 0 100 ' + H} preserveAspectRatio="none" style={{ width: '100%', height: 54, display: 'block' }}>
        {blocks.map((b, i) => {
          const bw = b.min / total * 100;
          const bh = (ZONE_LEVEL[b.zone] || 0.4) * (H - 2);
          const el = <rect key={i} x={x + 0.15} y={H - bh} width={Math.max(bw - 0.3, 0.25)} height={bh}
            fill={ZONE_COLORS[b.zone] || 'var(--track)'} opacity="0.92" />;
          x += bw;
          return el;
        })}
      </svg>
      <div className="wprof-axis"><span>0</span><span>{Math.round(total)} min</span></div>
    </div>
  );
}
