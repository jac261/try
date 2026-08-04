// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Icon } from '@/components/Icon.jsx';

/* The glass emboss (Icons.dc.html) draws the same path string three times.
   These tests pin the two rules that are NOT in the doc — the size threshold
   and the logo exemption — because both are ours and both would otherwise be
   silently undone by anyone tidying this component. */

// Counts the copies of the icon's own geometry, not the wrapper groups: a
// group with no paths in it would still satisfy a <g> count.
const copies = (html, fragment) => html.split(fragment).length - 1;

describe('Icon', () => {
  it('draws a single flat copy below the emboss threshold', () => {
    // 18px is the app's commonest icon size, where the .55-unit offset would
    // land 0.41 CSS pixels away and read as a smudge rather than as depth.
    const html = renderToString(<Icon name="today" size={18} />);
    expect(copies(html, 'r="3.8"')).toBe(1);
    expect(html).not.toContain('translate(.55 .75)');
  });

  it('lights the icon at and above the threshold, shadow under highlight under stroke', () => {
    const html = renderToString(<Icon name="today" size={26} />);
    expect(copies(html, 'r="3.8"')).toBe(3);
    // order matters: both offset copies must sit BEFORE the real stroke
    const shadow = html.indexOf('rgba(0,0,0,.55)');
    const highlight = html.indexOf('rgba(255,255,255,.55)');
    expect(shadow).toBeGreaterThan(-1);
    expect(highlight).toBeGreaterThan(shadow);
    expect(html.lastIndexOf('r="3.8"')).toBeGreaterThan(highlight);
  });

  it('re-lights without redrawing: every copy is the same geometry', () => {
    // The doc's phrase is "unchanged in geometry". If a future change makes
    // the copies diverge, the emboss has become a second icon set.
    const html = renderToString(<Icon name="flame" size={32} />);
    const paths = [...html.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
    expect(paths).toHaveLength(3);
    expect(new Set(paths).size).toBe(1);
  });

  it('never lights the brand mark, at any size', () => {
    // The single un-embossed icon in the doc's sheet of 32. The app draws the
    // logo at 26, 34 and 64, so the size rule alone would have lit it.
    [26, 34, 64].forEach(size => {
      const html = renderToString(<Icon name="logo" size={size} />);
      expect(html).not.toContain('translate(.55 .75)');
      expect(copies(html, 'M12 4.07 L21.2 20 L2.8 20 Z')).toBe(1);
    });
  });

  it('renders an empty svg for an unknown name rather than throwing', () => {
    const html = renderToString(<Icon name="not-an-icon" size={64} />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('translate(.55 .75)');
  });
});
