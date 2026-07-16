/* Optical alignment for signed values: sign glyphs centre on the maths
   axis below the optical centre of lining digits, so "+8" reads with a
   droopy sign. Lift the sign to the digits' centre; the digits stay put.
   The lift is face-specific: measured 5% of the em for Figtree (was 11%
   for Plus Jakarta Sans) via canvas actualBoundingBox. */
export function Signed({ v }) {
  const n = Math.round(v);
  return <><span className="sgn">{n >= 0 ? '+' : '−'}</span>{Math.abs(n)}</>;
}
