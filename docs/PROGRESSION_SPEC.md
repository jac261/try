# Triathlon Training Progression App

## Product and Implementation Brief for Claude Code

### Purpose

Build a triathlon training application that uses **Intervals.icu as the primary training-data source** and adds an explainable coaching and progression layer on top.

Intervals.icu should remain the source of truth for:

- completed activities;
- planned workouts;
- activity files and time-series data;
- power, pace, heart-rate, cadence, and swim metrics;
- fitness and fatigue modelling;
- athlete wellness data;
- body mass;
- calendar data;
- activity and workout notes.

The application should not initially attempt to replace Intervals.icu. Its primary value is to answer:

1. What is the purpose of the athlete's current training block?
2. Did the athlete achieve the intended adaptation?
3. Is the current workload becoming stable and repeatable?
4. Which variable should progress next?
5. Should the athlete progress, hold, reduce, or recover?
6. Is the athlete becoming more durable for long-course triathlon, rather than merely improving fresh test results?

The app should behave as a **decision layer**, not simply another dashboard.

---

# 1. Product Principles

## 1.1 Source-of-truth separation

Use the following division of responsibility:

### Intervals.icu

- activity storage;
- workout calendar;
- planned and completed sessions;
- raw and processed training data;
- wellness data;
- standard fitness modelling;
- estimated FTP and power-duration information;
- activity visualisation.

### This application

- race-to-session hierarchy;
- training-phase logic;
- progression recommendations;
- multi-sport interaction;
- durability analysis;
- execution assessment;
- recovery interpretation;
- explainable coaching decisions;
- block-level and weekly review.

## 1.2 Explainability over false precision

Do not produce an opaque readiness score such as `82/100` without showing exactly how it was derived.

Prefer separate status domains:

- training completion;
- performance response;
- subjective recovery;
- physiological recovery;
- injury status;
- fuelling and body-mass trend.

The final recommendation should be one of:

- `PROGRESS`;
- `HOLD`;
- `REDUCE_INTENSITY`;
- `REDUCE_VOLUME`;
- `RECOVER`;
- `REST`;
- `RESTRICT_DISCIPLINE`.

Every recommendation must include human-readable reasons.

Example:

> Hold cycling threshold volume this week. The athlete completed both key sessions, but session RPE increased and sleep quality declined across three days. Maintain the current workload before progressing interval duration.

## 1.3 One major progression at a time

The app should avoid recommending simultaneous increases in:

- weekly duration;
- running mileage;
- long-session duration;
- interval duration;
- interval count;
- target intensity;
- gym load.

A recommendation should identify the **single primary progression variable** for each discipline or training block.

## 1.4 Holding is a valid positive outcome

The app must not treat holding a workload as failure.

A workload should often be repeated until it becomes:

- more repeatable;
- lower in perceived exertion;
- more stable in execution;
- less disruptive to recovery;
- better supported by fuelling;
- more durable late in the session.

## 1.5 Full-distance specificity should be phased

The athlete is approximately one year from a full-distance triathlon.

Use the following broad phases:

| Time before race | Main objective |
|---|---|
| 12–9 months | General development and weakness correction |
| 9–6 months | Aerobic volume and threshold development |
| 6–3 months | Long-course durability and increasing specificity |
| Final 10–12 weeks | Race-specific preparation |
| Final 2–3 weeks | Taper |

The current phase should prioritise:

- swim technique;
- cycling threshold and aerobic power;
- strength;
- general aerobic development;
- gradual body-mass gain;
- recovery capacity.

Do not encourage repeated full-distance simulation sessions one year out.

---

# 2. User Context

Use these initial athlete details as configurable profile defaults:

```yaml
athlete:
  body_mass_kg: 64
  bike_ftp_watts: 222
  bike_ftp_w_per_kg: 3.47
  swim_css_per_100m: "2:07"
  run_threshold_pace_per_km: "4:17"
  half_marathon_pb: "1:31"
  target_event_type: "full_distance_triathlon"
  target_event_horizon_months: 12
  primary_current_goals:
    - improve swim technique
    - raise cycling FTP
    - gain body mass gradually
    - preserve running strength
    - build long-course durability progressively
```

