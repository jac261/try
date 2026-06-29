/* Try — periodized plan generator + structured workout builder */
(function () {
  const T = window.TF;

  /* ---- paces derived from the athlete's baselines ---- */
  function computePaces(profile) {
    const lvl = T.FITNESS[profile.fitness] || T.FITNESS.intermediate;
    // Use the athlete's own numbers if given, otherwise estimate from their level.
    const fivek = profile.fivekSec || lvl.est5k;
    const p = fivek / 5;                             // sec per km at 5k effort
    const css = profile.css100Sec || lvl.estCss;
    const ftp = profile.ftp || null;                 // watts (optional, no estimate)
    return {
      runEstimated: !profile.fivekSec,               // true when paces are level-based guesses
      swimEstimated: !profile.css100Sec,
      ftp: ftp,
      run: { recovery: p + 85, easy: p + 70, long: p + 78, tempo: p + 35, threshold: p + 12, interval: p - 8 },
      swim: { easy: css + 12, steady: css + 6, css: css, fast: css - 6 },
    };
  }

  function runDetail(pc, key, zone) {
    const z = T.ZONES[zone];
    if (pc.runEstimated) return '~' + T.fmtPace(pc.run[key]) + ' /km · ' + zone + ' · ' + z.rpe;
    return T.fmtPace(pc.run[key]) + ' /km · ' + zone + ' ' + z.name;
  }
  function swimDetail(pc, key, zone) {
    const z = T.ZONES[zone];
    if (pc.swimEstimated) return '~' + T.fmtPace(pc.swim[key]) + ' /100m · ' + zone + ' · ' + z.rpe;
    return T.fmtPace(pc.swim[key]) + ' /100m · ' + zone;
  }
  function bikeDetail(pc, lo, hi, zone) {
    const z = T.ZONES[zone];
    if (pc.ftp) return Math.round(pc.ftp * lo) + '–' + Math.round(pc.ftp * hi) + ' W · ' + zone + ' ' + z.name;
    return zone + ' ' + z.name + ' · ' + z.rpe;
  }

  /* ---- per-discipline workout builders → {title, segments[], distance} ---- */
  function buildRun(type, dur, pc) {
    let segs = [], title = 'Run';
    if (type === 'Long') {
      title = 'Long Run';
      segs = [{ label: 'Steady aerobic', min: dur, detail: runDetail(pc, 'long', 'Z2') }];
    } else if (type === 'Easy') {
      title = 'Easy Run';
      segs = [{ label: 'Relaxed', min: dur, detail: runDetail(pc, 'easy', 'Z2') }];
    } else if (type === 'Tempo') {
      title = 'Tempo Run';
      const main = Math.max(15, dur - 22);
      segs = [
        { label: 'Warm-up', min: 12, detail: runDetail(pc, 'easy', 'Z2') },
        { label: 'Tempo block', min: main, detail: runDetail(pc, 'tempo', 'Z3') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1') },
      ];
    } else if (type === 'VO2 Intervals') {
      title = 'VO2 Intervals';
      const reps = T.clamp(Math.round((dur - 25) / 5), 4, 8);
      segs = [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2') },
        { label: reps + ' × (3 min hard / 2 min easy)', min: reps * 5, detail: runDetail(pc, 'interval', 'Z5') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1') },
      ];
    } else { // Threshold
      title = 'Threshold Run';
      const reps = T.clamp(Math.round((dur - 25) / 12), 2, 4);
      segs = [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2') },
        { label: reps + ' × (9 min threshold / 3 min easy)', min: reps * 12, detail: runDetail(pc, 'threshold', 'Z4') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1') },
      ];
    }
    const dist = +(dur * 60 / pc.run.easy).toFixed(1);
    return { title: title, segments: segs, distance: dist, unit: 'km' };
  }

  function buildBike(type, dur, pc) {
    let segs = [], title = 'Bike';
    if (type === 'Long') {
      title = 'Long Ride';
      segs = [
        { label: 'Endurance', min: dur - 20, detail: bikeDetail(pc, 0.6, 0.75, 'Z2') },
        { label: '2 × 6 min tempo surges', min: 20, detail: bikeDetail(pc, 0.83, 0.9, 'Z3') },
      ];
    } else if (type === 'Endurance') {
      title = 'Endurance Ride';
      segs = [{ label: 'Steady', min: dur, detail: bikeDetail(pc, 0.6, 0.75, 'Z2') }];
    } else if (type === 'Sweet Spot') {
      title = 'Sweet Spot';
      const reps = T.clamp(Math.round((dur - 25) / 17), 2, 4);
      segs = [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2') },
        { label: reps + ' × (12 min / 5 min easy)', min: reps * 17, detail: bikeDetail(pc, 0.84, 0.9, 'Z3') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1') },
      ];
    } else { // Threshold
      title = 'Bike Threshold';
      const reps = T.clamp(Math.round((dur - 25) / 12), 3, 5);
      segs = [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2') },
        { label: reps + ' × (8 min / 4 min easy)', min: reps * 12, detail: bikeDetail(pc, 0.95, 1.05, 'Z4') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1') },
      ];
    }
    const dist = Math.round(dur / 60 * 30); // ~30 km/h estimate
    return { title: title, segments: segs, distance: dist, unit: 'km' };
  }

  function buildSwim(type, dur, pc) {
    const reps = T.clamp(Math.round(dur / 4), 6, 16);
    let segs = [], title = 'Swim', main;
    if (type === 'Technique') {
      title = 'Technique Swim';
      main = reps * 100;
      segs = [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2') },
        { label: '6 × 50 m drills', detail: 'Catch-up, single-arm, scull' },
        { label: reps + ' × 100 m steady', detail: swimDetail(pc, 'steady', 'Z3') },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1') },
      ];
    } else if (type === 'CSS Intervals') {
      title = 'CSS Intervals';
      main = reps * 100;
      segs = [
        { label: 'Warm-up 400 m', detail: swimDetail(pc, 'easy', 'Z2') },
        { label: reps + ' × 100 m @ CSS', detail: swimDetail(pc, 'css', 'Z4') + ' · 15 s rest' },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1') },
      ];
    } else if (type === 'Open Water') {
      title = 'Open Water Swim';
      main = reps * 100;
      segs = [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2') },
        { label: '4 × 200 m @ race effort', detail: swimDetail(pc, 'css', 'Z4') + ' · sight every 6–8 strokes' },
        { label: 'Open-water skills', detail: 'Deep-water start, drafting, buoy turns — practise swimming straight' },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1') },
      ];
    } else { // Endurance / Race Pace
      title = type === 'Race Pace' ? 'Race-Pace Swim' : 'Endurance Swim';
      main = reps * 100;
      segs = [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2') },
        { label: (reps * 100) + ' m continuous', detail: swimDetail(pc, type === 'Race Pace' ? 'css' : 'steady', type === 'Race Pace' ? 'Z4' : 'Z2') },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1') },
      ];
    }
    const dist = +((900 + main) / 1000).toFixed(1);
    return { title: title, segments: segs, distance: dist, unit: 'km' };
  }

  function buildBrick(dur, pc, phase) {
    const base = phase === 'Base', peak = phase === 'Peak';
    const bikeMin = Math.round(dur * (peak ? 0.62 : 0.7));   // more run off the bike at peak
    const runMin = dur - bikeMin;
    return {
      title: 'Brick',
      segments: [
        { label: base ? 'Bike — steady aerobic' : 'Bike — build to race effort', min: bikeMin,
          detail: bikeDetail(pc, base ? 0.6 : 0.72, base ? 0.75 : 0.88, base ? 'Z2' : 'Z3') },
        { label: 'T2 — quick transition', detail: 'Rack bike, shoes on, < 60 s' },
        { label: base ? 'Run off the bike — easy' : (peak ? 'Run off the bike — race pace' : 'Run off the bike — tempo'), min: runMin,
          detail: runDetail(pc, base ? 'easy' : (peak ? 'threshold' : 'tempo'), base ? 'Z2' : (peak ? 'Z4' : 'Z3')) },
      ],
      distance: null, unit: 'km',
    };
  }

  // Strength session — durability, power and injury resistance (Base/Build only).
  function buildStrength(phase) {
    const base = phase === 'Base';
    return {
      title: 'Strength', durationMin: base ? 40 : 35, distance: null, unit: '',
      segments: [
        { label: 'Mobility & activation', min: 8, detail: 'Hips, ankles, glutes & core switch-on' },
        base
          ? { label: 'Foundation circuit · 3 rounds', min: 24, detail: 'Goblet squat, Romanian deadlift, split squat, push-up — 12–15 reps' }
          : { label: 'Strength · 4 sets', min: 20, detail: 'Back squat, deadlift, single-leg work — 5–8 strong reps, full recovery' },
        { label: 'Core & balance', min: base ? 8 : 7, detail: 'Plank & side plank, dead bug, single-leg balance' },
      ],
    };
  }

  // Benchmark fitness tests — the athlete logs the result to re-target paces/power.
  function buildTest(kind, pc) {
    if (kind === 'run5k') {
      return {
        title: 'Fitness Test · 5k Run', durationMin: 45, distance: 5, unit: 'km',
        segments: [
          { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2') + ' + 3 × 20 s strides' },
          { label: '5 km time trial — all out', min: 22, detail: 'Even effort, finish hard. Note your finish time.' },
          { label: 'Cool-down', min: 8, detail: runDetail(pc, 'easy', 'Z1') },
        ],
        note: 'Enter your 5k time in Update fitness to re-target your run paces.',
      };
    }
    if (kind === 'bikeFtp') {
      return {
        title: 'Fitness Test · Bike FTP', durationMin: 60, distance: null, unit: 'km',
        segments: [
          { label: 'Warm-up', min: 18, detail: 'Build + 3 × 1 min fast spins' },
          { label: '20 min time trial — max sustainable', min: 20, detail: 'Hold the hardest steady power you can hold for 20 min.' },
          { label: 'Cool-down', min: 22, detail: 'Easy spin' },
        ],
        note: 'FTP ≈ 95% of your 20-min average power. Enter it in Update fitness.',
      };
    }
    // swimCss
    return {
      title: 'Fitness Test · Swim CSS', durationMin: 45, distance: 1.4, unit: 'km',
      segments: [
        { label: 'Warm-up 400 m', detail: swimDetail(pc, 'easy', 'Z2') },
        { label: '400 m time trial — all out', detail: 'Note your time (T400).' },
        { label: 'Easy 200 m', detail: 'Recover fully.' },
        { label: '200 m time trial — all out', detail: 'Note your time (T200).' },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1') },
      ],
      note: 'CSS pace per 100 m = (T400 − T200) ÷ 2. Enter it in Update fitness.',
    };
  }

  const TEST_ROTATION = ['run5k', 'bikeFtp', 'swimCss'];
  const TEST_DISC = { run5k: 'run', bikeFtp: 'bike', swimCss: 'swim' };

  /* ---- base session durations (minutes, intermediate athlete) ---- */
  const LONG_RUN = { sprint: 55, olympic: 70, half: 95, full: 120 };
  const LONG_BIKE = { sprint: 70, olympic: 100, half: 160, full: 210 };
  const LONG_BRICK = { sprint: 70, olympic: 95, half: 135, full: 165 };

  const TEMPLATES = {
    3: ['swim:quality', 'bike:long', 'run:long'],
    4: ['swim:easy', 'bike:quality', 'run:quality', 'brick:long'],
    5: ['swim:easy', 'run:quality', 'bike:quality', 'run:long', 'bike:long'],
    6: ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long'],
    7: ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long', 'brick:long'],
  };

  // preferred weekdays (0=Mon..6=Sun): quality midweek, long on weekend
  const WEEKDAY_ORDER = [1, 3, 0, 2, 4]; // Tue, Thu, Mon, Wed, Fri
  const WEEKEND = [5, 6];                 // Sat, Sun

  // Quality-session ladders, easiest → hardest. The chosen rung = phase position
  // (Base 0, Build 1, Peak/Taper 2) shifted by the athlete's intensity level, so a
  // beginner trains one rung easier and an elite two rungs harder for the same week.
  const INTENSITY_LADDER = {
    run:  ['Easy', 'Tempo', 'Threshold', 'VO2 Intervals'],
    bike: ['Endurance', 'Sweet Spot', 'Threshold'],
    swim: ['Technique', 'CSS Intervals', 'Race Pace'],
  };
  function typeFor(discipline, role, phase, isRecovery, intensity) {
    if (role === 'long') return 'Long';
    if (role === 'brick') return 'Brick';
    // Peak swims become race-specific open-water sessions (any role, but not recovery weeks).
    if (discipline === 'swim' && phase === 'Peak' && !isRecovery) return 'Open Water';
    if (role === 'easy') return discipline === 'swim' ? 'Technique' : 'Easy';
    // role === 'quality'
    if (isRecovery) return discipline === 'swim' ? 'Technique' : (discipline === 'bike' ? 'Endurance' : 'Easy');
    const ladder = INTENSITY_LADDER[discipline] || ['Easy'];
    const phaseIdx = phase === 'Base' ? 0 : (phase === 'Build' ? 1 : 2);
    const idx = T.clamp(phaseIdx + (intensity || 0), 0, ladder.length - 1);
    return ladder[idx];
  }

  function baseDuration(discipline, role, race) {
    if (role === 'brick') return LONG_BRICK[race];
    if (role === 'long') return discipline === 'bike' ? LONG_BIKE[race] : (discipline === 'run' ? LONG_RUN[race] : 60);
    if (discipline === 'swim') return role === 'easy' ? 35 : 45;
    if (discipline === 'run') return 50;
    if (discipline === 'bike') return 55;
    return 40;
  }

  function buildWorkout(discipline, type, dur, pc, phase) {
    if (discipline === 'run') return buildRun(type, dur, pc);
    if (discipline === 'bike') return buildBike(type, dur, pc);
    if (discipline === 'swim') return buildSwim(type, dur, pc);
    if (discipline === 'brick') return buildBrick(dur, pc, phase);
    if (discipline === 'strength') return buildStrength(phase);
    return { title: 'Session', segments: [], distance: null, unit: '' };
  }

  /* ---- phase plan across the whole block ---- */
  function computePhases(totalWeeks, taperWeeks) {
    const taper = Math.min(taperWeeks, Math.max(1, totalWeeks - 3));
    const remaining = totalWeeks - taper;
    let peak = Math.max(1, Math.round(remaining * 0.2));
    let build = Math.max(1, Math.round(remaining * 0.4));
    let base = remaining - peak - build;
    while (base < 1) { if (build > 1) build--; else if (peak > 1) peak--; base = remaining - peak - build; }
    const phases = [];
    for (let i = 0; i < base; i++) phases.push('Base');
    for (let i = 0; i < build; i++) phases.push('Build');
    for (let i = 0; i < peak; i++) phases.push('Peak');
    for (let i = 0; i < taper; i++) phases.push('Taper');
    return phases;
  }

  function loadFactor(phase, posInPhase, lenPhase) {
    const frac = lenPhase > 1 ? posInPhase / (lenPhase - 1) : 0;
    if (phase === 'Base') return T.lerp(0.82, 1.0, frac);
    if (phase === 'Build') return T.lerp(1.0, 1.12, frac);
    if (phase === 'Peak') return T.lerp(1.12, 1.18, frac);
    if (phase === 'Taper') return lenPhase === 2 ? (posInPhase === 0 ? 0.8 : 0.55) : 0.55;
    return 1.0;
  }

  /* ---- main entry ---- */
  T.generatePlan = function (profile) {
    const race = T.RACES[profile.raceType];
    const fitness = T.FITNESS[profile.fitness] || T.FITNESS.intermediate;
    const pc = computePaces(profile);

    const weekStart0 = T.startOfWeekMonday(profile.startDate || new Date());
    let totalWeeks = Math.round(T.weeksBetween(weekStart0, profile.raceDate));
    totalWeeks = T.clamp(totalWeeks, 4, 40);

    const phases = computePhases(totalWeeks, race.taperWeeks);
    // Scheduling preference: explicit training weekdays (0=Mon..6=Sun) + a long-session
    // day. Falls back to the legacy fixed layout when a profile predates the preference.
    const prefDays = (profile.trainingDays && profile.trainingDays.length >= 3)
      ? profile.trainingDays.slice().sort((a, b) => a - b) : null;
    const days = prefDays ? prefDays.length : profile.daysPerWeek;
    const template = TEMPLATES[T.clamp(days, 3, 7)];
    let longDay = profile.longDay;
    if (prefDays && (longDay === undefined || prefDays.indexOf(longDay) < 0)) {
      longDay = prefDays.indexOf(5) >= 0 ? 5 : (prefDays.indexOf(6) >= 0 ? 6 : prefDays[prefDays.length - 1]);
    }

    // phase position bookkeeping
    const phaseLen = {}, phasePos = {};
    phases.forEach(p => { phaseLen[p] = (phaseLen[p] || 0) + 1; });

    // Place up to 3 benchmark tests (run → bike → swim) spread across the Base/Build
    // weeks — never on recovery / Peak / Taper — so paces recalibrate as fitness grows.
    const eligibleTestWeeks = [];
    for (let w = 0; w < totalWeeks; w++) {
      const ph = phases[w];
      const rec = ((w + 1) % fitness.recoveryEvery === 0) && ph !== 'Taper' && w < totalWeeks - 2;
      if ((ph === 'Base' || ph === 'Build') && !rec && w >= 1) eligibleTestWeeks.push(w);
    }
    const testByWeek = {};
    const nTests = Math.min(TEST_ROTATION.length, eligibleTestWeeks.length);
    for (let i = 0; i < nTests; i++) {
      const pos = nTests === 1 ? Math.floor(eligibleTestWeeks.length / 2)
        : Math.round((i + 0.5) / nTests * (eligibleTestWeeks.length - 1));
      testByWeek[eligibleTestWeeks[pos]] = TEST_ROTATION[i];
    }

    const weeks = [];
    for (let w = 0; w < totalWeeks; w++) {
      const phase = phases[w];
      phasePos[phase] = phasePos[phase] === undefined ? 0 : phasePos[phase] + 1;
      const isRecovery = ((w + 1) % fitness.recoveryEvery === 0) && phase !== 'Taper' && w < totalWeeks - 2;
      let load = loadFactor(phase, phasePos[phase], phaseLen[phase]) * fitness.factor;
      if (isRecovery) load *= fitness.recoveryDepth;

      const testKind = testByWeek[w] || null;

      // split template into weekend (long/brick) vs weekday slots
      const longs = [], mids = [];
      template.forEach(tok => {
        const [disc, role] = tok.split(':');
        (role === 'long' || role === 'brick' ? longs : mids).push({ disc, role });
      });

      const dayMap = {}; // weekday index -> slot
      if (prefDays) {
        // Long/brick → the preferred long day first, then other weekend days, then weekdays.
        const isWknd = d => d >= 5;
        const longSlots = [longDay]
          .concat(prefDays.filter(d => d !== longDay && isWknd(d)))
          .concat(prefDays.filter(d => d !== longDay && !isWknd(d)));
        const used = {};
        longs.forEach((s, i) => { const d = longSlots[i]; if (d !== undefined) { dayMap[d] = s; used[d] = 1; } });
        const midSlots = prefDays.filter(d => !used[d]);
        mids.forEach((s, i) => { const d = midSlots[i]; if (d !== undefined) dayMap[d] = s; });
      } else {
        const weekdayQueue = WEEKDAY_ORDER.slice();
        // Long/brick sessions take the weekend first; any overflow spills onto a weekday.
        longs.forEach((s, i) => {
          if (WEEKEND[i] !== undefined) dayMap[WEEKEND[i]] = s;
          else { const wd = weekdayQueue.shift(); if (wd !== undefined) dayMap[wd] = s; }
        });
        mids.forEach(s => { const wd = weekdayQueue.shift(); if (wd !== undefined) dayMap[wd] = s; });
      }

      const workouts = [];
      let slot = 0;
      for (let d = 0; d < 7; d++) {
        const date = T.iso(T.addDays(weekStart0, w * 7 + d));
        const s = dayMap[d];
        if (!s) {
          workouts.push({ id: w + '-' + d, week: w, phase: phase, date: date, discipline: 'rest', type: 'Rest', title: 'Rest', durationMin: 0, segments: [], distance: null });
          continue;
        }
        const isLast = w === totalWeeks - 1;
        const type = typeFor(s.disc, s.role, phase, isRecovery, fitness.intensity);
        const dur = T.round5(baseDuration(s.disc, s.role, race.key) * load);
        const built = buildWorkout(s.disc, type, dur, pc, phase);
        workouts.push({
          id: w + '-' + d, week: w, phase: phase, date: date,
          discipline: s.disc, role: s.role, type: type, title: built.title,
          durationMin: dur, distance: built.distance, unit: built.unit,
          segments: built.segments, key: s.role === 'long' || s.role === 'brick',
        });
        slot++;
      }

      // mark race day (replace that day's workout)
      const raceISO = T.iso(profile.raceDate);
      workouts.forEach((wo, i) => {
        if (wo.date === raceISO) {
          workouts[i] = {
            id: wo.id, week: w, phase: 'Taper', date: raceISO, discipline: 'brick',
            type: 'RACE', title: 'RACE DAY — ' + race.name, durationMin: 0, distance: null, unit: '',
            segments: [
              { label: 'Swim ' + race.swim + ' km', detail: 'Steady, sight often, settle into rhythm' },
              { label: 'Bike ' + race.bike + ' km', detail: 'Hold race watts, fuel every 20 min' },
              { label: 'Run ' + race.run + ' km', detail: 'Negative split, finish strong' },
            ], race: true, key: true,
          };
        }
      });

      // Inject the scheduled benchmark test, replacing that discipline's session
      // for the week (keeps the workout id stable so logs/moves still apply).
      if (testKind) {
        const disc = TEST_DISC[testKind];
        let ti = workouts.findIndex(x => x.discipline === disc && x.role === 'quality');
        if (ti < 0) ti = workouts.findIndex(x => x.discipline === disc && !x.race);
        if (ti >= 0) {
          const built = buildTest(testKind, pc);
          workouts[ti] = Object.assign({}, workouts[ti], {
            type: 'Test', title: built.title, durationMin: built.durationMin,
            distance: built.distance, unit: built.unit, segments: built.segments,
            test: true, testKind: testKind, note: built.note, key: true,
          });
        }
      }

      // Add a strength session during Base/Build, stacked as a second session ("double")
      // on the hardest training day — so easy days and (chosen) rest days stay easy/rest.
      if (phase === 'Base' || phase === 'Build') {
        const built = buildStrength(phase);
        const HARD = { 'Tempo': 3, 'Threshold': 4, 'VO2 Intervals': 5, 'Sweet Spot': 3, 'CSS Intervals': 3, 'Race Pace': 4 };
        const score = x => (HARD[x.type] || 0) + (x.role === 'quality' ? 1 : 0);
        const hosts = workouts.filter(x => x.discipline !== 'rest' && !x.race && !x.test && x.role !== 'long' && x.discipline !== 'brick');
        hosts.sort((a, b) => score(b) - score(a) || b.durationMin - a.durationMin);
        const host = hosts[0];
        if (host) workouts.push({
          id: w + '-' + host.id.split('-')[1] + '-1', week: w, phase: phase, date: host.date,
          discipline: 'strength', role: 'strength', type: 'Strength', title: built.title,
          durationMin: built.durationMin, distance: null, unit: '', segments: built.segments, second: true,
        });
      }

      const totalMin = workouts.reduce((a, b) => a + (b.durationMin || 0), 0);
      weeks.push({ index: w, phase: phase, isRecovery: isRecovery, start: T.iso(T.addDays(weekStart0, w * 7)), totalMin: totalMin, workouts: workouts });
    }

    return {
      profile: profile, race: race.key, createdAt: new Date().toISOString(),
      totalWeeks: totalWeeks, paces: pc, weeks: weeks,
    };
  };
})();
