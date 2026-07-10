/* Try — structured-workout .FIT export.
 *
 * Generates Garmin/ANT .FIT *workout* files (FIT type 5) that load onto a watch
 * as guided, step-by-step sessions. The library below mirrors the session types
 * the plan draws from (js/plan.js) but emits machine targets instead of display
 * strings, personalised to the athlete: running/swimming → speed (pace) targets,
 * cycling → power (watt) targets derived from FTP. No backend — the binary is
 * encoded in-browser from plan.paces and downloaded as a Blob.
 *
 * Spec: FIT file = 12-byte header + records (definition + data messages) + CRC-16.
 * Refs: workout (global msg 26), workout_step (27), file_id (0).
 */
import { clamp } from './units.js';

/* ---------- FIT CRC-16 (standard nibble-table algorithm) ---------- */
const CRC = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
             0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
function crc16(arr) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) {
    let b = arr[i], t = CRC[c & 0xF];
    c = ((c >> 4) & 0x0FFF) ^ t ^ CRC[b & 0xF];
    t = CRC[c & 0xF];
    c = ((c >> 4) & 0x0FFF) ^ t ^ CRC[(b >> 4) & 0xF];
  }
  return c & 0xFFFF;
}
// FIT epoch = 1989-12-31T00:00:00Z (631065600 s after the Unix epoch).
function fitTime() { return Math.floor(Date.now() / 1000) - 631065600; }
function ascii(s, n) { return String(s).replace(/[^\x20-\x7e]/g, '').slice(0, n); }

/* ---------- target helpers (personalised) ---------- */
// Pace → a speed window in m/s. secPer = seconds per `distM` metres (km for run,
// 100 m for swim); win widens the band by ±win seconds. lo = slower, hi = faster.
function pace(secPer, distM, win) {
  return { kind: 'speed', lo: distM / (secPer + win), hi: distM / (secPer - win) };
}
const OPEN = { kind: 'open' };
// step factories
function st(name, intensity, dur, target) { return { name: name, intensity: intensity, dur: dur, target: target || OPEN }; }
function time(min) { return { type: 'time', value: Math.round(min * 60) }; }     // minutes → step
function secs(s) { return { type: 'time', value: s }; }
function dist(m) { return { type: 'distance', value: m }; }
const OPENDUR = { type: 'open' };
// A repeat marker: loop back `span` steps and run the block `count` times total.
function rep(count, span) { return { type: 'repeat', count: count, span: span || 2 }; }

/* ---------- the library: session type → structured steps ---------- */
function runLib(type, dur, pc) {
  const P = k => pace(pc.run[k], 1000, (k === 'interval' || k === 'threshold') ? 5 : 8);
  if (type === 'Long') return [st('Steady aerobic', 'active', time(dur), P('long'))];
  if (type === 'Easy') return [st('Relaxed', 'active', time(dur), P('easy'))];
  if (type === 'Tempo') return [
    st('Warm-up', 'warmup', time(12), P('easy')),
    st('Tempo block', 'active', time(Math.max(15, dur - 22)), P('tempo')),
    st('Cool-down', 'cooldown', time(10), P('easy'))];
  if (type === 'VO2 Intervals') {
    const reps = clamp(Math.round((dur - 25) / 5), 4, 8);
    return [st('Warm-up', 'warmup', time(15), P('easy')),
      st('Hard', 'active', time(3), P('interval')),
      st('Easy', 'recovery', time(2), P('easy')), rep(reps, 2),
      st('Cool-down', 'cooldown', time(10), P('easy'))];
  }
  const reps = clamp(Math.round((dur - 25) / 12), 2, 4); // Threshold
  return [st('Warm-up', 'warmup', time(15), P('easy')),
    st('Threshold', 'active', time(9), P('threshold')),
    st('Easy', 'recovery', time(3), P('easy')), rep(reps, 2),
    st('Cool-down', 'cooldown', time(10), P('easy'))];
}