These values must be editable.

---

# 3. Core Domain Hierarchy

Model training using:

```text
Race
└── Phase
    └── Block
        └── Week
            └── Session
                └── Interval
```

## 3.1 Race

Suggested fields:

```typescript
type Race = {
  id: string;
  athleteId: string;
  name: string;
  eventType:
    | "SPRINT"
    | "OLYMPIC"
    | "MIDDLE_DISTANCE"
    | "FULL_DISTANCE"
    | "OTHER";
  raceDate: string;
  priority: "A" | "B" | "C";
  location?: string;
  terrain?: "FLAT" | "ROLLING" | "HILLY" | "MOUNTAINOUS";
  expectedConditions?: {
    temperatureC?: number;
    humidityPercent?: number;
    wind?: string;
  };
  goals?: string[];
};
```

## 3.2 Phase

```typescript
type TrainingPhase = {
  id: string;
  raceId: string;
  name:
    | "GENERAL_DEVELOPMENT"
    | "AEROBIC_BUILD"
    | "DURABILITY"
    | "RACE_SPECIFIC"
    | "TAPER"
    | "TRANSITION";
  startDate: string;
  endDate: string;
  primaryObjectives: string[];
  secondaryObjectives: string[];
};
```

## 3.3 Block

Each block should have one primary objective.

```typescript
type TrainingBlock = {
  id: string;
  phaseId: string;
  startDate: string;
  endDate: string;
  primaryObjective:
    | "SWIM_TECHNIQUE"
    | "SWIM_CSS"
    | "BIKE_THRESHOLD"
    | "BIKE_VO2MAX"
    | "BIKE_DURABILITY"
    | "RUN_THRESHOLD"
    | "RUN_DURABILITY"
    | "STRENGTH"
    | "RACE_SPECIFIC"
    | "RECOVERY";
  secondaryObjectives: string[];
  maintenanceObjectives: string[];
  progressionVariable?: string;
  targetWeeks: number;
};
```

## 3.4 Session purpose

Every planned workout must have one explicit primary purpose.

```typescript
type SessionPurpose =
  | "RECOVERY"
  | "AEROBIC_BASE"
  | "TECHNIQUE"
  | "THRESHOLD"
  | "VO2MAX"
  | "TEMPO"
  | "RACE_PACE"
  | "DURABILITY"
  | "BRICK_ADAPTATION"
  | "STRENGTH"
  | "MOBILITY"
  | "TEST"
  | "OPEN_WATER_SKILL";
```

A workout should be evaluated against its purpose, not only whether it was completed.

---

# 4. Activity and Session Evaluation

## 4.1 Completion classification

Do not use a binary completed/not-completed model.

Use:

```typescript
type CompletionStatus =
  | "COMPLETED_AS_PLANNED"
  | "COMPLETED_HARDER_THAN_PLANNED"
  | "MODIFIED_APPROPRIATELY"
  | "PARTIALLY_COMPLETED"
  | "MISSED_FATIGUE"
  | "MISSED_ILLNESS"
  | "MISSED_INJURY"
  | "MISSED_EXTERNAL"
  | "ABANDONED";
```

The reason for a missed or modified workout must affect the recommendation.

Examples:

- travel-related missed workout should not automatically trigger a recovery recommendation;
- repeated fatigue-related failures should;
- an appropriately shortened workout due to warning signs may count as a good decision rather than non-compliance.

## 4.2 Post-session input

After each session, collect:

```typescript
type PostSessionFeedback = {
  sessionRpe: number; // 1–10
  perceivedExecution:
    | "BELOW_TARGET"
    | "ON_TARGET"
    | "ABOVE_TARGET";
  legs?: number; // 1–5
  breathing?: number; // 1–5
  motivation?: number; // 1–5
  painScore?: number; // 0–10
  painLocation?: string;
  carbohydrateGramsPerHour?: number;
  fluidMlPerHour?: number;
  notes?: string;
};
```

