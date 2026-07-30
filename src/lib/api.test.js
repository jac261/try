import { describe, it, expect, vi, afterEach } from 'vitest';
import { toClientState, logToApi, reviewToApi, reviewBodyToApi, REVIEW_SCHEMA_VERSION, getMe, getCurrentPlan, createPlan, getWellness, putWellness } from './api.js';

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

  it('restores the recorded moving time from the synced calibration note', () => {
    // actualMin has no backend field of its own — it rides in the "cal:" note the
    // server stores verbatim, and hydrate must recover it on any device.
    const note = 'cal:' + JSON.stringify({ v: 4, score: 88, date: '2026-07-06', actualMin: 42 });
    const r = JSON.parse(JSON.stringify(resp));
    r.weeks[0].workouts[0].log = { completed: true, completedAtUtc: '2026-07-06T10:00:00Z', feel: 'hard', notes: note };
    const { log } = toClientState(r);
    expect(log['0-0'].actualMin).toBe(42);
    expect(log['0-0'].notes).toBe(note);
    // a human note (or garbage) never crashes the parse and yields no actualMin
    r.weeks[0].workouts[0].log.notes = 'felt great out there';
    expect(toClientState(r).log['0-0'].actualMin).toBeUndefined();
    r.weeks[0].workouts[0].log.notes = 'cal:{broken json';
    expect(toClientState(r).log['0-0'].actualMin).toBeUndefined();
  });

  it('returns null for a null response', () => {
    expect(toClientState(null)).toBe(null);
  });

  it('phantom log stubs (completed:false, no feel/notes) never become entries', () => {
    // The 2026-07-11 incident: stub rows marked a whole upcoming week as done
    // and emptied the watch push. Existence of an entry means "done" app-wide.
    const r = JSON.parse(JSON.stringify(resp));
    r.weeks[0].workouts[0].log = { completed: false, completedAtUtc: null, feel: null, notes: null };
    r.logs = [{ clientWorkoutRef: '0-1', completed: false }];
    const { log } = toClientState(r);
    expect(log['0-0']).toBeUndefined();
    expect(log['0-1']).toBeUndefined();
    // a feel-only row is meaningful and survives
    r.weeks[0].workouts[0].log = { completed: false, feel: 'hard' };
    expect(toClientState(r).log['0-0'].feel).toBe('hard');
  });

  it('derives the tune-up flag: RACE-typed but not THE race → bRace', () => {
    // The backend has no bRace column; the flag must survive hydrate by derivation.
    const r = JSON.parse(JSON.stringify(resp));
    r.weeks[0].workouts[0] = {
      ...r.weeks[0].workouts[0],
      type: 'RACE', title: 'TUNE-UP — Sprint Triathlon', race: false, log: undefined, move: undefined,
    };
    const { plan } = toClientState(r);
    expect(plan.weeks[0].workouts[0].bRace).toBe(true);
    // the goal race itself must never gain the flag
    r.weeks[0].workouts[0].race = true;
    expect(toClientState(r).plan.weeks[0].workouts[0].bRace).toBeUndefined();
  });

  it('reconstructs the fields the server does not store: custom from role, seed from the week', () => {
    const r2 = JSON.parse(JSON.stringify(resp));
    r2.weeks[0].workouts[0].role = 'custom';
    r2.weeks.push({ index: 3, phase: 'Base', isRecovery: true, start: '2026-07-27', totalMin: 30, workouts: [
      { id: 'guid-3-1', clientWorkoutRef: '3-1', week: 3, phase: 'Base', date: '2026-07-28', discipline: 'run', role: 'quality', type: 'Easy', title: 'Easy Run', durationMin: 35, key: false, race: false, test: false, second: false, segments: [] },
    ] });
    const { plan } = toClientState(r2);
    expect(plan.weeks[0].workouts[0].custom).toBe(true);   // Added tag + Remove survive hydrate
    expect(plan.weeks[0].workouts[1].custom).toBe(undefined);
    expect(plan.weeks[0].workouts[0].seed).toBe(0);        // normal week → week index
    expect(plan.weeks[1].workouts[0].seed).toBe(0);        // recovery week → pinned 0
  });

  it('passes segment profile fields through when the server starts echoing them', () => {
    const r2 = JSON.parse(JSON.stringify(resp));
    r2.weeks[0].workouts[0].segments = [{ label: 'Main', min: 20, detail: 'x', zone: 'Z4', blocks: [{ min: 9, zone: 'Z4' }] }];
    const { plan } = toClientState(r2);
    expect(plan.weeks[0].workouts[0].segments[0].zone).toBe('Z4');
    expect(plan.weeks[0].workouts[0].segments[0].blocks).toEqual([{ min: 9, zone: 'Z4' }]);
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

  it('wellness weight maps between the wire name and the client name in both directions', async () => {
    // the wire says `weight`; the client says `weightKg`. Without this
    // mapping, synced weights never reached any consumer and manual
    // weights never reached the server (gauntlet critical 2026-07-21).
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify([{ date: '2026-07-01', weight: 70.4 }]) }));
    const r = await getWellness(getToken);
    expect(r.body[0].weightKg).toBe(70.4);
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    await putWellness(getToken, { date: '2026-07-02', weightKg: 70.6, hrv: 55 });
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.weight).toBe(70.6);
    expect(sent.hrv).toBe(55);
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
    expect(url).not.toContain('days=');
    expect(opts.method).toBe('POST');
  });

  it('syncWellness appends the days window for a history backfill', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]' }));
    const { syncWellness } = await import('./api.js');
    await syncWellness(getToken, 365);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/wellness/sync?days=365');
  });

  it('putPlannedEvents PUTs the desired watch calendar', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ created: 1, removed: 0, unchanged: 2 }) }));
    const { putPlannedEvents } = await import('./api.js');
    const body = { oldest: '2026-07-09', newest: '2026-08-05', events: [{ ref: '0-1' }] };
    const r = await putPlannedEvents(getToken, body);
    expect(r.ok).toBe(true);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/integrations/intervals-icu/planned-events');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual(body);
  });
});