function bikeLib(type, dur, pc) {
  // Power targets from FTP; fall back to open (RPE) if the athlete has no FTP.
  const W = pc.ftp ? (lo, hi) => ({ kind: 'power', lo: pc.ftp * lo, hi: pc.ftp * hi }) : () => OPEN;
  if (type === 'Long') return [
    st('Endurance', 'active', time(dur - 20), W(0.6, 0.75)),
    st('Tempo surge', 'active', time(6), W(0.83, 0.9)),
    st('Easy spin', 'recovery', time(4), W(0.5, 0.6)), rep(2, 2)];
  if (type === 'Endurance') return [st('Steady', 'active', time(dur), W(0.6, 0.75))];
  if (type === 'Sweet Spot') {
    const reps = clamp(Math.round((dur - 25) / 17), 2, 4);
    return [st('Warm-up', 'warmup', time(15), W(0.55, 0.65)),
      st('Sweet spot', 'active', time(12), W(0.84, 0.9)),
      st('Easy spin', 'recovery', time(5), W(0.5, 0.6)), rep(reps, 2),
      st('Cool-down', 'cooldown', time(10), W(0.5, 0.6))];
  }
  const reps = clamp(Math.round((dur - 25) / 12), 3, 5); // Threshold
  return [st('Warm-up', 'warmup', time(15), W(0.55, 0.65)),
    st('Threshold', 'active', time(8), W(0.95, 1.05)),
    st('Easy spin', 'recovery', time(4), W(0.5, 0.6)), rep(reps, 2),
    st('Cool-down', 'cooldown', time(10), W(0.5, 0.6))];
}

function swimLib(type, dur, pc) {
  const P = k => pace(pc.swim[k], 100, 4);
  const reps = clamp(Math.round(dur / 4), 6, 16);
  if (type === 'Technique') return [
    st('Warm-up', 'warmup', dist(300), P('easy')),
    st('Drills 6 x 50 m', 'active', dist(300), OPEN),
    st('Steady 100 m', 'active', dist(100), P('steady')), rep(reps, 1),
    st('Cool-down', 'cooldown', dist(200), P('easy'))];
  if (type === 'CSS Intervals') return [
    st('Warm-up', 'warmup', dist(400), P('easy')),
    st('100 m @ CSS', 'active', dist(100), P('css')),
    st('Rest', 'rest', secs(15), OPEN), rep(reps, 2),
    st('Cool-down', 'cooldown', dist(200), P('easy'))];
  if (type === 'Open Water') return [
    st('Warm-up', 'warmup', dist(300), P('easy')),
    st('200 m race effort', 'active', dist(200), P('css')), rep(4, 1),
    st('Open-water skills', 'active', OPENDUR, OPEN),
    st('Cool-down', 'cooldown', dist(200), P('easy'))];
  const k = type === 'Race Pace' ? 'css' : 'steady';
  return [st('Warm-up', 'warmup', dist(300), P('easy')),
    st((reps * 100) + ' m continuous', 'active', dist(reps * 100), P(k)),
    st('Cool-down', 'cooldown', dist(200), P('easy'))];
}

function testLib(kind, pc) {
  if (kind === 'run5k') return { sport: 1, steps: [
    st('Warm-up + strides', 'warmup', time(15), pace(pc.run.easy, 1000, 8)),
    st('5 km time trial', 'active', dist(5000), OPEN),
    st('Cool-down', 'cooldown', time(8), pace(pc.run.easy, 1000, 8))] };
  if (kind === 'bikeFtp') return { sport: 2, steps: [
    st('Warm-up', 'warmup', time(18), OPEN),
    st('20 min FTP test', 'active', time(20), OPEN),
    st('Cool-down', 'cooldown', time(22), OPEN)] };
  return { sport: 5, steps: [
    st('Warm-up', 'warmup', dist(400), pace(pc.swim.easy, 100, 4)),
    st('400 m time trial', 'active', dist(400), OPEN),
    st('Easy 200 m', 'recovery', dist(200), pace(pc.swim.easy, 100, 4)),
    st('200 m time trial', 'active', dist(200), OPEN),
    st('Cool-down', 'cooldown', dist(200), pace(pc.swim.easy, 100, 4))] };
}

const SPORT = { run: 1, bike: 2, swim: 5 };
// Build the structured workout (sport + steps) for a session, or null if the
// discipline isn't a single-sport structured session (brick / strength / race).
function build(w, pc) {
  if (!supports(w)) return null;
  if (w.test) return testLib(w.testKind, pc);
  if (w.discipline === 'run') return { sport: 1, steps: runLib(w.type, w.durationMin, pc) };
  if (w.discipline === 'bike') return { sport: 2, steps: bikeLib(w.type, w.durationMin, pc) };
  if (w.discipline === 'swim') return { sport: 5, steps: swimLib(w.type, w.durationMin, pc) };
  return null;
}
function supports(w) {
  return !!w && !w.race && !w.bRace && SPORT[w.discipline] !== undefined && w.type !== 'Rest';
}