Keep the athlete interaction brief.

Suggested prompt:

> How did that session go?

Suggested minimum input:

- RPE;
- execution;
- pain;
- optional note.

## 4.3 Session load

Support simple session-RPE load:

```text
session load = duration in minutes × session RPE
```

Use this as one input only. Do not present it as a perfect physiological measure.

Also retain Intervals.icu load metrics where available.

---

# 5. Progression Engine

The progression engine is the central application feature.

## 5.1 Output type

```typescript
type ProgressionDecision =
  | "PROGRESS"
  | "HOLD"
  | "REDUCE_INTENSITY"
  | "REDUCE_VOLUME"
  | "RECOVER"
  | "REST"
  | "RESTRICT_DISCIPLINE";
```

## 5.2 Progress conditions

Recommend `PROGRESS` when most of the following are true:

- the relevant workout has been completed successfully more than once;
- execution quality is stable or improving;
- session RPE is stable or falling;
- performance is stable or improving;
- recovery markers remain normal;
- there is no meaningful or worsening pain;
- easy sessions still feel easy;
- the current progression variable has become repeatable;
- the athlete has completed at least two stable weeks unless the block design specifies otherwise.

Potential progression actions:

- add one interval;
- increase interval duration;
- extend the long ride;
- extend the long swim;
- add a small amount of easy volume;
- slightly increase target power or pace;
- increase strength load;
- increase aero-position duration;
- increase race-fuelling rehearsal duration.

## 5.3 Hold conditions

Recommend `HOLD` when:

- the athlete is adapting;
- the workload is productive;
- sessions remain challenging but manageable;
- recovery is acceptable;
- performance is improving at the existing load;
- there is insufficient evidence to justify progression;
- a recent load increase has not yet stabilised.

## 5.4 Recovery conditions

Recommend reduction or recovery when there is agreement across multiple domains.

Possible indicators:

- multiple key-session underperformances;
- rising session RPE at unchanged output;
- poor sleep over several days;
- declining motivation;
- abnormal resting heart rate or HRV trend;
- unusual difficulty during warm-up;
- persistent soreness;
- worsening pain;
- illness symptoms;
- reduced late-session durability;
- repeated inability to complete easy sessions at expected effort;
- rapid training-load increase;
- inadequate fuelling;
- undesired body-mass loss.

Do not allow a single device metric to determine the recommendation.

## 5.5 Rule-engine example

```typescript
function decideBikeThresholdProgression(
  context: BikeThresholdContext
): ProgressionRecommendation {
  if (context.painScore >= 5 || context.worseningPain) {
    return {
      decision: "RESTRICT_DISCIPLINE",
      reason: "Worsening pain exceeds the progression threshold."
    };
  }

  if (
    context.failedKeySessions >= 2 &&
    context.subjectiveRecovery === "POOR"
  ) {
    return {
      decision: "RECOVER",
      reason:
        "Multiple failed key sessions coincide with poor subjective recovery."
    };
  }

  if (
    context.successfulExposures >= 2 &&
    context.rpeTrend !== "RISING" &&
    context.performanceTrend !== "DECLINING" &&
    context.subjectiveRecovery !== "POOR"
  ) {
    return {
      decision: "PROGRESS",
      action: "INCREASE_INTERVAL_DURATION",
      reason:
        "The athlete has repeated the current threshold workload successfully with stable effort and recovery."
    };
  }

  return {
    decision: "HOLD",
    reason:
      "The current workload remains productive, but there is not enough evidence to progress safely."
  };
}
```

Rules should later be configurable, versioned, and testable.

---

# 6. Four-Domain Adaptation Model

The app should evaluate four distinct kinds of adaptation.

## 6.1 Compliance

Track:

- planned versus completed duration;
- planned versus completed sessions;
- completion classification;
- completion of key sessions;
- reasons for missed or modified sessions;
- intensity distribution;
- discipline balance.

