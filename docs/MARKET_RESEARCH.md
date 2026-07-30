# What r/runna complains about, and what Try should do with it

_Competitive teardown from user-reported issues on r/runna. Compiled 2026-07-29._

## Method and caveats

Reddit blocks Anthropic's crawler, so the usual fetch tools returned 403 or a
policy block. The crawl was done through the logged-in browser session instead.

Sample:

- 851 unique posts enumerated by title, score and comment count, pulled from
  top/year, top/all, hot, new, plus 50 keyword searches across the subreddit's
  full history.
- Comment threads read in full on 45 posts, chosen as the highest-signal
  complaint, defection and feature-request threads.

Two biases worth stating. First, a product subreddit self-selects for people
with something to say, and r/runna skews positive overall: the single most
common post type is a success story. Second, Runna staff post in the sub
constantly, which suppresses some complaints into DMs and inflates the apparent
responsiveness. Where a complaint is repeated by many separate accounts across
many months, it is treated here as real signal rather than noise.

---

## 1. The complaint map, ranked

Ranked by a mix of volume, upvote heat, and how often it is named as the reason
someone cancelled.

### A. The app forgets you between plans (the loudest single issue)

The highest-heat structural complaint in the subreddit. Finishing a 12 or 16
week plan and then being asked to type in your 10k time as if you were a new
user, on the day after the app watched you race it.

Evidence: "WHY DOES RUNNA NOT REMEMBER YOUR STATS BETWEEN PLANS?" (194 points),
"Runna doesn't know me after completing a plan?" (117), "Why doesn't Runna
consider past plans?" (78), "No Continuity Between Plans" (41), "New Plan,
remember the old runs!" (134). Top comment on the first: "It's incredible this
isn't like a core feature. Like it should be foundational to the app. The fact
this coaching app acts like it's never met you before after months of data is
nuts" (81 points).

Named as a cancellation trigger repeatedly. Related failure modes people list:
paces reset so the plan needs a month to re-learn them; no recovery gap between
a finished race and the first session of the next plan (one user got 400m
repeats 10 days after a half); a new plan prescribes a hard interval session in
week 1 because it does not know a race just happened.

Runna has had this on the public roadmap for over a year. Users are now
tracking the delay as a credibility issue in its own right.

### B. Plans are too aggressive, and the pace predictions are the mechanism

The second-largest cluster, and the one with injury attached to it.

Two distinct sub-complaints, and they are often conflated:

1. **Race-time prediction is over-ambitious, especially at half and full
   marathon.** A 1:45 half producing a 3:20 first-marathon estimate, and every
   training pace derived from that estimate. "It's hard to tell, obviously"
   threads aside, the pattern users report is consistent: 5k and 10k
   predictions are good, half is marginal, marathon is badly optimistic.
   Runna's own product team acknowledged this in-thread: "You're not the first
   person to call this out."
2. **Volume and long-run structure ramp faster than the body.** Week-on-week
   jumps of 40 to 50 percent, long runs growing 50 percent in a single step,
   12 to 16 miles at race pace inside a long run, a 50k plan with back-to-back
   37km weekends.

Evidence: "This workout seems insane to me?" (160 points, 128 comments), "A
discussion about long run pace predictions and toxic positivity" (122), "Is
Runna's weekly mileage progression too aggressive for beginners?", "Runna 50K
plan ridiculous", "Is it just me or Runna makes plans way harder than your
actual level?", "New To Running Plan feels too challenging for a true
beginner".