describe('review persistence seam (phase 1)', () => {
  const bikeReview = {
    outcome: 'progress', confidence: 'high', completion: 0.97,
    adherencePct: 2.1, efforts: [{ plannedSec: 300, actualSec: 305, watts: 312 }],
  };
  const logRow = (fields) => ({ completed: true, completedAtUtc: '2026-07-06T10:00:00Z', feel: 'right', ...fields });

  it('round-trips a review through the envelope without field loss', () => {
    const wire = reviewToApi(bikeReview, 3);
    expect(wire.schemaVersion).toBe(REVIEW_SCHEMA_VERSION);
    expect(wire.engineVersion).toBe(3);
    expect(typeof wire.createdAt).toBe('string');
    // the server echoes jsonb verbatim; hydrate must yield the FLAT review
    const resp = {
      race: 'olympic', totalWeeks: 2, profile: {}, paces: {},
      weeks: [{ index: 0, workouts: [{ id: 'g1', clientWorkoutRef: '0-0', log: logRow({ bikeReview: wire }), week: 0, date: '2026-07-06', discipline: 'bike', type: 'Endurance', title: 'Ride', durationMin: 60, segments: [] }] }],
    };
    const { log } = toClientState(resp);
    expect(log['0-0'].bikeReview).toEqual(bikeReview);          // flat, no envelope keys
    expect(log['0-0'].bikeReviewMeta).toEqual({ schemaVersion: 1, createdAt: wire.createdAt, engineVersion: 3 });
    expect(log['0-0'].bikeReview.schemaVersion).toBeUndefined(); // meta never leaks into the spread shape
  });

  it('hydrates all three disciplines, including runReview (PR #24 read-side ready)', () => {
    const l = logRow({
      swimReview: reviewToApi({ outcome: 'hold' }, 1),
      bikeReview: reviewToApi({ outcome: 'progress' }, 1),
      runReview: reviewToApi({ outcome: 'repeat' }, 1),
    });
    const resp = { race: 'olympic', totalWeeks: 1, profile: {}, paces: {}, weeks: [], logs: [{ ...l, clientWorkoutRef: '1-1' }] };
    const { log } = toClientState(resp);
    expect(log['1-1'].swimReview).toEqual({ outcome: 'hold' });
    expect(log['1-1'].bikeReview).toEqual({ outcome: 'progress' });
    expect(log['1-1'].runReview).toEqual({ outcome: 'repeat' });
  });

  it('tolerates a legacy FLAT stored review: whole object is the review, no meta', () => {
    const resp = { race: 'olympic', totalWeeks: 1, profile: {}, paces: {}, weeks: [], logs: [{ ...logRow({ swimReview: { outcome: 'hold', completion: 1 } }), clientWorkoutRef: '2-0' }] };
    const { log } = toClientState(resp);
    expect(log['2-0'].swimReview).toEqual({ outcome: 'hold', completion: 1 });
    expect(log['2-0'].swimReviewMeta).toBeUndefined();
  });

  it('logToApi NEVER emits review keys, even from an entry that carries them', () => {
    /* The trap this seam exists to avoid. The backend's review fields are
       Optional: omitted preserves, explicit null CLEARS. logToApi runs on
       every feel tap, so one defensive `swimReview: null` here would erase
       the stored review history on the athlete's next tap. */
    const body = logToApi({ done: true, at: '2026-07-06T10:00:00Z', feel: 'hard', swimReview: { outcome: 'hold' }, bikeReview: {}, runReview: {}, techniqueCue: 'catch' });
    expect('swimReview' in body).toBe(false);
    expect('bikeReview' in body).toBe(false);
    expect('runReview' in body).toBe(false);
    expect('techniqueCue' in body).toBe(false);
  });

  it('reviewBodyToApi carries the fresh base four plus ONLY the named fields', () => {
    // The base four are NOT Optional server-side (rewritten on every PUT),
    // so a review write with stale ones would revert a feel tap.
    const entry = { done: true, at: '2026-07-06T10:00:00Z', feel: 'right', notes: 'cal:{"actualMin":61}' };
    const body = reviewBodyToApi(entry, { bikeReview }, { bikeReview: 3 });
    expect(body.completed).toBe(true);
    expect(body.feel).toBe('right');
    expect(body.notes).toBe('cal:{"actualMin":61}');
    expect(body.bikeReview.review).toEqual(bikeReview);
    expect(body.bikeReview.engineVersion).toBe(3);
    expect('swimReview' in body).toBe(false);   // unnamed fields stay omitted
    expect('runReview' in body).toBe(false);
    expect('techniqueCue' in body).toBe(false);
  });

  it('an explicit null clears; a cue passes bare, not enveloped', () => {
    const entry = { done: true, at: '2026-07-06T10:00:00Z' };
    const cleared = reviewBodyToApi(entry, { swimReview: null });
    expect(cleared.swimReview).toBe(null);
    const cue = reviewBodyToApi(entry, { techniqueCue: 'catch' });
    expect(cue.techniqueCue).toBe('catch');
    const cueCleared = reviewBodyToApi(entry, { techniqueCue: null });
    expect(cueCleared.techniqueCue).toBe(null);
  });

  it('a maximal review envelope stays far under the server 16 KiB cap', () => {
    const maximal = reviewToApi({
      outcome: 'insufficient-data', confidence: 'low', completion: 0.5,
      explanation: 'x'.repeat(500),
      efforts: Array.from({ length: 40 }, (_, i) => ({ plannedSec: 300, actualSec: 300 + i, watts: 300, paceSec: 95.5, status: 'on-target' })),
    }, 1);
    expect(JSON.stringify(maximal).length).toBeLessThan(16384 / 2);
  });
});