Do not reward meaningless volume accumulation.

## 6.2 Fresh performance

Track discipline-specific markers:

### Swim

- CSS;
- benchmark set pace;
- stroke count;
- pace stability;
- technique score if manually entered.

### Bike

- tested FTP;
- eFTP;
- power-duration curve;
- threshold workout completion;
- VO2max workout completion;
- standardised submaximal power.

### Run

- threshold pace;
- critical speed;
- benchmark race or time trial;
- standardised aerobic run;
- long-run pace stability.

### Strength

- exercise load;
- repetitions;
- estimated repetitions in reserve;
- weekly hard sets;
- whether soreness affects endurance quality.

Tests should generally occur every six to eight weeks rather than continuously.

## 6.3 Submaximal efficiency

For standardised aerobic sessions, compare:

- pace or power;
- heart rate;
- RPE;
- cadence or stroke rate;
- cardiac drift;
- temperature;
- wind;
- elevation;
- surface;
- duration;
- fuelling state.

Example interpretation:

```text
same output + lower heart rate + lower RPE = likely improvement
same output + higher heart rate + higher RPE = possible fatigue, heat, dehydration, illness, or under-fuelling
```

The app must identify environmental or contextual confounders where possible.

Suggested standard sessions:

- bike: 60 minutes at a fixed sub-threshold power;
- run: repeated easy route or fixed heart-rate run;
- swim: repeated aerobic intervals with fixed rest.

## 6.4 Durability

Durability should have its own dashboard.

Track:

- first-third versus final-third power;
- first-half versus second-half pace;
- heart-rate drift;
- power-to-heart-rate ratio drift;
- pace-to-heart-rate ratio drift;
- cadence degradation;
- stroke-rate or stroke-count degradation;
- aero-position maintenance;
- late-session RPE;
- carbohydrate intake;
- fluid intake;
- post-session recovery;
- brick-run performance after a standardised ride;
- next-day recovery response.

Example durability model:

```typescript
type DurabilityMetrics = {
  outputDropPercent?: number;
  heartRateDriftPercent?: number;
  efficiencyFactorDropPercent?: number;
  cadenceDropPercent?: number;
  lateSessionRpe?: number;
  carbIntakeGramsPerHour?: number;
  recoveryHours?: number;
};
```

A rising FTP with worsening durability should not be treated as complete long-course improvement.

---

# 7. Recovery and Readiness Model

## 7.1 Daily recovery inputs

Track:

- sleep duration;
- subjective sleep quality;
- general fatigue;
- muscle soreness;
- motivation;
- stress;
- resting heart rate;
- HRV;
- illness symptoms;
- pain;
- body mass.

## 7.2 Traffic-light output

Use a simple presentation:

### Green

- recovery broadly normal;
- no meaningful pain;
- normal motivation;
- normal warm-up;
- proceed as planned.

### Amber

- two or more markers noticeably worse;
- unusual warm-up difficulty;
- elevated soreness;
- declining sleep;
- modify, shorten, or reduce intensity.

### Red

- illness;
- worsening localised pain;
- severe fatigue;
- marked performance decline;
- several poor markers across multiple days;
- stop intensity and recommend recovery or medical evaluation where appropriate.

## 7.3 Domain-based status

```typescript
type WeeklyStatus = {
  trainingCompletion: "ON_TRACK" | "DISRUPTED";
  performanceResponse: "IMPROVING" | "STABLE" | "DECLINING";
  subjectiveRecovery: "GOOD" | "MIXED" | "POOR";
  physiologicalRecovery: "NORMAL" | "UNCERTAIN" | "ABNORMAL";
  injuryStatus: "CLEAR" | "MONITOR" | "RESTRICT";
  fuellingAndWeight: "ON_TARGET" | "INSUFFICIENT" | "EXCESSIVE";
};
```

The final recommendation should be derived from these components and display them separately.

---

# 8. Weekly Review Screen

Create one primary weekly review page.

## 8.1 Planned versus completed

