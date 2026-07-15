import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ErrorBoundary } from './ErrorBoundary.jsx';

// The fallback renders with no boundary above it: if IT throws, the user gets
// a white screen at the exact moment they most need information. So it must
// survive every hostile error shape (2026-07-15 field-crash incident).
const fallbackFor = (err) => {
  const eb = new ErrorBoundary({});
  eb.state = { err, nonce: 0 };
  return renderToString(eb.render());
};

describe('ErrorBoundary fallback', () => {
  it('shows the message and stack frames for a normal Error', () => {
    const html = fallbackFor(new Error('boom at startup'));
    expect(html).toContain('Something went wrong');
    expect(html).toContain('boom at startup');
    expect(html).toContain('Reload');
    expect(html).toContain('Clear local data');
  });

  it('survives hostile shapes: throwing getters, plain objects, strings, numbers', () => {
    const hostile = { get message() { throw new Error('gotcha'); }, get stack() { throw new Error('gotcha'); } };
    expect(fallbackFor(hostile)).toContain('Something went wrong');
    expect(fallbackFor({ code: 500 })).toContain('500'); // JSON, not [object Object]
    expect(fallbackFor('string throw')).toContain('string throw');
    expect(fallbackFor(42)).toContain('42');
  });

  it('falsy thrown values still trip the boundary instead of re-rendering crashed children', () => {
    [0, '', false, undefined, null].forEach(v => {
      const s = ErrorBoundary.getDerivedStateFromError(v);
      expect(s.err).toBeTruthy();
    });
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x')).err.message).toBe('x');
  });

  it('renders children untouched when there is no error', () => {
    const eb = new ErrorBoundary({ children: 'app-goes-here' });
    eb.state = { err: null, nonce: 0 };
    expect(renderToString(eb.render())).toContain('app-goes-here');
  });
});
