import { useEffect } from 'react';
import { tap } from '@/utils/a11y.js';

export function WurmReveal({ onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 5600); return () => clearTimeout(t); }, []);
  const clods = [[-70, -90], [-40, -120], [-10, -100], [25, -125], [55, -95], [80, -75], [-95, -60], [95, -55]];
  return (
    <div className="wurm-scrim" onClick={onClose}>
      <div className="wurm-text">Release ze Würm!</div>
      <div className="wurm-stage">
        <div className="wurm-figure"><div className="wurm-body">
          <svg width="200" height="250" viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="wbody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#88d75c" /><stop offset="1" stopColor="#479b32" /></linearGradient></defs>
            <path d="M100 250 C 72 212 120 196 96 162 C 74 132 124 120 100 88" fill="none" stroke="url(#wbody)" strokeWidth="34" strokeLinecap="round" />
            <g stroke="#3c8629" strokeWidth="2.4" strokeLinecap="round" opacity=".5" fill="none">
              <path d="M88 224 q12 -6 24 -2" /><path d="M86 196 q14 -6 26 0" /><path d="M92 168 q12 -6 22 -1" /></g>
            <ellipse cx="100" cy="78" rx="30" ry="28" fill="url(#wbody)" />
            <ellipse cx="100" cy="86" rx="21" ry="15" fill="#c2ef9f" opacity=".4" />
            <g transform="rotate(-15 100 52)">
              <ellipse cx="100" cy="54" rx="28" ry="6" fill="#1b1b21" />
              <rect x="82" y="18" width="36" height="36" rx="3" fill="#1b1b21" />
              <rect x="82" y="45" width="36" height="6" fill="#c0413f" /></g>
            <path d="M73 60 L92 67" stroke="#27331a" strokeWidth="4" strokeLinecap="round" />
            <path d="M129 57 L110 65" stroke="#27331a" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="88" cy="76" rx="8" ry="9" fill="#fff" />
            <circle cx="90" cy="79" r="4" fill="#26331a" /><circle cx="87.5" cy="75" r="1.5" fill="#fff" />
            <ellipse cx="114" cy="74" rx="8" ry="9" fill="#fff" />
            <circle cx="116" cy="77" r="4" fill="#26331a" /><circle cx="113.5" cy="73" r="1.5" fill="#fff" />
            <circle cx="114" cy="74" r="13" fill="none" stroke="#ecc64c" strokeWidth="3.2" />
            <path d="M113 86 Q 122 104 129 111" fill="none" stroke="#ecc64c" strokeWidth="1.8" />
            <circle cx="130" cy="113" r="2.4" fill="#ecc64c" />
            <path d="M82 96 Q 100 115 122 92" fill="none" stroke="#27331a" strokeWidth="3.4" strokeLinecap="round" />
            <path d="M92 101 L96 108 L100 101 Z" fill="#fff" />
          </svg>
        </div></div>
        <div className="wurm-mound">
          {clods.map((c, i) => <span key={i} className="wurm-clod" style={{ '--dx': c[0] + 'px', '--dy': c[1] + 'px', animationDelay: (0.45 + i * 0.025) + 's' }} />)}
          <svg width="280" height="86" viewBox="0 0 280 86" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 86 L0 48 Q 70 16 142 30 Q 214 44 280 22 L280 86 Z" fill="#5a3d27" />
            <path d="M0 50 Q 70 20 142 34 Q 214 48 280 26" fill="none" stroke="#714e34" strokeWidth="6" />
            <ellipse cx="140" cy="33" rx="30" ry="10" fill="#3c2918" />
          </svg>
        </div>
      </div>
      <div className="wurm-hint">muahaha… tap to dismiss</div>
    </div>
  );
}
