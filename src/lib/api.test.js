import { describe, it, expect, vi, afterEach } from 'vitest';
import { toClientState, logToApi, getMe, getCurrentPlan, createPlan, getWellness, putWellness } from './api.js';

describe('toClientState', () => {
  const resp = {
    race: 'olympic', createdAt: '2026-07-01T00:00:00Z', totalWeeks: 2,
    profile: { name: 'X' }, paces: { ftp: 250 },
    weeks: [{
      index: 0, phase: 'Base', isRecovery: false, start: '2026-07-06', totalMin: 60,
      workouts: [
        {
          id: 'guid-0-0', clientWorkoutRef: '0-0', week: 0, phase: 'Base', date: '2026-07-06',
          discipline: 'run', role: 'quality', type: 'Tempo', title: 'Tempo Run',
          durationMin: 50, distance: 8.5, unit: 'km', key: false, race: false, test: false, second: false,
          segments: [{ label: 'Warm-up', min: 12, detail: 'easy' }],
          log: { completed: true, completedAtUtc: '2026-07-06T10:00:00Z', feel: 'hard' },
          move: { movedDate: '2026-07-07' },
        },
        {
          id: 'guid-0-1', clientWorkoutRef: '0-1', week: 0, phase: 'Base', date: '2026-07-07',
          discipline: 'rest', type: 'Rest', title: 'Rest', durationMin: 0,
          key: false, race: false, test: false, second: false, segments: [],
        },
      ],
    }],
    logs: [], moves: [],
  };

  it('rehydrates plan/log/moves/refToId from a PlanResponse', () => {
    const { plan, log, moves, refToId } = toClientState(resp);
    expect(plan.race).toBe('olympic');
    expect(plan.totalWeeks).toBe(2);
    expect(plan.weeks[0].workouts[0].id).toBe('0-0');
    expect(plan.weeks[0].workouts[0].segments[0]).toEqual({ label: 'Warm-up', min: 12, detail: 'easy' });
    expect(log['0-0']).toEqual({ done: true, at: '2026-07-06T10:00:00Z', feel: 'hard' });
    expect(moves['0-0']).toBe('2026-07-07');
    expect(log['0-1']).toBeUndefined();
    // client ref → server workout GUID (needed by the log/move endpoints)
    expect(refToId).toEqual({ '0-0': 'guid-0-0', '0-1': 'guid-0-1' });
  });

  it('returns null for a null response', () => {
    expect(toClientState(null)).toBe(null);
  });
});

describe('logToApi', () => {
  it('maps our log entry to the API body', () => {
    expect(logToApi({ done: true, at: '2026-07-06T10:00:00Z', feel: 'hard' }))
      .toEqual({ completed: true, completedAtUtc: '2026-07-06T10:00:00Z', feel: 'hard', notes: null });
  });
});

describe('request layer', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const getToken = async () => 'tok';

  it('sends a Bearer token and parses JSON', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'abc' }) }));
    const r = await getMe(getToken);
    expect(r.ok).toBe(true);
    expect(r.body.id).toBe('abc');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/me');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('treats a 404 current-plan as "no plan yet" (ok, null)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    const r = await getCurrentPlan(getToken);
    expect(r.ok).toBe(true);
    expect(r.body).toBe(null);
  });

  it('serialises a JSON body for POST', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 201, text: async () => '{}' }));
    await createPlan(getToken, { race: 'olympic' });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ race: 'olympic' });
  });

  it('fails gracefully when getToken is not available', async () => {
    const r = await getMe(null);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not ready/i);
  });

  it('getWellness reads the wellness list', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify([{ date: '2026-07-01', hrv: 60 }]) }));
    const r = await getWellness(getToken);
    expect(r.ok).toBe(true);
    expect(r.body[0].date).toBe('2026-07-01');
    expect(global.fetch.mock.calls[0][0]).toContain('/api/wellness');
  });

  it('putWellness upserts a record at its date', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    await putWellness(getToken, { date: '2026-07-02', hrv: 55, sleepH: 7 });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/wellness/2026-07-02');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ date: '2026-07-02', hrv: 55, sleepH: 7 });
  });
});

describe('integrations (intervals.icu)', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const getToken = async () => 'tok';

  it('connect PUTs the credentials and syncWellness POSTs', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ connected: true, athleteId: 'i1' }) }));
    const { connectIntervalsIntegration, syncWellness } = await import('./api.js');
    const r = await connectIntervalsIntegration(getToken, 'i1', 'key');
    expect(r.ok).toBe(true);
    let [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/integrations/intervals-icu');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ athleteId: 'i1', apiKey: 'key' });

    await syncWellness(getToken);
    [url, opts] = global.fetch.mock.calls[1];
    expect(url).toContain('/api/wellness/sync');
    expect(opts.method).toBe('POST');
  });
});