/* ---------- binary FIT encoder ---------- */
const ENUM = 0x00, UINT16 = 0x84, UINT32 = 0x86, UINT32Z = 0x8C, STRING = 0x07;
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4 };

function encode(name, sport, steps) {
  const b = [];
  const u8 = v => b.push(v & 0xff);
  const u16 = v => { b.push(v & 0xff, (v >> 8) & 0xff); };
  const u32 = v => { b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };
  const str = (s, size) => { for (let i = 0; i < size; i++) u8(i < s.length ? s.charCodeAt(i) : 0); };
  // definition message: header, reserved, little-endian arch, global#, field defs
  const def = (local, global, fields) => {
    u8(0x40 | local); u8(0); u8(0); u16(global); u8(fields.length);
    fields.forEach(f => { u8(f[0]); u8(f[1]); u8(f[2]); });
  };

  // file_id (global 0) — marks this as a workout file
  def(0, 0, [[0, 1, ENUM], [1, 2, UINT16], [2, 2, UINT16], [3, 4, UINT32Z], [4, 4, UINT32]]);
  u8(0); u8(5); u16(255); u16(0); u32(0x54525901); u32(fitTime()); // type=workout, manuf=development

  // workout (global 26)
  const wn = ascii(name, 30);
  def(1, 26, [[8, wn.length + 1, STRING], [4, 1, ENUM], [6, 2, UINT16]]);
  u8(1); str(wn, wn.length + 1); u8(sport); u16(steps.length);

  // workout_step (global 27) — redefined per step so names size correctly
  steps.forEach((s, idx) => {
    if (s.type === 'repeat') {
      def(2, 27, [[254, 2, UINT16], [1, 1, ENUM], [2, 4, UINT32], [4, 4, UINT32]]);
      u8(2); u16(idx); u8(6);            // duration_type = repeat_until_steps_cmplt
      u32(idx - s.span);                 // loop back to the first step of the block
      u32(s.count);                      // repeat_steps = iterations
      return;
    }
    const nm = ascii(s.name, 24);
    // field order must match the write order below: index, name, intensity,
    // duration_type, duration_value, target_type, target_value, custom low/high
    def(2, 27, [[254, 2, UINT16], [0, nm.length + 1, STRING], [7, 1, ENUM], [1, 1, ENUM],
      [2, 4, UINT32], [3, 1, ENUM], [4, 4, UINT32], [5, 4, UINT32], [6, 4, UINT32]]);
    u8(2); u16(idx); str(nm, nm.length + 1);
    u8(INTENSITY[s.intensity] != null ? INTENSITY[s.intensity] : 0);
    // duration
    let dt = 5, dv = 0;                                  // open
    if (s.dur.type === 'time') { dt = 0; dv = Math.round(s.dur.value * 1000); }      // ms
    else if (s.dur.type === 'distance') { dt = 1; dv = Math.round(s.dur.value * 100); } // cm
    u8(dt); u32(dv);
    // target
    const t = s.target || OPEN;
    if (t.kind === 'speed') { u8(0); u32(0); u32(Math.round(t.lo * 1000)); u32(Math.round(t.hi * 1000)); }
    else if (t.kind === 'power') { u8(4); u32(0); u32(Math.round(t.lo) + 1000); u32(Math.round(t.hi) + 1000); }
    else { u8(2); u32(0); u32(0); u32(0); }              // open target
  });

  // 12-byte header: size, protocol 2.0, profile ver, data size, ".FIT"
  const head = [12, 0x20, 0x34, 0x08, b.length & 0xff, (b.length >> 8) & 0xff,
    (b.length >> 16) & 0xff, (b.length >>> 24) & 0xff, 0x2E, 0x46, 0x49, 0x54];
  const all = head.concat(b);
  const c = crc16(all);
  all.push(c & 0xff, (c >> 8) & 0xff);
  return new Uint8Array(all);
}

/* ---------- download ---------- */
function filename(w) {
  return 'Try - ' + ascii(w.title, 40).replace(/[^\w]+/g, ' ').trim().replace(/\s+/g, '-') + '.fit';
}
function download(w, plan) {
  const built = build(w, plan.paces);
  if (!built) return false;
  const bytes = encode(w.title, built.sport, built.steps);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename(w);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export const FIT = { supports: supports, build: build, encode: encode, download: download, filename: filename };