Display:

- planned hours;
- completed hours;
- planned load;
- completed load;
- hours by discipline;
- hard-session count;
- key-session completion;
- longest swim;
- longest ride;
- longest run;
- strength sessions completed.

## 8.2 Adaptation

Display:

- FTP and eFTP trend;
- CSS trend;
- run threshold trend;
- standard-session efficiency;
- durability trend;
- strength trend.

## 8.3 Recovery

Display:

- sleep trend;
- fatigue;
- soreness;
- stress;
- motivation;
- HRV;
- resting heart rate;
- pain status;
- body-mass trend.

## 8.4 Coaching decision

Example:

```yaml
weekly_decision:
  overall: HOLD
  bike_threshold:
    decision: PROGRESS
    action: increase interval duration
  swim_technique:
    decision: HOLD
  running:
    decision: MAINTAIN
  strength:
    decision: PROGRESS
    action: increase load on primary lower-body lift
  total_volume:
    decision: HOLD
  recovery:
    status: NORMAL
```

Human-readable summary:

> Progress bike threshold interval duration next week. Hold total training volume, maintain running load, and continue current swim frequency. Recovery is normal and no injury restriction is present.

---

# 9. Monthly and Block Review

Every four weeks, prompt the athlete to review:

1. What clearly improved?
2. What remained stagnant?
3. What created disproportionate fatigue?
4. Which sessions were repeatedly missed or modified?
5. Is body mass moving in the intended direction?
6. Is the current block still addressing the athlete's largest limitation?
7. What is the single most important progression for the next block?

The app should avoid rewriting an entire programme after one poor week.

Use repeated patterns rather than isolated events.

---

# 10. Discipline-Specific Progression Logic

## 10.1 Swim

Track:

- weekly frequency;
- weekly metres;
- CSS;
- standard-set pace;
- stroke count;
- rest duration;
- pace degradation;
- technique notes;
- open-water skills.

Possible progression order:

1. improve consistency and frequency;
2. improve technique quality;
3. increase repeat count;
4. increase repeat distance;
5. reduce rest;
6. increase pace;
7. extend continuous race-specific work.

Avoid automatically increasing volume when technique deteriorates.

## 10.2 Bike

Track:

- total hours;
- low-intensity volume;
- threshold time;
- VO2max time;
- FTP and eFTP;
- interval completion;
- RPE;
- heart-rate response;
- long-ride durability;
- aero-position time;
- fuelling.

Example threshold progression:

```text
3 × 10 min
3 × 12 min
3 × 15 min
recovery week
2 × 20 min
3 × 15 min at slightly higher power
```

Prefer increasing accumulated quality time before increasing target power.

## 10.3 Run

Track:

- duration;
- distance;
- longest run;
- intensity sessions;
- threshold pace;
- easy-run heart rate;
- easy-run RPE;
- late-run pace stability;
- pain;
- stiffness;
- shoe usage;
- surface;
- elevation.

Run progression should be more conservative than swim or bike progression because of mechanical injury risk.

Do not automatically recommend seven runs per week.

## 10.4 Strength

Track:

- exercise;
- load;
- repetitions;
- sets;
- estimated repetitions in reserve;
- velocity if available;
- soreness;
- effect on key endurance sessions.

Strength progression should support triathlon performance and durability rather than maximise bodybuilding volume.

---

# 11. Body-Mass and Fuelling Context

The athlete currently weighs approximately 64 kg and aims to gain gradually.

Track:

- daily morning body mass;
- seven-day rolling average;
- weekly rate of change;
- total energy intake if available;
- protein intake;
- carbohydrate availability;
- carbohydrate intake during long and hard sessions.

Initial target:

```text
0.10–0.16 kg gain per week
```

Possible status rules:

```typescript
if (weeklyGainKg < 0.05 for 2 consecutive weeks) {
  status = "INSUFFICIENT";
}

if (weeklyGainKg >= 0.10 && weeklyGainKg <= 0.16) {
  status = "ON_TARGET";
}

if (weeklyGainKg > 0.25 for 2 consecutive weeks) {
  status = "EXCESSIVE";
}
```

