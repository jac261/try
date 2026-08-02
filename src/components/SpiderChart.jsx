import * as T from '@/lib';

/* The spider chart, as data-driven SVG. No chart library: the app ships no
 * charting dependency and a radar is forty lines of trigonometry.
 *
 * The RINGS COME FROM THE SPIDER OBJECT, not from this component. The swim
 * and run bring the four named Try levels; the bike brings its own
 * limiter / your-shape / strength bands, because its scores are deviations
 * from the rider's own mean and drawing them on level rings would claim a
 * cross-athlete comparison the profile module refuses to make.
 *
 * Approximate axes (projections, flat-CSS fallbacks) render as a hollow
 * point and pick up the same ~ convention the whole app uses; measured axes
 * are solid. The polygon is drawn only through axes that have a position, so
 * a dormant axis is a visible gap rather than a fabricated zero.
 */

// room outside the plotted square for the axis labels, in viewBox units
const LABEL_PAD = 34;

const polar = (cx, cy, r, i, n) => {
  const a = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

export function SpiderChart({ spider, color = 'var(--accent)', fmtValue, size = 240 }) {
  if (!spider) return null;
  if (!spider.axes) {
    return spider.reason
      ? <div className="lead" style={{ fontSize: 12 }}>{spider.reason}</div>
      : null;
  }
  const axes = spider.axes;
  const n = axes.length;
  const cx = size / 2, cy = size / 2;
  // POS_MAX in the engine is 1.08; leave label headroom beyond it
  const R = size / 2 - 34;
  const pt = (pos, i) => polar(cx, cy, pos * R, i, n);

  const drawn = axes.map((ax, i) => ({ ax, i, p: ax.position != null ? pt(ax.position, i) : null }));
  const poly = drawn.filter(d => d.p);

  return (
    <div className="center" style={{ margin: '4px 0' }}>
      {/* The viewBox carries horizontal padding the box itself does not.
          Axis labels sit at 1.26 x radius, so on a pentagon the left and
          right spokes centre their text near the edges and anything longer
          than about eight characters ran off both sides. Short labels helped
          and were not enough (Endurance, Anaerobic still clipped), because
          the cause is geometric rather than lexical: the text needs room
          OUTSIDE the plotted square. Padding the viewBox gives it that and
          scales with the chart instead of being tuned per label. */}
      <svg width={size} height={size} viewBox={-LABEL_PAD + ' 0 ' + (size + LABEL_PAD * 2) + ' ' + size} role="img"
        aria-label={'Performance chart, ' + (T.SPIDER_SOURCES[spider.source] ? T.SPIDER_SOURCES[spider.source].label : spider.source)}>
        {/* rings, labelled on the vertical axis */}
        {(spider.rings || []).map(ring => (
          <g key={ring.label}>
            <polygon
              points={axes.map((_, i) => pt(ring.radius, i).join(',')).join(' ')}
              fill="none" stroke="var(--line)" strokeWidth="1" opacity="0.7" />
            <text x={cx + 4} y={cy - ring.radius * R - 2} fontSize="8" fill="var(--muted)">{ring.label}</text>
          </g>
        ))}
        {/* spokes and axis labels */}
        {axes.map((ax, i) => {
          const [x, y] = pt(1.08, i);
          const [lx, ly] = pt(1.26, i);
          return (
            <g key={ax.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" opacity="0.5" />
              <text x={lx} y={ly} fontSize="10" fill="var(--ink)" textAnchor="middle" dominantBaseline="middle">
                {ax.label}
              </text>
              {ax.value != null && (
                <text x={lx} y={ly + 11} fontSize="8.5" fill="var(--muted)" textAnchor="middle" dominantBaseline="middle">
                  {(ax.measured ? '' : '~') + (fmtValue ? fmtValue(ax) : ax.value)}
                </text>
              )}
            </g>
          );
        })}
        {/* the athlete */}
        {poly.length >= 3 && (
          <polygon points={poly.map(d => d.p.join(',')).join(' ')}
            fill={color} opacity="0.18" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        )}
        {poly.map(d => (
          <circle key={d.ax.key} cx={d.p[0]} cy={d.p[1]} r="3.5"
            /* transparent, not the card colour: an unmeasured point is a HOLE.
               Painting it var(--card) only ever worked because the card was
               opaque and matched — on a glass pane it became a solid slab. */
            fill={d.ax.measured ? color : 'transparent'} stroke={color} strokeWidth="2" />
        ))}
      </svg>
      <div className="hint" style={{ marginTop: 2 }}>
        {(T.SPIDER_SOURCES[spider.source] ? T.SPIDER_SOURCES[spider.source].label + ' · ' : '')}
        solid points are measured, hollow are projections
      </div>
    </div>
  );
}
