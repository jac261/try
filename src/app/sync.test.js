import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api.js', () => ({
  getCurrentPlan: vi.fn(),
  createPlan: vi.fn(),
  replaceCurrentPlan: vi.fn(),
  putWorkoutLog: vi.fn(),
  deleteWorkoutLog: vi.fn(),
  putWorkoutMove: vi.fn(),
  deleteWorkoutMove: vi.fn(),
  putWorkoutAdjustment: vi.fn(),
  deleteWorkoutAdjustment: vi.fn(),
  getWellness: vi.fn(),
  syncWellness: vi.fn(),
  getIntervalsActivities: vi.fn(),
  putPlannedEvents: vi.fn(),
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

describe('makeSync.backfillWellness', () => {
  it('requests the deep window and returns the list', async () => {
    api.syncWellness.mockResolvedValue({ ok: true, body: [{ date: '2025-07-06', ctl: 40 }] });
    const recs = await makeSync(getToken).backfillWellness();
    expect(api.syncWellness).toHaveBeenCalledWith(getToken, 365);
    expect(recs).toEqual([{ date: '2025-07-06', ctl: 40 }]);
  });
  it('returns null on failure (offline / not connected)', async () => {
    api.syncWellness.mockResolvedValue({ ok: false, status: 404 });
    expect(await makeSync(getToken).backfillWellness()).toBe(null);
  });
});

describe('makeSync.loadActivities', () => {
  it('returns the passthrough list with the default window', async () => {
    api.getIntervalsActivities.mockResolvedValue({ ok: true, body: [{ id: 'a1', date: '2026-07-06', type: 'Run' }] });
    const acts = await makeSync(getToken).loadActivities();
    expect(api.getIntervalsActivities).toHaveBeenCalledWith(getToken, 10);
    expect(acts).toEqual([{ id: 'a1', date: '2026-07-06', type: 'Run' }]);
  });
  it('returns null when not connected or on an older backend (404)', async () => {
    api.getIntervalsActivities.mockResolvedValue({ ok: false, status: 404 });
    expect(await makeSync(getToken).loadActivities()).toBe(null);
  });
});

describe('makeSync.pushWatchEvents', () => {
  it('PUTs the desired window and returns the reconcile counts', async () => {
    api.putPlannedEvents.mockResolvedValue({ ok: true, body: { created: 2, removed: 1, unchanged: 3 } });
    const body = { oldest: '2026-07-09', newest: '2026-08-05', events: [] };
    const r = await makeSync(getToken).pushWatchEvents(body);
    expect(api.putPlannedEvents).toHaveBeenCalledWith(getToken, body);
    expect(r).toEqual({ created: 2, removed: 1, unchanged: 3 });
  });
  it('returns null when not connected or on an older backend (404)', async () => {
    api.putPlannedEvents.mockResolvedValue({ ok: false, status: 404 });
    expect(await makeSync(getToken).pushWatchEvents({ events: [] })).toBe(null);
  });
});

describe('makeSync.refreshWellness', () => {
  it('returns the proxy-synced list when the integration is connected', async () => {
    api.syncWellness.mockResolvedValue({ ok: true, body: [{ date: '2026-07-01', hrv: 60 }] });
    const recs = await makeSync(getToken).refreshWellness();
    expect(recs).toEqual([{ date: '2026-07-01', hrv: 60 }]);
    expect(api.getWellness).not.toHaveBeenCalled();
  });
  it('falls back to the plain GET when sync 404s (not connected)', async () => {
    api.syncWellness.mockResolvedValue({ ok: false, status: 404 });
    api.getWellness.mockResolvedValue({ ok: true, body: [{ date: '2026-07-02', hrv: 55 }] });
    const recs = await makeSync(getToken).refreshWellness();
    expect(recs).toEqual([{ date: '2026-07-02', hrv: 55 }]);
  });
  it('returns null when both are unreachable (keep the cache)', async () => {
    api.syncWellness.mockResolvedValue({ ok: false, status: null });
    api.getWellness.mockResolvedValue({ ok: false, status: null });
    expect(await makeSync(getToken).refreshWellness()).toBe(null);
  });
});

describe('makeSync adjustments (adaptive engine, dormant until backend ships)', () => {
  it('saveAdjustment PUTs the eased state keyed by workout GUID', async () => {
    api.putWorkoutAdjustment.mockResolvedValue({ ok: true });
    await makeSync(getToken).saveAdjustment('guid-0-1', { kind: 'ease', easedFrom: 'Threshold', at: '2026-07-04T08:00:00Z' });
    expect(api.putWorkoutAdjustment).toHaveBeenCalledWith(getToken, 'guid-0-1', { kind: 'ease', easedFrom: 'Threshold', at: '2026-07-04T08:00:00Z' });
  });
  it('removeAdjustment DELETEs it', async () => {
    api.deleteWorkoutAdjustment.mockResolvedValue({ ok: true });
    await makeSync(getToken).removeAdjustment('guid-0-1');
    expect(api.deleteWorkoutAdjustment).toHaveBeenCalledWith(getToken, 'guid-0-1');
  });
});
