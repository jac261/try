# Try — Visual Style Guide

The single source of truth for Try's look & feel. Use it when creating any visual
asset — app icons, social/share cards, screenshots, marketing images, or new UI.

> **Living reference:** open [`style-guide.html`](style-guide.html) (or
> [jac261.github.io/try/docs/style-guide.html](https://jac261.github.io/try/docs/style-guide.html))
> for rendered swatches, gradients, type and components you can eyedrop directly.
> Every token below is defined as a CSS variable in [`../styles.css`](../styles.css)
> (`:root`) and the discipline/phase data in [`../js/data.js`](../js/data.js) — those
> files are authoritative; keep this guide in sync if they change.

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
| Danger / error / Peak | `--danger` `#f87171` | Destructive actions, Peak phase |
| Feel: "Easy" | run green `#34d399` | post-session feedback |
| Feel: "Just right" | blue `#5b8cff` (text `#9ab8ff`) | |
| Feel: "Hard" | bike amber `#fb923c` | |

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

**Typeface:** [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) (Google Fonts).
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
swim/bike/run). Defined as the `logo` icon in `ICON_PATHS` ([`../js/app.jsx`](../js/app.jsx)):

```
triangle: M12 3.2 20.4 18.6 3.6 18.6 Z   (monoline, stroke ~2)
dot:      circle cx=12 cy=13.4 r=1.6      (filled)
```

- **On dark:** white (`--ink` / `#ffffff`) stroke + dot on `--bg` navy.
- Always pair with the wordmark **"Try"** in Plus Jakarta Sans 800.
- Clear space ≥ the height of the dot on all sides. Don't recolour, skew, or add effects.

---

## 6. Iconography

A custom **monoline** SVG set, drawn on a **24×24 viewBox**, `fill: none`,
`stroke: currentColor`, **round caps & joins**, default **stroke-width 2**.

- **Discipline icons** (swim/bike/run) are heavier, filled-silhouette style — bold
  stroke widths: **swim 2.7, bike 2.5, run 3** (`ICON_BOLD`), with filled heads.
- Icons inherit text colour via `currentColor` — white on coloured tiles, `--muted` in nav, etc.
- Full set (names): `logo, swim, bike, run, brick, rest, strength, today, calendar, plan, progress, you, bolt, flag, flame, download, trend`.
- A few content emoji remain by design (🔥 streak, ⚡ banner, 🏁/🛌 empty states) — don't add more.

---

## 7. Core components

**Buttons** — full-width pill, `40px` radius, weight 800, 15px.
- **Primary:** white (`--accent`) bg, `--accent-ink` text. One per view. Hover `brightness(.94)`, active nudges down 1px.
- **Ghost:** `--chip` bg, `--ink` text.
- **Done/secondary:** `--chip` bg with inset `1.5px --line` ring.
- Small variant: auto width, `9px 16px`, 13px.

**Cards** — `--card` bg, `1px --line` border, `--radius`, `--shadow`, 18px padding.

**Discipline tile (the signature element)** — rounded square, discipline **gradient**,
white icon, inset hairline. Sizes in-app: 46px (rows), 54px (sheet hero), 60px (building screen).

**Tags / badges** — tiny uppercase pills (10px/800, +0.6px tracking), translucent tint + saturated text (see §2).

**Progress bars** — `--track` background, fill is `--accent` (white) or a phase/discipline colour; `4px` radius, `6–7px` tall.

**Bottom nav** — 5 monoline icons; active = `--accent` (white), inactive = `--muted`; 11px/700 labels.

---

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

*Tokens authoritative in [`../styles.css`](../styles.css) `:root` and [`../js/data.js`](../js/data.js)
(`DISCIPLINES`, `PHASE_INFO`, `ZONES`). Last updated 28 June 2026.*