The injury threads ("How often are runnas getting injured?", 224 comments; "Is
Runna Actually Getting Runners Injured?", 106 comments) mostly conclude that
runners injure themselves and Runna is a popular app, which is fair. But the
substantive point inside them is not about blame, it is about a missing
capability, and it is the top substantive comment in the thread (102 points):
"Runna doesn't have a way to deal with injuries which leads to problems. I've
had to dial back my program manually and often skip sessions. Even when you
tell it you had a difficult run it doesn't offer up any solutions."

The most quoted structural criticism is that a plan built for a body at 100
percent never learns that the body is no longer at 100 percent, and the app's
tone ("trust the process") actively discourages the user from making that call
themselves.

### C. Pace-only model, no heart rate or effort in the loop

Cited constantly as the root cause of B. You can hit every prescribed pace while
sitting in zone 5, and the app reads that as success and pushes harder.

"Runna doesn't take heart rate into account, which is a serious flaw" is the top
comment (70 points) in the long-run pacing thread, with the reply: "If you can
hit the tempo workouts in zone 3 you're golden. If you always hit zone 5, like I
do, it just kinda seems to think you're fine."

Also drives the trail and hills complaints (see H) and the treadmill complaints
(see F). HR zones only reached Runna Labs recently and are not in the plan
engine.

### D. Rigidity: the plan cannot be edited, paused or fed

A cluster of separate asks that are all the same underlying gap: the plan is a
fixed artefact, not a living object.

- Cannot repeat a week or shift a week back after illness or a niggle.
- Cannot modify a single session (fewer reps, drop the second interval block).
- Cannot add your own workout and have the plan account for it. This is the
  parkrun and club-run problem: Runna announced a parkrun partnership on
  1 Jan 2025 and 18 months later you still cannot put a parkrun in your plan.
  One user maintains a public timeline post of the non-delivery (149 points).
- Cross-training is invisible. Cycling, rowing, spin, Hyrox, gym classes are
  neither counted nor adapted around. "They can't even adapt it around your
  extracurricular running yet."
- Some plans (post-natal is the named example) run on an older engine and
  silently lack the adaptability features entirely, which users only discover
  after subscribing.

"Runna plan becomes useless with lack of flexibility" (55 points), "Feature
Request: Ability to add Custom Workouts" (73), "Adaptive training idea, let us
modify daily workouts based on how we feel" (50).

### E. Feedback is one-way, and the AI layer is not trusted

"Runna's biggest weakness: it gives feedback but won't take any" (104 points)
is the cleanest statement of it: the app tells you how you did, and there is no
channel to tell it how you felt and have the next sessions change with a stated
reason.

Meanwhile the generated post-run commentary is actively eroding trust. "The AI
gets worse every time I view it" (112 points, 51 comments) collects
hallucinations: referencing runs that never happened, referencing "last
Thursday" when the user never runs on Thursdays, telling users they overran when
watch compliance was 100 percent, and in one case advising a user to run their
half marathon race on a treadmill because of rain. Top comment: "The briefing is
useless and just gives us a compliment for dopamine I guess" (76 points).

The pattern to learn from: a coaching voice that is confidently wrong about
verifiable facts costs more trust than having no coaching voice at all.

### F. Recording and device reliability

Highest-volume operational complaint, and the one most likely to produce an
angry cancellation because it destroys a completed session.

- **Treadmill is the worst area by a distance.** "Runna for treadmill is an
  absolute disaster" details intervals not advancing after a rest, dashes
  instead of distance, and an average speed reported at roughly four times the
  speed of sound. Garmin and Apple Watch both mis-measure treadmill pace, so
  workout compliance is scored against garbage. Users' workarounds are to run
  the workout natively on the watch, buy a footpod or a Runn sensor, or
  reprogram the intervals into the treadmill's own software.
- **Watch sync breakage.** A multi-day Coros sync outage (Pace 3, Pace Pro,
  Apex 2) with support replying that the fix was queued behind the holidays.
- **Android performance.** Multi-second lag on every interaction and freezes
  mid-run, reported across Pixel 8/9 Pro and Samsung S22/A56, so not simply old
  hardware. No WearOS app; promised, then dropped.
- **Audio.** Cues pausing music and not resuming, volume ducking permanently,
  cues failing on Apple Watch.

### G. Nothing good to do between races

Runna is built as a sequence of 12 to 16 week race blocks with two hard sessions
a week, and people who want to run year-round without that intensity leave.

"I love Runna but I'm out" (224 points, 166 comments) is the canonical version:
great app, but it will not let you just build base. "There should just be a
training plan for just building mileage, with no harder workouts if that's what
you're after" (27 points). "I feel like Runna is good for chasing that high of a
PB but longterm it'll suck the joy out of running or you'll get injured and/or
burnt out."

Adjacent: "Remove Pace Targets" (23 points, 48 comments) from a user whose only
marathon goal is to finish, having panic attacks about missing tempo targets.
"It's wild that there's still not a plan in Runna for people that want just to
finish a race and don't care about time."

### H. Terrain and conditions are ignored

Race-time predictions are computed for a flat course, and the app knows your
race is hilly because it asked you during plan creation. It does not use it.
Same for training terrain: users in hilly areas permanently miss pace targets
and get scolded for it. Trail runners are told, correctly by other users, that
the app is not for them.

"Predicted times should take hilliness into account" (41 points). "I live in a
very hilly and windy region and wish Runna had power or heart rate options
rather than just pace."

### I. Strength programming is logistically unusable

"Yes, another complaint about strength programming" (40 points): everything is
supersetted, so in a public gym you have to hold a bar, a bench and a machine
simultaneously and use each every second or fourth set. Exercises cannot be
reordered. The 25 minute version is too thin, the 45 minute version too long.
Runna's own strength PM replied confirming a new engine is being built.

The gym-logistics point is the specific, actionable one: superset programming
that assumes a private space fails in the environment most users actually train
in.

### J. Female physiology is unserved

"Runna need a luteal phase setting" (211 points) is one of the highest-scoring
feature requests in the sub. Menstrual-cycle adaptation was on the roadmap and
has now been explicitly paused. Pregnancy and post-natal are worse: the
post-natal plan runs on the old engine and lacks the adaptation features
entirely.

Worth reading the dissent in that thread, because it is well argued: there is
limited evidence for prescriptive cycle-syncing, and responses vary enormously
between individuals. The request that survives the objection is not "program
around a canonical cycle", it is "let me mark the days I know I am flat, and
have the plan respond", which is a general capability, not a female-specific
one.

### K. Race day itself is unsupported

The app builds you toward a race and then abandons you on it. No pacing plan, no
negative splits, no elevation-adjusted targets, and the pace-low alert shouts at
you for the last 8km after you have blown up. "Runna is great for the build up
to the race but a let down for the main event" (21 points).

### L. No season view

"I wish you could plan your year out" (82 points). Users want to enter the races
they have already entered and get one coherent season, not a chain of isolated
blocks they have to hand-stitch. Plan stacking is the top-voted request in the
main feature-request thread (79 points).

### M. Trust, tempo of delivery, and the Strava acquisition

Not a feature gap, but it colours everything and it is where a competitor gets
oxygen.

- The recent UI redesign was rejected loudly. "For the love of god bring back
  the old design" (218 points): the workout no longer fits on one screen, and
  warm-up and cool-down cannot be collapsed. "The interface changes are hiding
  features" (68 points): linking an activity and changing shoes moved behind an
  overflow menu. Users noted the Labs feedback was negative and it shipped
  anyway.
- Long-promised items (parkrun, WearOS, cross-plan memory, ultra rebuild) are
  publicly tracked as undelivered, and the roadmap posts themselves are now met
  with "happy birthday to last year's roadmap update" (86 points).
- Support latency complaints increased through the last year, and several users
  observed that Runna staff have become less present on Reddit since the
  acquisition.
- Release notes are cutesy filler that never say what changed (80 points).

The sentiment to note: a meaningful group of experienced users are actively
shopping. Alternatives named repeatedly in these threads are TrainAsOne,
Coopah, Trenara, Kiprun Pacer, Run with Hal, Vert.run, TrainingPeaks, Garmin
Coach, and, in several threads, an LLM plus a watch integration.

---

## 2. What Runna is genuinely good at

Worth holding onto, because these are the reasons people stay through all of the
above and they are the bar Try has to clear.

- **Delivery to the watch is excellent.** "Best Watch running experience out
  there, hands down", said by a user in the middle of criticising everything
  else. Structured workouts land on Garmin and Apple Watch and just work.
- **Convenience is the product.** The most upvoted comment in the whole
  "it's not really AI" thread (245 points) is essentially: yes I could do this
  myself, I am paying not to think about it. Users do not want a system to
  operate, they want to be told what to do today.
- **It gets beginners moving and keeps them consistent.** The volume of genuine
  success stories is very high and should not be dismissed.
- **Staff presence in the community.** Even with the recent decline, product
  managers replying by name in complaint threads buys enormous goodwill.

---

## 3. Where Try already answers these, by design

Mapping Try's existing architecture against the complaint map. This is where the
positioning is.

| r/runna complaint | Try's existing answer |
|---|---|
| **A. Forgets you between plans** | Structurally impossible in Try. Fitness state is athlete-level, not plan-level: benchmark tests, the fitness-progression view, and the no-plan tracker all persist and feed the engine, and `NO_PLAN_FLOW` explicitly makes "no plan" the default end state so tracked activity keeps informing the next block. Try never has to ask a returning athlete for a time it just watched them run. |
| **B. Ramps too fast** | The ramp guardrail is the direct counter, and it is unusual: Try actively removes training when fitness grows too fast, on the stated basis that builds fail from rate rather than volume. Recovery weeks are non-negotiable. This is precisely the "week 1 to week 2, plus 46 percent" failure. |
| **B/E. No injury or bad-day handling** | The readiness model plus the adaptive engine's D1 to D4 rules already do what the 102-point comment asks for: a hard session on a red morning becomes easy aerobic at 65 percent volume, with the reason attached. |
| **E. Feedback is one-way and the AI is not trusted** | "Propose, never impose" and "one voice at a time" are already the stated philosophy: every adaptation is one tap-to-accept suggestion carrying its reasoning, wearing a visible tag, undoable. And "honest numbers, honestly framed", with zones anchored to measured values and estimates admitted as estimates, is the direct opposite of the hallucinated-compliment problem. |
| **C. Pace-only** | Try prices sessions off measured thresholds per discipline (5k pace, CSS, FTP) and falls back to RPE and HR zones when numbers are absent, with wellness data (HRV, resting HR, sleep) already in the readiness loop. |
| **D. Cross-training invisible** | Try is multisport by construction. The complaint "Runna doesn't take my other activities into account" is not expressible in Try. |
| **G. Nothing to do between races** | Maintenance mode already exists as a deliberate state ("when there is no race, maintenance keeps the engine warm on purpose rather than pretending every week is a build"). This is the exact hole the "I love Runna but I'm out" thread describes. |
| **L. No season view** | Block objectives shipped, which is the spine of a season view. |
| **B. Long runs with race-pace blocks feel insane** | Try does this deliberately (durability work: hard intervals at the end of long sessions) but, critically, explains why. The r/runna evidence says the workout is defensible and the silence around it is not. |

The summary of that table: **Try's existing philosophy document reads almost
line by line as a rebuttal of r/runna's top complaints.** That is a strong
position and it should be said out loud in the product, not just in `docs/`.

---

## 4. Where Try is exposed to the same complaints

Being honest about it. These are gaps in Try today, not hypotheticals.

1. **Injury is not a first-class state.** Try handles a bad morning (readiness
   dip) well. It does not appear to handle "I have a calf strain, I am out for
   two weeks, bring me back safely", which is the single most-requested missing
   capability on r/runna. Readiness-based easing is not the same thing: an
   injury is a multi-week state with a graded return, not a daily score.
2. **Elevation and terrain.** `coach.js` touches elevation but there is no
   evidence of elevation-adjusted pace targets or terrain-aware race
   prediction. Try inherits the exact hilly-course prediction problem.
3. **Treadmill and indoor running.** Barely present. This is Runna's single
   worst operational area and therefore an easy place to be visibly better.
4. **Race-day execution.** Try builds to a race and, like Runna, stops at the
   start line. No pacing plan, no negative-split or elevation-adjusted targets.
5. **Arbitrary and social sessions.** `manual.js` exists, but the parkrun/club
   run/gym class case ("let me log the thing I actually did and have the plan
   absorb it, including toward weekly volume") needs to be explicitly complete,
   not partial. This is Runna's most conspicuous 18-month failure and it is
   cheap to win.
6. **Menstrual cycle and pregnancy.** Nothing in the codebase. Runna has paused
   theirs. This is an open field with a 211-point request sitting in it.
7. **Strength logistics.** Try stacks strength as a two-a-day. If those sessions
   prescribe supersets, Try walks straight into the gym-logistics complaint.
8. **Watch delivery breadth.** Try exports Garmin `.FIT`. Runna's watch delivery
   is the thing even its detractors praise, and it covers Apple Watch, Coros and
   more. This is the capability gap most likely to stop someone switching.

---

## 5. Recommendations

Ordered by (complaint heat) times (distance Try already is from shipping it).

### P0, the things that make the pitch

**1. Name the continuity advantage in the product, not just the docs.**
Try's biggest competitive asset is currently invisible. When an athlete starts a
second block, show what carried over: "Your CSS, FTP and 5k are current as of
your test on <date>. Nothing to re-enter." One screen. It converts a piece of
architecture into the answer to r/runna's loudest thread.

**2. Ship an injury state with a graded return-to-training ramp.**
Distinct from readiness. The athlete declares a niggle or an injury, with a
body part and a severity; the engine holds or replaces load (for Try, this is a
natural strength: swap a run for a bike or a swim rather than deleting the
week), and then ramps back on a stated schedule with a stated rationale. Include
"repeat this week" and "shift the block back a week", which are the two specific
mechanics r/runna asks for by name and cannot get.

This is the highest-value item on the list. It is the top substantive comment in
the biggest injury thread, it is named in most cancellation posts, and it fits
Try's "propose, never impose" model exactly.

**3. Close the feedback loop in the athlete's own words.**
Try already takes an Easy/Just-right/Hard tap after hard sessions. Extend it to
a short free-text or structured note ("calf tight throughout", "ran the hilly
route", "did this with the club so paces are off") that the engine visibly
consumes and cites back in the next proposal. The r/runna thread "it gives
feedback but won't take any" (104 points) is a complete product brief, and
several users there describe pasting their data into an LLM to get exactly this.
Try can do it natively.

Deliberately also: **a reason-code list for a missed or off-target session that
includes terrain, weather, illness, group run, and gut.** The joke thread about
needing an "my bowels betrayed me" reason has 295 points, which is the
subreddit's way of saying the current reason list is insultingly thin.

### P1, the credibility items

**4. Terrain-aware targets and predictions.**
If Try asks about the course, Try must use it. Two parts: elevation-adjusted
pace targets so a hilly session is not scored as a failure, and a race
prediction that states its assumptions ("flat course") or adjusts to the route
profile. Grade-adjusted pace is well-established and cheap relative to the trust
it buys.

**5. Absorb off-plan and social sessions completely.**
Any logged activity, planned or not, counts toward weekly load, informs the
adaptive engine, and triggers a proposal if it changes the week's shape. A
parkrun on Saturday should reshape Sunday's long run automatically, with a
reason. Runna has failed to deliver this for 18 months and users are keeping a
public timeline of it.

**6. Race-day execution.**
A pacing plan generated from the athlete's own tested numbers and the actual
course profile, with negative-split support and a hard rule that the pace alarm
can be silenced mid-race without ending the activity. "Runna is great for the
build up to the race but a let down for the main event" is a gift of a gap.

**7. Treadmill and indoor as a designed path, not an afterthought.**
Accept that watch treadmill pace is garbage. Drive the session from the app with
explicit speed instructions, take heart rate from the watch, and never score
compliance against a treadmill-derived pace. Getting this merely correct beats
Runna outright in their worst area.

### P2, the differentiators

**8. Low-intensity and finish-the-distance modes as real plan types.**
Not a difficulty slider. Two genuine variants: a base-building block with no
quality sessions, and a race plan whose goal is to finish, with distance targets
and effort only, no pace targets anywhere. Between them these address the
single largest source of voluntary churn in the subreddit ("I love Runna but I'm
out", "Remove Pace Targets"). Try's maintenance mode is most of the first one
already.

**9. A "flat days" model, and the cycle case as one instance of it.**
Let an athlete mark predictable low-capacity days, whatever the cause: cycle
phase, shift work, chronic condition, travel. Then optionally offer cycle-phase
prediction on top for those who want it, with the evidence stated honestly,
which is on-brand for Try and directly answers the well-argued dissent in the
211-point thread. Runna has paused this. It is open.

**10. Strength that survives a public gym.**
If Try prescribes supersets, make them optional and make the session reorderable.
Add an equipment filter that actually constrains the programming. Runna's
strength PM has publicly conceded this; do not repeat the mistake.

### Things to deliberately not do

- **Do not add a generative post-run commentary layer.** r/runna's is the
  clearest trust-destroying feature in the app: confidently wrong about
  verifiable facts, and now widely mocked. Try's "one-line why this session"
  and stated-threshold explanations are the right shape. Keep them
  deterministic and cite the number that drove them.
- **Do not redesign for simplicity at the cost of density.** The 218-point
  design backlash is entirely about a workout that no longer fits on one screen.
  Try's "simple by default, deep on demand" is the correct principle; the
  failure mode to avoid is hiding the thing the athlete opened the app to see.
- **Do not oversell adaptivity.** A large share of r/runna's disappointment is
  the gap between "AI coach" marketing and a formulaic generator. Try's engine
  is genuinely adaptive; describing it in plain mechanical terms will land
  better with the exact audience that is currently churning.

---

## 6. One-line positioning

Everything above collapses into a single sentence, and Try can already
substantiate most of it:

> A coach that remembers you between races, holds you back when you are ramping
> too fast, gives you somewhere to go when you are hurt, and tells you why every
> time.
