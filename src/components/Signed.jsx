/* Optical alignment for signed values: in Plus Jakarta Sans the + and −
   glyphs centre on the maths axis, ~12% of the em below the optical centre of
   lining digits, so "+8" reads with a droopy sign. Lift the sign to the
   digits' centre; the digits stay put. (SVG chart labels do the same with a
   tspan dy shift.) */
export function Signed({ v }) {
  const n = Math.round(v);
  return <><span className="sgn">{n >= 0 ? '+' : '−'}</span>{Math.abs(n)}</>;
}