Training fuel should not be treated as optional surplus.

The app should flag:

- body-mass loss during a gain phase;
- inadequate carbohydrate intake during long sessions;
- repeated high RPE associated with under-fuelling;
- poor recovery combined with low energy intake.

---

# 12. Intervals.icu Integration

## 12.1 Integration responsibilities

Use Intervals.icu for:

- athlete profile;
- activities;
- activity streams;
- calendar workouts;
- wellness data;
- FTP and related performance metrics;
- planned and completed training load.

Use this application for:

- synchronisation;
- enrichment;
- progression decisions;
- block management;
- review workflow;
- explainable recommendations.

## 12.2 Authentication

For a personal prototype:

- support an API key.

For a public application:

- use OAuth;
- request only required permissions;
- do not ask users to share personal API keys;
- encrypt credentials at rest;
- support token revocation.

## 12.3 Event-driven flow

Preferred pipeline:

1. Receive an activity-created or activity-updated webhook.
2. Fetch the activity and relevant streams.
3. Match the completed activity to the planned session.
4. Calculate execution metrics.
5. Prompt the athlete for RPE and subjective feedback.
6. Update week and block status.
7. Recalculate progression recommendations.
8. Optionally update future planned workouts.
9. Write approved changes back to the Intervals.icu calendar.

Do not automatically modify the athlete's calendar without:

- an audit trail;
- visible rationale;
- undo support;
- configurable approval mode.

## 12.4 Sync states

```typescript
type SyncState =
  | "PENDING"
  | "SYNCED"
  | "CONFLICT"
  | "FAILED"
  | "IGNORED";
```

Handle:

- duplicate activities;
- edited activities;
- deleted activities;
- unmatched planned sessions;
- manually completed sessions;
- time-zone differences;
- partial API failures.

---

# 13. Suggested Data Model

```typescript
type Athlete = {
  id: string;
  intervalsAthleteId: string;
  timezone: string;
  bodyMassKg?: number;
  ftpWatts?: number;
  cssSecondsPer100m?: number;
  runThresholdSecondsPerKm?: number;
};

type PlannedSession = {
  id: string;
  athleteId: string;
  blockId: string;
  intervalsCalendarId?: string;
  sport: "SWIM" | "BIKE" | "RUN" | "STRENGTH" | "OTHER";
  purpose: SessionPurpose;
  scheduledDate: string;
  plannedDurationMinutes: number;
  plannedLoad?: number;
  targetDescription?: string;
  progressionVariable?: string;
};

type CompletedActivity = {
  id: string;
  athleteId: string;
  intervalsActivityId: string;
  matchedPlannedSessionId?: string;
  sport: "SWIM" | "BIKE" | "RUN" | "STRENGTH" | "OTHER";
  startTime: string;
  durationMinutes: number;
  distanceMeters?: number;
  load?: number;
  averageHeartRate?: number;
  normalizedPower?: number;
  averagePower?: number;
  averagePaceSecondsPerKm?: number;
  completionStatus?: CompletionStatus;
};

type DailyWellness = {
  id: string;
  athleteId: string;
  date: string;
  bodyMassKg?: number;
  restingHeartRate?: number;
  hrv?: number;
  sleepMinutes?: number;
  sleepQuality?: number;
  fatigue?: number;
  soreness?: number;
  motivation?: number;
  stress?: number;
  painScore?: number;
  illnessSymptoms?: boolean;
};

type Recommendation = {
  id: string;
  athleteId: string;
  scope:
    | "SESSION"
    | "DISCIPLINE"
    | "WEEK"
    | "BLOCK"
    | "OVERALL";
  scopeId?: string;
  decision: ProgressionDecision;
  action?: string;
  reasons: string[];
  evidence: {
    metric: string;
    value: string | number;
    interpretation: string;
  }[];
  createdAt: string;
  ruleVersion: string;
};
```

