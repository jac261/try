import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api.js', () => ({
  getCurrentPlan: vi.fn(),
  createPlan: vi.fn(),
  replaceCurrentPlan: vi.fn(),
  putWorkoutLog: vi.fn(),
  deleteWorkoutLog: vi.fn(),
  putWorkoutMove: vi.fn(),
  deleteWorkoutMove: vi.fn(),
  getWellness: vi.fn(),
  putWellness: vi.fn(),
  toClientState: vi.fn(),
  logToApi: e => ({ completed: !!(e && e.done), completedAtUtc: e && e.at, feel: (e && e.feel) || null, notes: null }),
}));

import * as api from '@/lib/api.js';
import { makeSync } from './sync.js';

const getToken = async () => 'tok';
beforeEach(() => { vi.clearAllMocks(); });

describe('makeSync.hydrate', () => {
  it('maps a server plan through toClientState', async () => {
    api.getCurrentPlan.mockResolvedValue({ ok: true, body: { race: 'olympic' } });
    api.toClientState.mockReturnValue({ plan: { race: 'olympic' }, log: {}, moves: {} });
    const r = await makeSync(getToken).hydrate();
    expect(api.getCurrentPlan).toHaveBeenCalledWith(getToken);
    expect(r.plan.race).toBe('olympic');
  });
  it('returns "none" when signed in with no plan (404)', async () => {
    api.getCurrentPlan.mockResolvedValue({ ok: true, body: null });
    expect(await makeSync(getToken).hydrate()).toBe('none');
  });
  it('returns null on an offline/error response (keep the cache)', async () => {
    api.getCurrentPlan.mockResolvedValue({ ok: false, status: 500, message: 'boom' });
    expect(await makeSync(getToken).hydrate()).toBe(null);
  });
});

describe('makeSync.savePlan', () => {
  it('POSTs a new plan and resolves to the ref→GUID map', async () => {
    api.createPlan.mockResolvedValue({ ok: true, status: 201, body: { race: 'olympic' } });
    api.toClientState.mockReturnValue({ refToId: { '0-0': 'guid-0-0' } });
    const map = await makeSync(getToken).savePlan({ race: 'olympic' });
    expect(api.createPlan).toHaveBeenCalledWith(getToken, { race: 'olympic' });
    expect(api.replaceCurrentPlan).not.toHaveBeenCalled();
    expect(map).toEqual({ '0-0': 'guid-0-0' });
  });
  it('falls back to PUT when the server already has a plan (409)', async () => {
    api.createPlan.mockResolvedValue({ ok: false, status: 409 });
    api.replaceCurrentPlan.mockResolvedValue({ ok: true, status: 200, body: { race: 'olympic' } });
    api.toClientState.mockReturnValue({ refToId: { '0-0': 'guid-x' } });
    const map = await makeSync(getToken).savePlan({ race: 'olympic' });
    expect(api.replaceCurrentPlan).toHaveBeenCalledWith(getToken, { race: 'olympic' });
    expect(map).toEqual({ '0-0': 'guid-x' });
  });
});

describe('makeSync push helpers (keyed by server workout GUID)', () => {
  it('saveLog maps the entry via logToApi', async () => {
    api.putWorkoutLog.mockResolvedValue({ ok: true });
    await makeSync(getToken).saveLog('guid-0-0', { done: true, at: '2026-07-06T10:00:00Z', feel: 'hard' });
    expect(api.putWorkoutLog).toHaveBeenCalledWith(getToken, 'guid-0-0', { completed: true, completedAtUtc: '2026-07-06T10:00:00Z', feel: 'hard', notes: null });
  });
  it('saveMove sends movedDate', async () => {
    api.putWorkoutMove.mockResolvedValue({ ok: true });
    await makeSync(getToken).saveMove('guid-0-0', '2026-07-09');
    expect(api.putWorkoutMove).toHaveBeenCalledWith(getToken, 'guid-0-0', { movedDate: '2026-07-09', reason: null });
  });
  it('removeLog / removeMove call the delete endpoints', async () => {
    api.deleteWorkoutLog.mockResolvedValue({ ok: true });
    api.deleteWorkoutMove.mockResolvedValue({ ok: true });
    const s = makeSync(getToken);
    await s.removeLog('guid-0-0');
    await s.removeMove('guid-0-0');
    expect(api.deleteWorkoutLog).toHaveBeenCalledWith(getToken, 'guid-0-0');
    expect(api.deleteWorkoutMove).toHaveBeenCalledWith(getToken, 'guid-0-0');
  });
});

describe('makeSync wellness', () => {
  it('loadWellness returns the server records array', async () => {
    api.getWellness.mockResolvedValue({ ok: true, body: [{ date: '2026-07-01', hrv: 60 }] });
    const recs = await makeSync(getToken).loadWellness();
    expect(recs).toEqual([{ date: '2026-07-01', hrv: 60 }]);
  });
  it('loadWellness returns null on an offline/error response (keep the cache)', async () => {
    api.getWellness.mockResolvedValue({ ok: false, status: 500 });
    expect(await makeSync(getToken).loadWellness()).toBe(null);
  });
  it('saveWellness upserts a record', async () => {
    api.putWellness.mockResolvedValue({ ok: true });
    await makeSync(getToken).saveWellness({ date: '2026-07-02', hrv: 55 });
    expect(api.putWellness).toHaveBeenCalledWith(getToken, { date: '2026-07-02', hrv: 55 });
  });
});
