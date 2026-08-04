# Try — Visual Style Guide

The single source of truth for Try's look & feel. Use it when creating any visual
asset — app icons, social/share cards, screenshots, marketing images, or new UI.

> **Living reference:** open [`style-guide.html`](style-guide.html) (or
> [jac261.github.io/try/docs/style-guide.html](https://jac261.github.io/try/docs/style-guide.html))
> for rendered swatches, gradients, type and components you can eyedrop directly.
> Every token below is defined as a CSS variable in [`../src/styles.css`](../src/styles.css)
> (`:root`); discipline/phase data lives in [`../src/lib/disciplines.js`](../src/lib/disciplines.js)
> and [`../src/lib/domain.js`](../src/lib/domain.js), the readiness bands & Form zones in
> [`../src/lib/wellness.js`](../src/lib/wellness.js), and the icon set in
> [`../src/components/Icon.jsx`](../src/components/Icon.jsx) — those files are
> authoritative; keep this guide in sync if they change.

---

## 1. Brand in one line

A **calm, confident, premium** triathlon coach. Dark navy canvas, lots of breathing
room, one bright white call-to-action per screen, and three vivid discipline colours
(swim / bike / run) used sparingly as accents. Heavy, tightly-tracked type. Think
"pro sports app at night," not "busy dashboard."

**Principles**
- **Dark-first.** The app is dark-only (`color-scheme: dark`). Never design a light asset.
- **One hero per view.** White is the primary action colour — use it once, deliberately.
- **Colour = meaning.** Discipline and phase colours are semantic, not decorative. Don't recolour a swim asset orange.
- **Soft, deep elevation.** Big soft shadows and 14–24px rounded corners. No hard edges, no thin 1px drop shadows.

---

## 2. Colour scheme

### Core surfaces
| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0e1217` | App background (dark navy). Also the PWA `theme_color` / `<meta theme-color>`. **Use as the base for every asset.** |
| `--card` | `#1a1f29` | Default card surface |
| `--card-2` | `#222a38` | Elevated / info cards |
| `--chip` | `#232b38` | Inset chips, filter pills, inputs |
| `--line` | `#2a3140` | Borders & dividers |
| `--track` | `#2b3342` | Progress / chart track (the unfilled bar) |

### Text
| Token | Hex | Role |
|---|---|---|
| `--ink` | `#f4f7fb` | Primary text (near-white) |
| `--muted` | `#8b95a7` | Secondary / labels (blue-grey) |
| `--faint` | `#6f7b93` | Tertiary (dates, captions) |

### Brand & accent
| Token | Hex / value | Role |
|---|---|---|
| `--accent` | `#ffffff` | **Primary CTA**, progress fill, active nav, completion checks |
| `--accent-ink` | `#0e1217` | Text/icon on a white accent surface |
| `--blue` | `#5b8cff` | Brand blue — tags, banners, links, input focus |
| `--blue-soft` | `rgba(91,140,255,.16)` | Blue tint background (banners, key tags) |
| `--chart` | `#9fb1cc` | Chart bars (light blue-grey) |

### Discipline colours
Each discipline has a **solid** colour (text/labels) and a **gradient** (the rounded
tile behind its icon — the most recognisable brand element).

| Discipline | Solid | Gradient (135°) |
|---|---|---|
| **Swim** | `#38bdf8` | `#38bdf8 → #2563eb` |
| **Bike** | `#fb923c` | `#fbbf24 → #f97316` |
| **Run** | `#34d399` | `#4ade80 → #10b981` |
| **Brick** | `#c084fc` | `#c084fc → #8b5cf6` |
| **Strength** | `#94a3b8` | `#94a3b8 → #64748b` |
| **Rest** | `#3a3f4a` | `#3a3f4a → #2a2f38` |

Icons sit **white** on the gradient tile, with an inset hairline `inset 0 0 0 1px rgba(255,255,255,.12)`.

### Training-phase colours
Used for week/phase badges and progress accents. They deliberately reuse discipline hues.

| Phase | Hex | Meaning |
|---|---|---|
| **Base** | `#38bdf8` | Build aerobic engine & technique |
| **Build** | `#fb923c` | Add intensity & race-specific work |
| **Peak** | `#f87171` | Sharpen at race pace |
| **Taper** | `#c084fc` | Rest, recover & arrive fresh |

### Semantic / state
| Purpose | Colour | Notes |
|---|---|---|
| Danger / error / Peak / **Fatigue line** | `--danger` `#f87171` | Destructive actions, Peak phase, the ATL chart line, high-risk zone |
| Feel: "Easy" | run green `#34d399` | post-session feedback |
| Feel: "Just right" | blue `#5b8cff` (text `#9ab8ff`) | |
| Feel: "Hard" | bike amber `#fb923c` | |

### Readiness bands
The daily readiness score (0–100) reuses the traffic-light hues — the score
disc, the card's band rail (`rd-green/amber/red`, a 3px gradient fading to a
fifth of the colour) and the readiness-trend line in Progress all wear the
current band's colour.

| Band | Score | Colour |
|---|---|---|
| 🟢 Ready to roll | ≥ 75 | run green `#34d399` (`--run`) |
| 🟠 Ease into it | 55–74 | bike amber `#fb923c` (`--bike`) |
| 🔴 Recover today | < 55 | `--danger` `#f87171` |

### Form (TSB) training zones
The load charts shade the classic PMC zones as translucent horizontal strata.
**Colours are chosen for what the word means** (colour psychology): caution
yellow for the detraining drift of Transition, crisp cyan for Fresh (clean
water, race-ready), receding neutral grey, growth green for Optimal, alarm red for
High risk. Each band is a **subtle vertical gradient whose intensity grows
toward the extreme** — further from balanced, more saturated (grey stays flat).
Only the zone the form line currently occupies is labelled in-chart and
brightened (+0.08 alpha). Defined in `wellness.FORM_ZONES`.

| Zone | TSB | Colour · alpha | Gradient |
|---|---|---|---|
| Transition | > +25 | `#facc15` · 0.20 | stronger upward |
| Fresh | +5 … +25 | `#22d3ee` · 0.20 | stronger upward |
| Grey zone | −10 … +5 | `#94a3b8` · 0.10 | flat |
| Optimal | −30 … −10 | `#34d399` · 0.20 | stronger downward |
| High risk | < −30 | `#ef4444` · 0.34 | stronger downward |

### Ramp-rate zones
Same conventions as the Form zones (meaning-bearing colours, gradients toward the
extreme, active-zone label, boundary numbers on the axis), anchored on the coaching
guidance that ~5/week is the sustainable build ceiling. Defined in `wellness.RAMP_ZONES`.

| Zone | Ramp /wk | Colour · alpha |
|---|---|---|
| Risky | > +8 | `#ef4444` · 0.30 |
| Aggressive | +5 … +8 | `#facc15` · 0.20 |
| Building | 0 … +5 | `#34d399` · 0.18 |
| Steady | −3 … 0 | `#94a3b8` · 0.10 |
| Detraining | < −3 | `#38bdf8` · 0.18 |

### Load-chart lines
| Series | Colour |
|---|---|
| Fitness (CTL) | `--blue` `#5b8cff`, filled area |
| Fatigue (ATL) | `--danger` `#f87171` |
| Form (TSB) | brick purple `#c084fc` |

### Tag / badge tints
Pill badges pair a translucent tint with a saturated text colour.

| Tag | Background | Text |
|---|---|---|
| `key`, `added` | `--blue-soft` | `--tag-key-ink` |
| `recovery`, `boosted` | `rgba(56,189,248,.15)` | `#9adcf8` |
| `moved` | `rgba(192,132,252,.16)` | `#d9b6ff` |
| `test` | `rgba(251,191,36,.18)` | `#fcd28a` |
| `second`, `indoor` | `rgba(148,163,184,.2)` | `--chrome-text` |
| `eased` | `rgba(52,211,153,.16)` | `--tag-eased-ink` |

The inks are the Tags docs' own, which run lighter than the saturated ones
they replaced; every tag now clears AA on its own tint in both materials
(worst 5.2 moulded, 7.9 smoked). Three of them are literals because **both**
docs draw them identically — that is deliberate, not an escaped hardcode.
Two differ per theme and are tokens. The neutral one is `--chrome-text`,
which already held each doc's value exactly.

Tags do not borrow the discipline tokens any more. `recovery`, `test` and
`eased` used to read `--swim`, `--bike` and `--run`; they are states, not
sports, and the match was coincidence waiting to mislead someone.

---

## 3. Typography

**Typeface:** [Figtree](https://fonts.google.com/specimen/Figtree) (self-hosted variable woff2 in `src/assets/`, weights 300-900; no CDN so offline typography holds).
Weights loaded: **400 / 500 / 600 / 700 / 800**.
**Fallback stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.

**Voice of the type:** headings are **800 (extra-bold)** with **tight negative tracking**
(−0.2px to −0.6px, bigger text = tighter). Labels are uppercase, **700**, with *positive*
tracking. Body is 400–600. Antialiased; no synthetic weights (`font-synthesis: none`).

### Type scale (as used in-app)
| Use | Size | Weight | Tracking |
|---|---|---|---|
| Screen title / "Building your plan" | 23–24px | 800 | −0.6px |
| Big number (race countdown, hero) | 21px | 800 | −0.5px |
| Metric value (trends) | 19px | 800 | −0.4px |
| Card heading | 17px | 800 | −0.4px |
| Week / row title | 14.5–15px | 800 | −0.2px |
| Button | 15px | 800 | −0.2px |
| Body / lead | 13px | 400–600 | normal |
| Section label | 12px | 700 | **+1.1px**, UPPERCASE |
| Tag / phase badge | 10–10.5px | 800 | **+0.6px**, UPPERCASE |

---

## 4. Shape, elevation & spacing

**Corner radii** (rounded, generous):
| Element | Radius |
|---|---|
| Buttons / pills / chips | `40px` (full pill) |
| Cards | `--radius` = `20px` |
| Bottom sheet (top corners) | `24px` |
| Topbar (bottom corners) | `26px` |
| Discipline tiles | `14–18px` |
| Inputs | `13px` |
| Tags | `20px` |
| Completion check | `50%` (circle) |

**Elevation / shadow**
- Card shadow: `--shadow` = `0 16px 44px rgba(0,0,0,.5)` — deep, soft, no border glow.
- Tile shadow: `0 10px 24px rgba(0,0,0,.35)`.
- Inset hairline on coloured tiles: `inset 0 0 0 1px rgba(255,255,255,.12)`.

**Layout / spacing**
- Content max-width **760px**, centred; horizontal padding **16px**; bottom padding **110px** (clears the nav bar).
- Card padding **18px**; row vertical padding **12px**.
- The header uses a royal-blue radial glow over navy:
  `radial-gradient(135% 130% at 50% -25%, rgba(74,116,220,.42) 0%, rgba(74,116,220,0) 56%)` layered on `linear-gradient(180deg, #151c2b 0%, #0e1217 100%)`.

---

## 5. Logo & app mark

The mark is a **triangle with a centred dot** — a minimalist "tri" (three sides =
swim/bike/run). Defined as the `logo` icon in `ICON_PATHS` ([`../src/components/Icon.jsx`](../src/components/Icon.jsx)):

```
triangle: M12 3.2 20.4 18.6 3.6 18.6 Z   (monoline, stroke ~2)
dot:      circle cx=12 cy=13.4 r=1.6      (filled)
```

- **On dark:** white (`--ink` / `#ffffff`) stroke + dot on `--bg` navy.
- Always pair with the wordmark **"Try"** in Figtree 800.
- Clear space ≥ the height of the dot on all sides. Don't recolour, skew, or add effects.

---

## 6. Iconography

A custom **monoline** SVG set, drawn on a **24×24 viewBox**, `fill: none`,
`stroke: currentColor`, **round caps & joins**, default **stroke-width 2**.

- The set is drawn for a **uniform stroke-width of 2** — no per-icon weight overrides.
- Icons inherit text colour via `currentColor` — white on coloured tiles, `--muted` in nav, etc.
- Full set (names, in [`Icon.jsx`](../src/components/Icon.jsx)): `logo, swim, bike, run,
  brick, rest, strength, today, calendar, plan, progress, you, bolt, flag, flame,
  download, trend, watch, transition, stopwatch, route, heartrate, pace, trophy, settings`.
- No emoji in the UI — every glyph is a monoline icon.

### The glass emboss

The doc's own thesis: *"The Try set, unchanged in geometry and re-lit for
glass: cast shadow down-right, highlight up-left."* **No path data moves.**
The same string is drawn three times, an offset dark copy and an offset light
copy beneath the real one:

```
<g transform="translate(.55 .75)"   style="color:rgba(0,0,0,.55)"       opacity=".9">…</g>
<g transform="translate(-.35 -.45)" style="color:rgba(255,255,255,.55)" opacity=".8">…</g>
<g>…</g>
```

It recolours by setting `color` on the wrapper, which works because every
path paints with `currentColor` — including the filled discipline marks,
whose inner group inherits it. That relies on `currentcolor` resolving per
element rather than computing once on the `<svg>`; it does, and the harness
checks it by reading the three layers' rendered paints rather than assuming.

**The numbers are theme-invariant** — identical across all 31 embossed icons
in the moulded doc and the smoked set. The light source does not change when
the material does, so this needs no token. It is the only part of the design
system where that is true.

Two rules are **ours, not the doc's**, and both are pinned by tests:

- **The emboss starts at 26px.** Below that the bevel is not a bevel: the
  offsets are fractions of a 24-unit viewBox, so at 18px — the app's
  commonest icon size — the shadow lands 0.41 CSS pixels away and reads as a
  smudge. The doc lights icons down to 21px. Deliberate departure, Jon's call
  on those measurements.
- **The brand mark is never lit**, which *is* the doc's choice: the tri-mark
  is the single un-embossed icon in its sheet of 32. The app draws the logo at
  26, 34 and 64, so the size rule alone would have lit it.

A consequence worth knowing: **the workout-row tiles draw their icon at 22px,
so they stay flat.** The surfaces that do get lit are the detail-sheet hero,
the calendar's discipline tiles, the wellness hero and the empty states.
Raising the row icon to 26 would bring the rows in; that is a layout decision,
not a styling one.

See `icons.html` — every icon, every size, both backdrops, both themes.

---

## 7. Core components

**Buttons** — full-width pill, `40px` radius, weight 800, 15px.
- **Primary:** white (`--accent`) bg, `--accent-ink` text. One per view. Hover `brightness(.94)`, active nudges down 1px.
- **Ghost:** `--chip` bg, `--ink` text.
- **Done/secondary:** `--chip` bg with inset `1.5px --line` ring.
- Small variant: auto width, `9px 16px`, 13px.

**Cards** — `--card` bg, `1px --line` border, `--radius`, `--shadow`, 18px padding.

**Tablist (segmented view switcher)** — the `.segbar` pill trough with the
chosen segment as the only extruded thing in it; proper `role="tablist"` /
`role="tab"` / `role="tabpanel"` wiring, inactive panels unmounted. The
what-if sheet's mode tabs (`.wi-tabs`) are still a button row; the Progress
view's Overview · Swim · Bike · Run tabs ride `.segbar`.
Progress rules: a discipline whose plan gate fails (solo race, excluded
discipline) gets no tab rather than a disabled one; a solo plan opens
directly on its discipline's tab; tracker mode renders the Overview flow in
one column with no tab bar at all. A discipline-linked block whose tab does
not exist falls back to its pre-tab Overview position instead of
disappearing — losing a tab must never lose the content. One carve-out, by
Jon's call (2026-08-04): durability cards are tab-only. Tracker's tabless
page, a solo plan's absent disciplines and an excluded discipline show no
durability card; the stored reads persist and the card returns with the
tab. Run volume and the power curve keep the fallback.

**Discipline tile (the signature element)** — rounded square, discipline **gradient**,
white icon, inset hairline. Sizes in-app: 46px (rows), 54px (sheet hero), 60px (building screen).

**Tags / badges** — tiny uppercase pills (10px/800, +0.6px tracking), translucent tint + saturated text (see §2).

**Progress bars** — `--track` background, fill is `--accent` (white) or a phase/discipline colour; `4px` radius, `6–7px` tall.

**Bottom nav** — 4 training tabs (Today / Calendar / Plan / Progress); active = `--accent`
(white), inactive = `--muted`; 11px/700 labels. Profile & settings live behind the
**avatar**, not the nav.

**Settings sections (phase 4)** — stable cards in a fixed order, each with a deep-link
id (`settings-profile`, `settings-plan`, `settings-assumptions`, `settings-connections`):
Profile (fitness surface only), Your plan (every plan-lifecycle action in one card:
edit race, .ics export, maintenance switch, end-to-tracker, start over), What Try knows
(the Assumption Center: per-discipline anchor rows, real with provenance and date,
estimated with the `~` and its never-judges role, missing named as missing and never a
zero), Connections, Support, Account, then the lone destructive reset. `openSettings(section)`
in App opens Settings scrolled to a card; in-copy mentions of Settings should become
links via a nullable `onOpenSettings` callback where cheap.

**Chevroned-question fold** — a muted bold question ending in a chevron
(`▸`/`▾`), `role="button"` + `aria-expanded`, folding out derived reasons.
One consumer now: the detail sheet's "Why not harder?" (`.wnh-toggle`, phase
6). The readiness card's folds are both gone — "Why?" was replaced by the
always-visible SignalBars, and "Details" came out on 2026-08-04. The folded content only
ever states what its selector can prove; a fold that cannot prove anything
does not render its toggle.

**Today briefing (phase 5)** — context under the date line (`.tb-context`: muted
phase/week line + bold priority line, two short lines max), a tiny uppercase
`Main session` caption (`.tb-main`, key-tag blue `#9ab8ff`) above the primary row
on multi-session days only, muted prep-cue lines under their row (`.tb-cue`,
indented past the discipline tile), and a hairline-topped dependency line
(`.tb-dep`) closing the list. Decorations live in TodayView around untouched
WorkoutRows; the row component stays shared and undecorated.

**Avatar (profile entry)** — 34px circle, top-left of the topbar; the Clerk photo with a
`1.5px rgba(255,255,255,.18)` hairline, or a gradient fallback
(`135° #4a74dc → #6d54c8`) with the athlete's initial in white 800.

**Readiness card** — a pane with a 3px band rail down its left edge, the score
pressed into it as a disc with the band's colour glowing out, the signals that
produced the score as bars against their own baselines, today's coaching, and
three pressed load tiles (Fitness / Fatigue / Form).

It carries **no charts**: they live in Progress (Jon, 2026-08-04). The Form
tile takes its zone colour only when the zone means something — the grey zone
keeps the plain ink rather than paying legibility to signal nothing.

It also stopped being a material island. It shipped with private copies of
`--pane`, `--press` and `--well`, which meant it wore moulded material inside
the smoked theme until 2026-08-04. **A component that redefines the material
tokens cannot follow the theme** — if a surface needs to look different, give
it its own class, never its own `--pane`.

**Charts** — uniform-scaled SVG only (`viewBox` + `width:100%; height:auto`); **never**
`preserveAspectRatio="none"` with text (it distorts). Zone strata behind the data, the
active zone labelled in-band (7px/800 uppercase, right-aligned, the zone's colour).
Numbers + legend merge into a **colour-keyed stat strip** above the chart: each value
(16px/800) wears its line's colour, with a `--muted` 11px label. Bar charts with text
labels are HTML/CSS (`.vchart`), not SVG.

**Auth & account surfaces** — the sign-in gate is a full-viewport centred card on the
header's radial glow (`.authgate`). Account/integration rows use `.authbox` (inset
`--chip` panel, 14px radius); status feedback uses `.authstatus` tints — ok:
`#6ee7b7` on `rgba(52,211,153,.12)`, bad: `#fca5a5` on `rgba(248,113,113,.12)`.

---

## 7a. Two materials, one vocabulary

**As of 2026-08-03 the app has two themes**: moulded glass (the light-lit
original) and smoked glass (the night build, `Smoked Glass Kit.dc.html`).
**Smoked is the default**; the athlete picks in Settings → Appearance, the
choice is device-local, and `index.html` applies it pre-paint.

The mechanics: the bare `:root` in `styles.css` carries the MOULDED bindings;
`:root[data-theme="smoked"]` rebinds the same tokens. A new surface therefore
has exactly two legal forms — **use only tokens, or style both themes
explicitly**. A literal colour on a new surface is a bug in whichever theme
you were not looking at. Every future component PR styles two materials, and
every contrast fix happens twice; that cost was accepted knowingly.

What smoked changes, in one breath: on a near-black page a drop shadow is
invisible, so **edge light carries the form** — the pane drops to a 5.5%
tint with a 14% top rim, pressed surfaces darken past the page to a real
black floor, discipline tiles run ~30% translucent fills (dots and strokes
stay solid — rule 4 holds at night), ticks go mint, and **one action per
screen is allowed to glow** (`--btn-primary-*`). Blur runs 28px/130% against
moulded's 24px/160% — same layer counts, higher per-layer cost; the
real-device frame check is still owed, now on the worse of the two.

Harnesses honour `?theme=` and carry a flip chip; the flip is deliberately
not persisted.

## 7b. Moulded glass, the house material

**As of 2026-08-02 glass is the house style, not an exception.** It arrived one
card at a time (the readiness card, 1 August) and went app-wide the next day
from the design project's Moulded Glass Kit. If you are adding a surface, this
section is the material; section 4 above still governs spacing and shape.

The tokens live in `:root` under the kit's own names, so the design docs and
this app share one vocabulary: `--pane`, `--pane-blur`, `--pane-border`,
`--pane-shadow`, `--pane-radius`, `--press`, `--press-sm`, `--raise`,
`--raise-sm`, `--well`, `--lift`. The palette is unchanged — the kit's
`--run`, `--bike`, `--swim` and `--ink` were already identical to ours.

### The four rules

1. **One light source.** Highlights top-left, shadows bottom-right.
2. **Blur once.** Only a pane gets `backdrop-filter`. Nested blurs cost frames
   and flatten the depth. **Cards nest in this app**, so `.card .card` drops
   the blur and keeps the tint — verified by construction, not assumed.
3. **In means inert, out means actionable.** Tracks, wells and disabled
   controls press in; buttons and tiles swell out. `.btn:disabled` presses
   rather than dimming for exactly this reason.

   **One place uses depth for ORDER rather than state**: the season's blocks
   card, where the block you are in is raised and wears its phase colour, the
   next one is raised and plain, and everything beyond presses in. A spent
   block presses in too but reads back at half opacity — otherwise the block
   you have just left looks exactly like one still ahead of you, and "nearer is
   more raised" stops being true in the one direction that matters.
4. **Status keeps its saturation.** Discipline colours, readiness green and
   warning amber stay opaque, so state never reads as haze.

### Segmented controls: one idiom, two implementations

The house pattern is a **pill trough with the chosen segment as the only
extruded thing in it** — rule 3 doing the work colour alone cannot. `.segbar`
(the calendar's range) is the general form; `.nav .tabs` is the fixed-bar
variant, differing only in shape.

The Progress tabs joined `.segbar` with the Progress component PR, so the
idiom has no stragglers left.

New segmented controls take `.segbar`. Use real `<button>`s with
`role="tab"` and `aria-selected`, so activation is the platform's and the
selected one is announced.

### Forms

Everything a finger changes presses inward: inputs and selects are wells,
the day picker's unselected days press in and chosen days wear the raised
pill (`--pill-on-*`, so the theme decides white or tinted blue). **The pill
is right at nine characters wide and wrong at card width** — multi-line
`.choice` cards LIFT when chosen (`--lift` + `--raise-sm` + accent border)
instead of whitening, or the theme picker would be a glare. Text-field focus
is a quiet themed ring on the well, not the white focus-visible ring — text
fields focus on every tap, and a ring that fires constantly means nothing.
The switch's knob is a theme-invariant solid: smoked's `--pill-on-bg` is a
16% tint, invisible as a knob (checked, then rejected).

### Workout rows

The completion circle is rule 3 made personal: a hollow pressed well until
the session is done, then a raised tick (`--tick-*`, white in moulded, mint
in smoked). A KEY session's tile glows faintly in its own discipline colour
**in moulded only** — smoked reserves glow for the primary action, the first
deliberate per-theme behaviour split. Race days and tune-ups never glow:
events, not emphases. **Deviation from the smoked doc: tiles carry no
`backdrop-filter`** — seven rows would add seven blur layers to screens that
already carry the app's worst counts, and the 30% fills read without it.

### Charts

A chart is read, not tapped, so it presses INTO its card: `.chart-well` is
the shared recess (tokens — `--well` + `--press-sm` — so both materials bind
it, and no backdrop-filter, so the blur count does not move). The spider, the
power curve and the durability shapes wear it; any future chart-in-a-card
takes the same class.

**Bars for buckets, lines for series.** A durability bucket is a STRETCH of a
session ("the work between 1 000 and 2 000 kJ"), so it is drawn as a bar: a
line between bucket centres would draw a continuity through ground that was
never sampled that way. A pace bar is inverted, longer meaning faster, or a
bar growing as the athlete slows reads as improvement.

**A small change needs a number, not a cropped axis.** The durability bars
keep a zero base and print the percentage above them, because a 12% fade
across a 70px plot is eight pixels. Zooming the axis would make it legible by
exaggerating it, which is the cliff `PowerCurveChart` already warns about in
its own comment. Where the eye cannot resolve the difference, the label
carries the precision and the bar carries the scale.

**The athlete's line is white.** On any chart, "you" is the single white
line — the docs' legends all draw the you-swatch white — and the discipline
colour moves into the fill tint under it (spider: radial white-to-discipline
fill; power curve: discipline-tinted area closing to the zero axis).
References and comparisons stay dashed or dimmed, never white. White is
deliberately theme-invariant: both materials are dark fields. The bike doc's
blue tint was the kit accent leaking, not a palette change — bike tints stay
`var(--bike)`.

Solid points are measured, hollow (transparent-filled) are projections or
stale — the convention predates the glass and survives it.

### The detail sheet

**It is chrome, not a card** — it floats over content and it is the app's one
long-form reading surface. So it takes `.topbar`'s construction rather than a
bare `--pane`: the pane over `--chrome-base`, blurred, and the scrim beneath
it deepened to `.82` so what shows through the glass is predictable instead
of a function of whichever screen was open.

Going glass costs contrast, and the fix is the one chrome already taught:
**brighten the text, do not darken the surface.** One scoped line inside
`.sheet` rebinds `--muted` to `--chrome-text` and `--faint` one rung up to
`--label`, so every secondary line in the sheet lifts in both themes and
nothing outside it moves. Measured against the worst backdrop the app can
produce (a white card behind the scrim):

| | bare pane, old scrim | shipped |
|---|---|---|
| body ink | 4.5 moulded / 4.1 smoked | 10.4 / 9.5 |
| secondary text | **1.6 / 1.9** | 8.7 / 6.8 |
| tertiary text | **1.1 / 1.1** | 4.4 / 4.4 (5.2 on a normal backdrop) |

Audit every `var(--muted)` and `var(--faint)` consumer that can render inside
the sheet when changing this. Most are plain secondary text and want the
lift; `.conf-badge` does not, and the check is its own stated invariant —
low must stay the quietest — which holds because low reads `--faint`, a rung
below the rest either way.

Inside it, everything is an idiom that already existed: the grab handle is a
groove, the hero tile is the workout row's tile one size up (without the key
glow, which exists to pick one session out of seven), stat tiles press in,
the interval profile takes `.chart-well`, and the why-card lifts.

### Chrome is a special case

`.topbar` and `.nav` float over content the athlete chooses by scrolling, so
they are the only surfaces whose backdrop can be anything at all — including a
white card. `--pane` alone is not enough there: at 14%/5% white the header's
own text disappeared over a white card. Both take `--chrome-base` under the
moulded highlight, and their secondary text is `#dbe3ee` at full opacity
rather than `--muted`, which fell to about 3.5:1 in that same case.

If you add a fixed or sticky surface, check it against `nav.html` before
trusting it. Contrast on glass is a property of the pair, not of the colour.

### Two things that break it

**The lit field is load-bearing.** `body::before` carries four blurred orbs.
Delete it and every pane goes flat grey, because a blur with nothing lit behind
it has nothing to refract. The kit says so outright and the readiness card
proved it before this went app-wide.

**An opaque fill over a `backdrop-filter` is work nobody sees.** The four
add-a-session cards are `.card` with an inline discipline gradient, so `--pane`
never showed and the blur underneath was invisible — four wasted layers on one
tab. If a card overrides its background with something opaque, it drops the
blur. Rule 4 keeps the saturation; only the blur goes.

**Do not paint anything with `var(--card)` to fake a hole.** Two charts used to
fill "hollow" markers with the card colour, which only worked while the card
was opaque and matched. On a pane it became a solid slab. Hollow means
`transparent`.

### What the blur actually costs, measured

Counted in the DOM rather than estimated from the source, because the source
count badly overstates it — ~65 `card` occurrences in the tree, but far fewer
render at once, and the dense grids are not cards at all.

This table has been wrong twice, both times for the same reason, and both are
worth keeping because the reason keeps coming back.

**It was two short on every row.** Counted in the dev harnesses, and a harness
mounts one view without the app shell, so `.topbar` and `.nav` were missing
everywhere. **Then the Calendar row was one too high on top of that**, because
the calendar harness's own debug panel was a `.card`, so the instrument counted
itself. (It no longer is one.) Count in the DOM, name every element, and check
that each one is part of the app.

| Screen | In its harness | On the real screen |
|---|---|---|
| Today | 3 | 5 |
| Calendar / Month, a day selected | 2 (its 58 day cells are **not** cards, so they do not blur) | 4 |
| Calendar / Week | 7 (one card per day, and nothing else) | 9 |
| Calendar / Season | 3 (ramp, blocks, milestones) | 5 |
| Progress, Bike tab | 8 | 10 |
| Progress, Overview | 13 | 15 (the worst in the app) |
| *any screen, with a detail sheet open* | *+1* | *+1* |

The shell adds two everywhere: the sticky header and the fixed tab bar. The
tab bar has blurred since long before the glass; the header joined it with the
Navigation component.

The sheet is a row modifier rather than a row of its own, because it opens
over whatever was already there. It costs exactly one layer: counted in the
DOM with a sheet open, the only blurring elements are the scrim, whose
`blur(2px)` predates the glass, and the sheet itself.

Calendar says **"a day selected"** because the day card and the recorded list
only exist then; a number without its state is the same mistake in a third
costume. It fell from 6 to 2 when the four add-a-session cards stopped
blurring — see the rule below.

Fifteen concurrent `backdrop-filter` layers is an ordinary number for a glass
UI, not the ~65 the source count implied. **Frame timing is still unmeasured**:
`requestAnimationFrame` is throttled in a hidden browser pane, so any number
from the dev harness would be fiction. Scroll smoothness needs a real device,
and the Progress overview is the screen to test.

## 8. Motion

- **Micro-interactions:** `.12–.15s` transitions on hover/press; primary button presses down `translateY(1px)`.
- **Sheets:** slide up `.25s ease`.
- **Building screen:** discipline tiles bounce in a staggered wave (`build-bounce 1.15s`, delays .16s/.32s), then pop; status text fades in per step; progress bar eases (`cubic-bezier(.4,0,.2,1)`).
- **Always** gate decorative motion behind `@media (prefers-reduced-motion: reduce)`.

---

## 9. Asset recipes

Quick specs for common assets — all on the navy base.

**App / PWA icon**
- Background: `#0e1217` (or a subtle navy radial: `#151c2b` centre → `#0e1217` edge).
- Mark: white triangle-and-dot logo, centred, ~60% of the canvas.
- Maskable: keep the mark within the safe centre 80%.

**Social / share card (e.g. 1200×630)**
- Navy bg with the header's royal-blue radial glow top-centre.
- White "Try" wordmark + logo; optional row of the three discipline gradient tiles.
- One line of `--muted` supporting copy. Keep it sparse.

**Screenshots**
- Use the real app on the dark theme — don't mock a light version.
- Frame at the 760px content width; let the deep card shadows read.

**Do**
- Start from `#0e1217`; use white as the single accent; use discipline gradients for energy.

**Don't**
- ✗ Light backgrounds · ✗ recolouring discipline/phase hues · ✗ multiple competing CTAs ·
  ✗ thin hard shadows or sharp corners · ✗ swapping the typeface or using thin weights for headings.

---

*Tokens authoritative in [`../src/styles.css`](../src/styles.css) `:root`,
[`../src/lib/disciplines.js`](../src/lib/disciplines.js) / [`../src/lib/domain.js`](../src/lib/domain.js)
(`DISCIPLINES`, `PHASE_INFO`, `ZONES`), and [`../src/lib/wellness.js`](../src/lib/wellness.js)
(`FORM_ZONES`, readiness bands). Last updated 3 July 2026.*