---

# 14. Recommendation Explainability

Every recommendation must show:

- decision;
- proposed action;
- evidence;
- uncertainty;
- conflicting signals;
- rule version;
- date generated.

Example:

```json
{
  "decision": "HOLD",
  "action": "Repeat 3 × 12 minutes at threshold",
  "reasons": [
    "Both threshold sessions were completed",
    "Session RPE rose from 7 to 8",
    "Sleep quality declined for three consecutive nights",
    "No injury warning is present"
  ],
  "uncertainty": "Moderate",
  "conflictingSignals": [
    "Power execution improved despite poorer sleep"
  ]
}
```

The athlete should be able to inspect why the app made a decision.

---

# 15. Safety and Guardrails

The app is a training-support tool, not a medical diagnostic system.

Immediately restrict intensity and display an appropriate warning when the athlete reports:

- chest pain;
- fainting;
- severe shortness of breath outside expected exertion;
- acute neurological symptoms;
- severe or rapidly worsening pain;
- signs of serious illness;
- inability to bear weight;
- suspected fracture;
- repeated unexplained performance collapse.

Use cautious wording:

> Stop training and seek assessment from an appropriate medical professional.

Do not diagnose.

---

# 16. MVP Scope

Build the first version around the smallest valuable workflow.

## MVP 1

### Required

- Intervals.icu authentication;
- athlete sync;
- activity sync;
- calendar workout sync;
- wellness sync;
- planned-to-completed session matching;
- post-session RPE entry;
- weekly review screen;
- rule-based `PROGRESS`, `HOLD`, and `RECOVER` recommendations;
- explanation for every recommendation;
- manual block objective;
- audit log.

### Exclude initially

- full activity visualisation;
- FIT-file hosting;
- custom power-duration modelling;
- complex AI-generated plans;
- automated nutrition prescription;
- social features;
- coach marketplace;
- automatic calendar changes without approval.

## MVP 2

- standardised session detection;
- submaximal efficiency trends;
- durability metrics;
- sport-specific progression rules;
- body-mass trend integration;
- fuelling analysis;
- write-back to Intervals.icu;
- block templates;
- coach review mode.

## MVP 3

- adaptive planning;
- athlete-specific response modelling;
- uncertainty-aware recommendations;
- pattern detection across blocks;
- comparative block analysis;
- race-specific modelling;
- explainable machine-learning assistance.

---

# 17. Initial User Interface

## 17.1 Home

Show:

- today's planned sessions;
- current recovery status;
- current block objective;
- latest recommendation;
- unresolved pain or recovery warning;
- weekly completion status.

## 17.2 Weekly Review

Show:

- plan versus completion;
- hours by discipline;
- key-session outcomes;
- recovery domains;
- adaptation domains;
- progression decisions;
- written weekly summary.

## 17.3 Block View

Show:

- block objective;
- progression variable;
- completed key sessions;
- performance trend;
- recovery trend;
- planned next progression;
- block review questions.

## 17.4 Durability View

Show:

- output degradation;
- heart-rate drift;
- efficiency-factor degradation;
- late-session cadence;
- fuelling;
- recovery duration;
- long-session comparison.

## 17.5 Recommendation Detail

Show:

- recommendation;
- rationale;
- evidence;
- conflicting signals;
- uncertainty;
- history;
- accept, modify, or reject action.

---

# 18. Initial Weekly Decision Logic

Implement deterministic rules before machine learning.

Example priority order:

```text
1. Medical or injury restriction
2. Illness
3. Severe recovery failure
4. Repeated key-session failure
5. Excessive load increase
6. Under-fuelling or undesired body-mass loss
7. Stable adaptation
8. Progression eligibility
9. Hold by default
```

Default to `HOLD` when evidence is insufficient.

Never default to progression merely because the calendar reached a new week.

---

# 19. Testing Requirements

## 19.1 Unit tests

Test:

