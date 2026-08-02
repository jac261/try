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
The daily readiness score (0–100) reuses the traffic-light hues — the ring, the
card's left border (`rd-green/amber/red`), and the readiness-trend line all wear
the current band's colour.

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
| `key` | `--blue-soft` | `#9ab8ff` |
| `recovery` | `rgba(56,189,248,.15)` | `--swim` |
| `moved` | `rgba(192,132,252,.16)` | `--brick` |
| `test` | `rgba(251,191,36,.18)` | `--bike` |
| `second` | `rgba(148,163,184,.2)` | `#cbd5e1` |

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

---

## 7. Core components

**Buttons** — full-width pill, `40px` radius, weight 800, 15px.
- **Primary:** white (`--accent`) bg, `--accent-ink` text. One per view. Hover `brightness(.94)`, active nudges down 1px.
- **Ghost:** `--chip` bg, `--ink` text.
- **Done/secondary:** `--chip` bg with inset `1.5px --line` ring.
- Small variant: auto width, `9px 16px`, 13px.

**Cards** — `--card` bg, `1px --line` border, `--radius`, `--shadow`, 18px padding.

**Tablist (segmented view switcher)** — a row of small buttons, exactly one
`primary` (the selected tab), the rest `ghost`; proper `role="tablist"` /
`role="tab"` / `role="tabpanel"` wiring, inactive panels unmounted. Two
instances share the idiom: the what-if sheet's mode tabs (`.wi-tabs`) and the
Progress view's Overview · Swim · Bike · Run tabs (`.prog-tabs`, phase 3).
Progress rules: a discipline whose plan gate fails (solo race, excluded
discipline) gets no tab rather than a disabled one; a solo plan opens
directly on its discipline's tab; tracker mode renders the Overview flow in
one column with no tab bar at all. A discipline-linked block whose tab does
not exist falls back to its pre-tab Overview position instead of
disappearing — losing a tab must never lose the content.

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
Two consumers: the readiness card's "Why?" (`.rd-why-toggle`) and the detail
sheet's "Why not harder?" (`.wnh-toggle`, phase 6). The folded content only
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

**Readiness card** — a `--card` with a 3px left border in the current band colour
(`rd-green/amber/red`), the score ring (band-coloured stroke on `--track`), and driver
chips (`--chip` pills; "bad" drivers tinted `rgba(251,146,60,.14)` with `#f6b27a` text).

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
4. **Status keeps its saturation.** Discipline colours, readiness green and
   warning amber stay opaque, so state never reads as haze.

### Segmented controls: one idiom, three implementations

The house pattern is a **pill trough with the chosen segment as the only
extruded thing in it** — rule 3 doing the work colour alone cannot. `.segbar`
(the calendar's range) is the general form; `.nav .tabs` is the fixed-bar
variant, differing only in shape.

**`.prog-tabs` is still a row of `.btn`s from before the glass.** That is a
real inconsistency and it is recorded here rather than fixed, because
rewriting a tab bar in a PR that does not otherwise touch that screen is how a
calendar change breaks Progress. It belongs to the Progress component.

New segmented controls take `.segbar`. Use real `<button>`s with
`role="tab"` and `aria-selected`, so activation is the platform's and the
selected one is announced.

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
| Progress, Bike tab | 8 | 10 |
| Progress, Overview | 13 | 15 (the worst in the app) |

The shell adds two everywhere: the sticky header and the fixed tab bar. The
tab bar has blurred since long before the glass; the header joined it with the
Navigation component.

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
