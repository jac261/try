/* The support library: the science and logic behind every chart and decision
   in the app, written for athletes. Each topic is deep-linked from a "What is
   this?" link beside the thing it explains. Copy style: plain punctuation,
   short paragraphs, honest about limitations. */

const P = ({ children }) => <p className="lead" style={{ marginTop: 8 }}>{children}</p>;
const H = ({ children }) => <h3 style={{ margin: '18px 0 0', fontSize: 16, fontWeight: 800, letterSpacing: '-.3px' }}>{children}</h3>;

export const TOPICS = [
  {
    key: 'fitness-fatigue',
    title: 'Fitness & Fatigue',
    summary: 'What the two curves are, and why fitness is slow while fatigue is fast',
    body: <>
      <P>Every session you log carries a training load: a number that combines how long you trained
        with how hard that kind of session is. An hour of easy running scores far less than an hour
        of threshold work. The app estimates this from the session type when your watch does not
        provide a measured value.</P>
      <H>Fitness (the blue line)</H>
      <P>Fitness is your training load averaged over roughly the last six weeks (42 days). It moves
        slowly by design: fitness is what your body has adapted to, and adaptation takes weeks. One
        big session barely nudges it; six consistent weeks transform it. When you stop training it
        decays just as slowly, which is why a week off costs you far less than it feels like.</P>
      <H>Fatigue (the red line)</H>
      <P>Fatigue is the same calculation over the last 7 days. It reacts fast: a hard weekend sends
        it up immediately, and a few easy days bring it back down. Fatigue is what your legs feel
        this week.</P>
      <H>Why this model</H>
      <P>This is the classic impulse-response training model used across endurance sport (you may
        know the terms CTL and ATL). It is a simplification: it cannot see sleep, stress, heat or
        fuelling. That is why the app pairs it with your morning readiness signals rather than
        trusting it alone.</P>
    </>,
  },
  {
    key: 'form',
    title: 'Form (TSB)',
    summary: 'Fitness minus fatigue: the number that says train, absorb or race',
    body: <>
      <P>Form is simply fitness minus fatigue. It answers a different question from either curve
        alone: not "how fit am I?" but "what can I usefully do right now?"</P>
      <H>Reading the zones</H>
      <P><b>Optimal (about −30 to −10):</b> you are training harder than you are adapted to, which
        is exactly where fitness is built. Most productive weeks live here.</P>
      <P><b>Grey zone (−10 to +5):</b> neither building nor fresh. Fine in passing; a whole week
        spent here in a Base or Build phase usually means there is room to push, and the engine
        will say so.</P>
      <P><b>Fresh (+5 to +25):</b> fatigue has drained away and the fitness remains. This is where
        you want to be standing on a start line, and it is the window the engine steers you into
        across the final two weeks before your race.</P>
      <P><b>High risk (below −30):</b> fatigue is far ahead of adaptation. A day or two here after
        a big block is normal; living here is how injury and illness happen. Three consecutive
        days triggers the engine's recovery-week proposal.</P>
      <H>Why fresher is not always better</H>
      <P>Form rises when you rest, so chasing a high number all the time means never training
        enough to build anything. The skill is spending most of your time slightly negative and
        arriving positive exactly once: on race day.</P>
    </>,
  },
  {
    key: 'ramp-rate',
    title: 'Ramp rate',
    summary: 'How fast your fitness is growing, and why +5 and +8 are marked on the chart',
    body: <>
      <P>Ramp rate is how much your fitness climbed in the trailing seven days. The histogram shows
        one bar per week so you can see the shape of your build at a glance: steady bars mean a
        sustainable ramp, a spike means a sudden jump in load.</P>
      <H>The +5 and +8 lines</H>
      <P>Research and long coaching practice agree that the injury and illness risk of a build is
        driven less by how much you train than by how fast that amount grows. Gaining up to about
        +5 fitness points a week is a solid, repeatable build. Between +5 and +8 is aggressive:
        fine for a deliberate short block, risky as a habit. Beyond +8 the odds of breaking down
        start beating the odds of adapting.</P>
      <H>What the engine does about it</H>
      <P>Two weeks in a row above +5 and next week is trimmed to about 80% volume. Any single week
        above +8 trims next week to about 70% and eases its hardest quality session. A negative
        ramp mid-Base or mid-Build with missed sessions triggers a catch-up proposal instead: your
        build has stalled, which carries its own cost.</P>
      <H>Reading it honestly</H>
      <P>A negative bar is not failure. Taper weeks, recovery weeks and life weeks are supposed to
        dip. What matters is the pattern across a phase, not any single bar.</P>
    </>,
  },
  {
    key: 'zones',
    title: 'Training zones & your paces',
    summary: 'Where Z1 to Z5 come from and how your personal numbers anchor them',
    body: <>
      <P>Every session prescribes an intensity zone from Z1 (recovery) to Z5 (VO2 max effort). The
        zones are anchored to three personal numbers, one per sport: your recent 5 km run time,
        your swim CSS pace (per 100 m), and your cycling FTP (watts).</P>
      <H>How each anchor works</H>
      <P><b>Run:</b> your 5 km time sets a reference pace. Easy runs sit about 70 seconds per km
        slower than it, threshold work about 12 seconds slower, VO2 intervals slightly faster than
        it. <b>Swim:</b> CSS is the pace you could hold for a long steady swim; easy swimming is
        CSS +12 s/100 m, threshold sets swim at CSS itself, sprint work a touch faster.
        <b> Bike:</b> zones are percentage bands of FTP, e.g. sweet spot at 84 to 97%.</P>
      <H>Estimated vs precise</H>
      <P>If you skipped a number during onboarding, the app estimates it from your experience level
        and marks paces with a tilde (~). Sessions then guide by effort and heart-rate zones
        instead. The plan schedules benchmark tests (5 km run, 20-minute FTP, swim 400/200) at
        sensible points so the estimates become measurements.</P>
      <H>When numbers drift</H>
      <P>Fitness changes. If intervals.icu starts estimating a meaningfully different FTP or
        threshold pace from your actual riding and running, the app proposes a one-tap retarget;
        your feel ratings after sessions feed the same signal ("bike feels easy" three times means
        the zones are probably soft).</P>
    </>,
  },
  {
    key: 'adaptive-engine',
    title: 'The adaptive engine',
    summary: 'The rules that reshape your plan, and the guardrails they obey',
    body: <>
      <P>The plan you generate is the starting point, not a contract. The engine watches four
        horizons and proposes changes when the data says the plan and your body disagree. It never
        rewrites silently: every change arrives as a proposal you tap to accept, wears a tag
        (Eased, Trimmed, Boosted) and can be undone from the session's detail sheet.</P>
      <H>Today</H>
      <P>A red readiness morning proposes swapping the day's hard session for easy aerobic volume.
        A green morning after an ease proposes restoring the original. Test days are protected: a
        rough morning moves a benchmark test rather than softening it, because a compromised test
        poisons your zones.</P>
      <H>This week</H>
      <P>The ramp guardrail (see Ramp rate) trims building weeks that grow too fast, and offers a
        catch-up when the build stalls.</P>
      <H>This block</H>
      <P>Three straight days deep in high-risk form turns next week into a recovery week. A whole
        week idling in the grey zone during Base or Build, with a clean training log, proposes a
        gentle boost: you have room to push.</P>
      <H>Race day</H>
      <P>Inside the final 14 days the engine projects your form forward to race morning. Arriving
        heavy proposes targeted trims; arriving flat proposes small boosts, always the minimum
        intervention that lands you in the fresh window.</P>
      <H>The guardrails</H>
      <P>Race day never moves. Recovery and taper weeks are never made harder. Tests move, never
        soften. And one proposal at a time: the most important thing, not a wall of advice.</P>
    </>,
  },
  {
    key: 'plan-structure',
    title: 'How your plan is built',
    summary: 'Phases, the load curve, recovery weeks, duration bounds and maintenance',
    body: <>
      <P>A race plan moves through phases: <b>Base</b> builds your aerobic engine and technique,
        <b> Build</b> adds intensity and race-specific work, <b>Peak</b> sharpens at race pace, and
        <b> Taper</b> sheds fatigue so you arrive fresh. A <b>Maintain</b> phase holds fitness when
        there is nothing to build toward yet.</P>
      <H>The load curve</H>
      <P>Weekly volume is expressed relative to your reference week (which your experience level
        sizes). Base ramps from about 82% to 100%, Build pushes on to 112%, Peak briefly touches
        118%, and Taper cuts to roughly 55%. Starting at 82% rather than lower keeps the ramp rate
        inside the same safety limits the engine enforces, about 3 to 5% growth per week.</P>
      <H>Recovery weeks</H>
      <P>Every third or fourth week (depending on experience level) steps volume down. Adaptation
        happens when you absorb training, not while you pile it on. Recovery weeks also pin every
        session to its gentlest format.</P>
      <H>Duration bounds</H>
      <P>Each distance has a sensible build window: roughly 6 to 16 weeks for a sprint up to 16 to
        40 for a full. Pick a race inside the window and you get the classic arc. Closer than the
        minimum and the plan becomes a sharpen-and-arrive: it works with the fitness you have
        rather than pretending to build more. Further than the maximum and the plan opens with a
        maintenance lead-in, holding fitness at moderate volume until the real build begins.</P>
      <H>Maintenance</H>
      <P>No race on the calendar? A rolling 12-week block keeps you fit: balanced across all three
        sports, a touch of intensity to hold your top end (holding fitness takes intensity, not
        volume), the usual recovery rhythm, and periodic benchmark tests so your zones stay honest.
        When you pick a race, the plan rebuilds around it.</P>
    </>,
  },
  {
    key: 'workout-library',
    title: 'Sessions & the workout library',
    summary: 'Why sessions rotate formats, what the interval graphic shows, durability work',
    body: <>
      <P>Every session type (threshold run, sweet spot ride, CSS swim...) carries several classic
        formats of the same intensity: a threshold run might be 3 × 9 minutes one week, 5-minute
        cruise intervals the next, two 12-minute blocks after that. The rotation is deterministic
        by week, so your plan never serves the identical session twice in a row, and recovery weeks
        always pin the gentlest format.</P>
      <H>The interval graphic</H>
      <P>The chart at the top of a session shows every block to scale: width is time (or distance
        for swims), height and colour are intensity, from teal Z1 up to red Z5. A pyramid fartlek
        literally rises and falls; over-unders show their spikes. Rest intervals appear as the low
        teal blocks between efforts.</P>
      <H>Durability finishes</H>
      <P>In Build and Peak, some long runs and rides end with threshold intervals on tired legs.
        Fatigue resistance (holding form and pace late in a race) trains best at the end of long
        sessions, but it is a sharp tool: it never appears in Base, Taper or recovery weeks.</P>
      <H>When the engine reshapes a session</H>
      <P>Eases swap a hard session to easy aerobic volume at reduced time. Trims shorten a session
        without changing its character (fewer or shorter reps, same format). Boosts do the
        opposite. All of them rebuild the session properly from the library rather than just
        scaling numbers, and all of them show a tag and can be undone.</P>
      <H>Your own sessions</H>
      <P>Sessions you add from the Today tab are built from the same library, so they get real
        structure, count toward your training load and ramp rate, sync to your watch, and can be
        removed again. The engine treats them as first-class load.</P>
    </>,
  },
];
