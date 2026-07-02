import { describe, it, expect } from 'vitest';
import { clamp, round5, lerp, fmtPace, parseTimeToSec, fmtDuration } from './units.js';

describe('units', () => {
  it('clamp bounds a value', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('round5 rounds to nearest 5 with a floor of 5', () => {
    expect(round5(12)).toBe(10);
    expect(round5(13)).toBe(15);
    expect(round5(1)).toBe(5);
  });

  it('lerp interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('fmtPace formats seconds/km as m:ss', () => {
    expect(fmtPace(305)).toBe('5:05');
    expect(fmtPace(270)).toBe('4:30');
  });

  it('parseTimeToSec handles mm:ss, h:mm:ss, and bad input', () => {
    expect(parseTimeToSec('22:30')).toBe(1350);
    expect(parseTimeToSec('1:00:00')).toBe(3600);
    expect(parseTimeToSec('')).toBe(null);
    expect(parseTimeToSec('abc')).toBe(null);
  });

  it('fmtDuration formats minutes', () => {
    expect(fmtDuration(45)).toBe('45 min');
    expect(fmtDuration(90)).toBe('1h 30m');
    expect(fmtDuration(120)).toBe('2h');
  });
});