- each progression rule;
- conflicting-signal resolution;
- missing-data handling;
- body-mass trend logic;
- planned-to-completed session matching;
- duplicate webhook handling;
- time-zone conversion;
- progression-variable selection.

## 19.2 Scenario tests

Create fixtures for:

1. Successful threshold block with stable recovery.
2. Successful sessions but rising RPE and poor sleep.
3. Missed sessions due to travel.
4. Missed sessions due to fatigue.
5. Increasing FTP but worsening durability.
6. Good fitness trend with emerging pain.
7. Body-mass loss during high training volume.
8. Incomplete wellness data.
9. Conflicting HRV and subjective recovery.
10. Recovery week completed successfully.

## 19.3 Acceptance criteria

The MVP is successful when an athlete can:

1. connect Intervals.icu;
2. sync planned and completed training;
3. review one week in a single screen;
4. enter brief post-session feedback;
5. receive an explainable progression decision;
6. understand why the app recommended progress, hold, or recovery;
7. override the recommendation;
8. see an audit trail of decisions and changes.

---

# 20. Suggested Technical Approach

Choose the existing project stack where possible.

A reasonable default architecture:

```text
Frontend:
- Next.js
- TypeScript
- React
- Tailwind CSS

Backend:
- Next.js API routes or a separate Node service
- TypeScript
- PostgreSQL
- Prisma ORM

Background processing:
- queue for webhook processing
- idempotent jobs
- retry support

Authentication:
- application auth
- Intervals.icu OAuth or API-key connection

Observability:
- structured logs
- sync error tracking
- recommendation audit log
- rule-version tracking
```

Do not introduce unnecessary infrastructure before the core workflow works.

---

# 21. Build Order for Claude Code

Implement in this order:

## Phase 1: Foundation

1. Inspect the repository and document the current stack.
2. Add environment-variable handling.
3. Add athlete and integration models.
4. Implement Intervals.icu authentication.
5. Implement activity, calendar, and wellness sync.
6. Add idempotent webhook handling.
7. Add sync logs and error states.

## Phase 2: Training Model

1. Implement race, phase, block, week, and session models.
2. Add session purpose.
3. Add planned-to-completed matching.
4. Add post-session feedback.
5. Add completion classification.

## Phase 3: Decision Engine

1. Implement domain statuses.
2. Implement deterministic progression rules.
3. Add rule versions.
4. Add evidence and rationale generation.
5. Default to `HOLD` when evidence is insufficient.
6. Add recommendation history.

## Phase 4: Weekly Review UI

1. Add planned versus completed summary.
2. Add discipline totals.
3. Add key-session outcomes.
4. Add recovery status.
5. Add adaptation status.
6. Add recommendation panel.
7. Add override and comment workflow.

## Phase 5: Durability

1. Add long-session segmentation.
2. Add output degradation.
3. Add heart-rate drift.
4. Add efficiency-factor drift.
5. Add fuelling and recovery context.
6. Add durability dashboard.

---

# 22. Coding Instructions

When implementing:

- use strict TypeScript;
- validate all external API responses;
- keep integration code separate from coaching logic;
- make progression rules pure functions where possible;
- keep rules configurable and versioned;
- write tests before adding complex heuristics;
- use idempotency keys for webhooks;
- never silently overwrite athlete data;
- preserve an audit trail;
- expose uncertainty and missing data;
- avoid hidden magic numbers;
- document every threshold;
- prefer simple deterministic rules before machine learning;
- do not build features already provided adequately by Intervals.icu unless required for the coaching workflow.

---

# 23. First Claude Code Task

Start by inspecting the repository and returning:

1. current architecture;
2. existing data models;
3. existing Intervals.icu integration;
4. missing dependencies;
5. proposed implementation plan;
6. database migrations required;
7. files that will be created or changed;
8. risks and unresolved assumptions.

Then implement only the first vertical slice:

> Connect an athlete to Intervals.icu, sync the previous 14 days of activities and wellness data, display them in a basic weekly review, and store a post-session RPE entry.

Do not begin adaptive recommendations until this data flow is working and tested.
