# DESIGN.md — Automation SNS Dashboard

> Design system for the SNS automation COO dashboard.
> Hybrid of Notion + Cursor design languages, tuned for a functional, warm, scan-friendly admin interface.

---

## 1. Visual Theme & Atmosphere

**Character:** Warm administrative. The interface feels like a well-organized operations room — not a consumer app, not a cold SaaS tool. Everything is easy to scan at a glance and communicates status without noise.

**Aesthetic references:**
- Notion: warmth, generous whitespace, typographic hierarchy, trust
- Cursor: texture, depth through subtle cream surfaces, orange/crimson energy for active states

**Mood words:** Focused. Organized. Warm. Reliable. Alive-but-calm.

**Surface layering (back to front):**
1. Page background — warm off-white `#f6f5f4`
2. Sidebar — cream `#f2f1ed`
3. Cards — white `#ffffff`
4. Elevated overlays / modals — white + atmospheric shadow

The warm-cream sidebar recedes slightly from the white cards, creating a gentle spatial hierarchy without hard contrast.

---

## 2. Color Palette & Roles

### Foundation

| Token | Hex / Value | Role |
|---|---|---|
| `--bg-page` | `#f6f5f4` | Page / canvas background |
| `--bg-sidebar` | `#f2f1ed` | Sidebar, left rail |
| `--bg-card` | `#ffffff` | Cards, panels, main content areas |
| `--bg-surface` | `#ebeae5` | Secondary button fill, input background |
| `--bg-card-nested` | `#e6e5e0` | Nested cards, table row hover |
| `--bg-dark-surface` | `#31302e` | Dark mode surfaces, inverted badges |
| `--bg-badge-info` | `#f2f9ff` | Informational badge backgrounds |

### Text

| Token | Hex / Value | Role |
|---|---|---|
| `--text-primary` | `rgba(0,0,0,0.95)` | Headings, body, primary labels |
| `--text-secondary` | `#615d59` | Supporting text, metadata |
| `--text-muted` | `#a39e98` | Timestamps, placeholders, disabled |
| `--text-dark` | `#26251e` | On dark surfaces |

### Borders

| Token | Hex / Value | Role |
|---|---|---|
| `--border-default` | `rgba(0,0,0,0.1)` | Cards, inputs, dividers |
| `--border-cursor` | `rgba(38,37,30,0.1)` | Cursor-flavored borders (slightly warm) |

### Interactive / Brand

| Token | Hex / Value | Role |
|---|---|---|
| `--accent-blue` | `#0075de` | Primary CTA, links, active nav items |
| `--accent-crimson` | `#cf2d56` | Active/hover state, destructive, Cursor energy |
| `--accent-orange` | `#f54e00` | Cursor accent, urgent badges, warnings |

### Pipeline Status (from Cursor AI timeline palette)

| Token | Hex / Value | Pipeline Step |
|---|---|---|
| `--status-research` | `#dfa88f` | Researching / Ideating (warm peach) |
| `--status-generate` | `#9fc9a2` | Generating content (sage green) |
| `--status-review` | `#9fbbe0` | Reviewing / Pending (soft blue) |
| `--status-publish` | `#c0a8dd` | Publishing / Scheduled (lavender) |
| `--status-error` | `#cf2d56` | Error / Failed |
| `--status-idle` | `#a39e98` | Idle / Disabled |

**Status color usage:** Apply as left-border accent (`border-left: 3px solid <color>`) on pipeline step cards, or as dot indicators (`8px circle`) in tables. Never use as full card backgrounds — only as accent marks or badges.

---

## 3. Typography Rules

### Font Stack

```css
--font-sans: 'Inter', 'NotionInter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'Berkeley Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
--font-serif: 'Georgia', 'Times New Roman', serif; /* Jjannon fallback — used sparingly */
```

### Scale

| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|
| Display | 48px | 700 | 1.1 | -1.5px | Hero headings, empty states |
| H1 | 32px | 700 | 1.2 | -1px | Page titles |
| H2 | 24px | 600 | 1.3 | -0.5px | Section headings, card titles |
| H3 | 18px | 600 | 1.4 | -0.25px | Sub-section, widget headers |
| H4 | 15px | 600 | 1.5 | 0 | Table headers, label headings |
| Body | 14px | 400 | 1.6 | 0 | Default body text |
| Body Sm | 13px | 400 | 1.5 | 0 | Secondary info, captions |
| Caption | 11px | 500 | 1.4 | 0.3px | Badges, timestamps, tags |
| Mono | 13px | 400 | 1.5 | 0 | Code, IDs, log output |

### Rules

- Reserve weight 700 for headings (H1, H2, Display). Body copy and UI labels max out at 600.
- Apply negative letter-spacing only at 18px and above — compress large type, normalize small type.
- Muted text (`--text-muted`) is always 11–13px. Never mute large type.
- Monospace font for: pipeline IDs, cron expressions, JSON snippets, log lines, API responses.
- Use serif (`Georgia`) only for long-form content previews (note article excerpts), never for UI chrome.

---

## 4. Component Stylings

### Cards

```css
.card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow:
    0 1px 2px rgba(0,0,0,0.02),
    0 2px 4px rgba(0,0,0,0.02),
    0 4px 8px rgba(0,0,0,0.03),
    0 8px 16px rgba(0,0,0,0.02),
    0 16px 32px rgba(0,0,0,0.01);
}

.card--elevated {
  box-shadow: rgba(0,0,0,0.14) 0px 28px 70px; /* Cursor atmospheric */
}

.card--status {
  border-left: 3px solid var(--status-color); /* Use pipeline status color */
}
```

### Pipeline Step Indicator

```css
.pipeline-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.pipeline-step__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-color);
  flex-shrink: 0;
}

/* Step variants */
.step--research  { --status-color: #dfa88f; }
.step--generate  { --status-color: #9fc9a2; }
.step--review    { --status-color: #9fbbe0; }
.step--publish   { --status-color: #c0a8dd; }
.step--error     { --status-color: #cf2d56; }
.step--idle      { --status-color: #a39e98; }
```

### Buttons

```css
/* Primary — Notion blue */
.btn-primary {
  background: #0075de;
  color: #ffffff;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: background 120ms ease;
}
.btn-primary:hover { background: #005fbb; }

/* Secondary — Cursor warm surface */
.btn-secondary {
  background: #ebeae5;
  color: rgba(0,0,0,0.95);
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
  cursor: pointer;
  transition: color 120ms ease;
}
.btn-secondary:hover { color: #cf2d56; }

/* Destructive */
.btn-danger {
  background: transparent;
  color: #cf2d56;
  border: 1px solid rgba(207,45,86,0.3);
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}
.btn-danger:hover { background: rgba(207,45,86,0.06); }
```

### Navigation / Sidebar

```css
.sidebar {
  background: #f2f1ed;
  width: 240px;
  border-right: 1px solid rgba(0,0,0,0.1);
  padding: 16px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #615d59;
  border-radius: 8px;
  margin: 1px 8px;
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease;
}

.nav-item:hover {
  background: rgba(0,0,0,0.05);
  color: rgba(0,0,0,0.95);
}

.nav-item--active {
  background: rgba(0,117,222,0.08);
  color: #0075de;
  font-weight: 600;
}
```

### Badges / Tags

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.badge--info    { background: #f2f9ff; color: #0075de; }
.badge--success { background: rgba(159,201,162,0.2); color: #3a7d3e; }
.badge--warn    { background: rgba(245,78,0,0.1); color: #c74000; }
.badge--error   { background: rgba(207,45,86,0.1); color: #cf2d56; }
.badge--neutral { background: #ebeae5; color: #615d59; }
```

### Inputs

```css
.input {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  font-family: var(--font-sans);
  color: rgba(0,0,0,0.95);
  width: 100%;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.input:focus {
  outline: none;
  border-color: #0075de;
  box-shadow: 0 0 0 3px rgba(0,117,222,0.12);
}

.input::placeholder { color: #a39e98; }
```

### Tables

```css
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table th {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #a39e98;
  padding: 10px 16px;
  text-align: left;
  border-bottom: 1px solid rgba(0,0,0,0.08);
}

.table td {
  padding: 12px 16px;
  color: rgba(0,0,0,0.95);
  border-bottom: 1px solid rgba(0,0,0,0.05);
  vertical-align: middle;
}

.table tr:hover td { background: #e6e5e0; }
```

### Stat / KPI Widget

```css
.stat-widget {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  padding: 20px 24px;
}

.stat-widget__label {
  font-size: 13px;
  font-weight: 500;
  color: #a39e98;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.stat-widget__value {
  font-size: 32px;
  font-weight: 700;
  color: rgba(0,0,0,0.95);
  line-height: 1.1;
  letter-spacing: -1px;
}

.stat-widget__delta {
  font-size: 13px;
  font-weight: 500;
  margin-top: 6px;
}
.stat-widget__delta--up   { color: #3a7d3e; }
.stat-widget__delta--down { color: #cf2d56; }
```

---

## 5. Layout Principles

### Grid & Spacing

- **Base unit:** 8px
- **Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64px
- **Max content width:** 1200px (centered with `auto` margins)
- **Column gap in card grids:** 16px
- **Section padding:** 32px top/bottom, 24px sides

### Dashboard Layout

```
┌─────────────────────────────────────────────┐
│  Topbar (56px, bg: #ffffff, border-bottom)  │
├──────────┬──────────────────────────────────┤
│ Sidebar  │  Main Content Area               │
│ 240px    │  flex-1, padding: 24px 32px      │
│ #f2f1ed  │  bg: #f6f5f4                     │
│          │                                  │
│          │  ┌─────┐ ┌─────┐ ┌─────┐        │
│          │  │ KPI │ │ KPI │ │ KPI │        │
│          │  └─────┘ └─────┘ └─────┘        │
│          │                                  │
│          │  ┌──────────────┐ ┌──────────┐  │
│          │  │ Pipeline     │ │ Activity │  │
│          │  │ Feed         │ │ Log      │  │
│          │  └──────────────┘ └──────────┘  │
└──────────┴──────────────────────────────────┘
```

### Card Grid Layouts

```css
/* KPI row — 4-up */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

/* Main content — 2/3 + 1/3 split */
.content-split {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}

/* Full-width pipeline feed */
.pipeline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
```

### Whitespace Rules

- Always add 24px padding inside cards
- Section headers have 8px margin-bottom before their content
- Group related items with 8px gaps; separate unrelated with 16px+
- Never let two card borders touch — minimum 16px between cards

---

## 6. Depth & Elevation

Three-tier system from Notion (micro-shadows) + Cursor (atmospheric shadow):

### Tier 0 — Flat (no elevation)
Used for: table rows, sidebar items, background surfaces.
```css
box-shadow: none;
```

### Tier 1 — Card (resting)
Used for: standard cards, widgets, panels.
```css
box-shadow:
  0 1px 2px rgba(0,0,0,0.02),
  0 2px 4px rgba(0,0,0,0.02),
  0 4px 8px rgba(0,0,0,0.03),
  0 8px 16px rgba(0,0,0,0.02),
  0 16px 32px rgba(0,0,0,0.01);
```

### Tier 2 — Floating
Used for: dropdowns, tooltips, context menus, date pickers.
```css
box-shadow:
  0 4px 8px rgba(0,0,0,0.04),
  0 8px 16px rgba(0,0,0,0.04),
  0 16px 32px rgba(0,0,0,0.06);
```

### Tier 3 — Modal / Overlay
Used for: modals, command palette, full overlays.
```css
box-shadow: rgba(0,0,0,0.14) 0px 28px 70px; /* Cursor atmospheric */
```

### Borders as depth signal
- `1px solid rgba(0,0,0,0.1)` — default card/input outline
- `1px solid rgba(0,0,0,0.06)` — table row dividers (lighter)
- `1px solid rgba(0,0,0,0.15)` — active/focused borders (slightly stronger)

---

## 7. Do's and Don'ts

### Do

- Use `#f6f5f4` (not white) as the page background — the warmth reduces eye fatigue in long sessions.
- Apply status colors (`#dfa88f`, `#9fc9a2`, `#9fbbe0`, `#c0a8dd`) as dot indicators or left-border accents only.
- Use `#cf2d56` crimson for hover states on secondary buttons — the Cursor energy gives the UI life.
- Keep card borders at exactly `1px solid rgba(0,0,0,0.1)` — thicker or darker makes the page feel cluttered.
- Use `letter-spacing: -1px` on stat numbers (32px+) to make KPI values feel intentional.
- Use `Inter` for all UI. Fall back to system fonts. Never load a decorative font for labels.
- Compress typography at large sizes, normalize at small sizes.
- Use `rgba` transparencies for text and borders — they adapt gracefully if backgrounds shift.
- Limit a single page to one orange (`#f54e00`) usage — it's an urgent attention signal, not decoration.

### Don't

- Don't use `#ffffff` as the page background — the pure white removes warmth and flattens depth.
- Don't use status colors for large filled backgrounds — they become visually overwhelming.
- Don't apply weight 700 to body copy or labels — only headings get bold.
- Don't add more than 5 shadow layers — beyond that, shadows create muddiness.
- Don't use `border-radius` larger than 12px on cards or 8px on buttons — this is an admin tool, not a consumer app.
- Don't mix blue CTAs and orange accents on the same interactive element — pick one per context.
- Don't use `#f54e00` orange for status indicators — it belongs only to urgent badges and warnings.
- Don't center-align body text or table content — left-align everything for scan efficiency.
- Don't use `text-transform: uppercase` on body text — only on small caps labels (11px+, 0.3–0.5px spacing).
- Don't show empty states without a clear CTA — if a pipeline is empty, prompt the next action.

---

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Behavior |
|---|---|---|
| Mobile | < 768px | Single-column, sidebar collapses to bottom nav |
| Tablet | 768–1024px | Sidebar narrows to 60px icon rail, content full-width |
| Desktop | 1024–1280px | Full sidebar (240px), 2-col content grids |
| Wide | > 1280px | Max 1200px content, centered, sidebar fixed |

### Responsive Rules

**Sidebar:**
```css
/* Desktop */
.sidebar { width: 240px; }

/* Tablet */
@media (max-width: 1024px) {
  .sidebar { width: 60px; }
  .nav-item span { display: none; }
}

/* Mobile */
@media (max-width: 768px) {
  .sidebar { display: none; }
  .bottom-nav { display: flex; } /* 4–5 icon tabs */
}
```

**KPI Grid:**
```css
.kpi-grid {
  grid-template-columns: repeat(4, 1fr); /* Desktop */
}
@media (max-width: 1024px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .kpi-grid { grid-template-columns: 1fr; }
}
```

**Content Split:**
```css
.content-split {
  grid-template-columns: 2fr 1fr; /* Desktop */
}
@media (max-width: 1024px) {
  .content-split { grid-template-columns: 1fr; }
}
```

**Typography scaling:**
- H1 32px desktop → 24px mobile
- Display 48px desktop → 32px mobile
- Stat values 32px desktop → 28px mobile (maintain letter-spacing)

---

## 9. Agent Prompt Guide

When asking an AI agent to implement UI for this dashboard, use the following prompt fragments. Copy-paste and combine as needed.

### Base context block

```
Use the automation SNS dashboard design system:
- Page bg: #f6f5f4 (warm white), sidebar bg: #f2f1ed (cream)
- Cards: #ffffff, border 1px solid rgba(0,0,0,0.1), border-radius 12px
- Primary text: rgba(0,0,0,0.95), secondary: #615d59, muted: #a39e98
- Primary CTA: #0075de (blue), hover/active: #cf2d56 (crimson)
- Font: Inter, 400/500/600 body, 700 headings only
- Shadow: 5-layer ultra-low opacity (max 0.04 per layer)
- Base spacing unit: 8px
```

### For pipeline/status components

```
Use these status colors as dot indicators or left-border accents (3px):
- Researching: #dfa88f (warm peach)
- Generating: #9fc9a2 (sage green)
- Reviewing: #9fbbe0 (soft blue)
- Publishing: #c0a8dd (lavender)
- Error: #cf2d56 (crimson)
Do NOT use these as full card backgrounds.
```

### For KPI / stat widgets

```
Stat widget structure:
- Label: 11px, weight 500, uppercase, letter-spacing 0.4px, color #a39e98
- Value: 32px, weight 700, letter-spacing -1px, color rgba(0,0,0,0.95)
- Delta: 13px, weight 500, green #3a7d3e for up / crimson #cf2d56 for down
Card: white bg, 1px border rgba(0,0,0,0.1), 12px radius, 20px 24px padding
```

### For buttons

```
Primary button: bg #0075de, white text, 8px radius, 8px 16px padding, 14px weight 500
Secondary button: bg #ebeae5, dark text rgba(0,0,0,0.95), hover text #cf2d56, same sizing
Destructive: transparent bg, border rgba(207,45,86,0.3), text #cf2d56
```

### For navigation

```
Sidebar: bg #f2f1ed, width 240px, border-right rgba(0,0,0,0.1)
Nav items: 14px, weight 500, color #615d59
Active item: bg rgba(0,117,222,0.08), color #0075de, weight 600
Hover: bg rgba(0,0,0,0.05), color rgba(0,0,0,0.95)
```

### For data tables

```
Table headers: 11px, uppercase, letter-spacing 0.5px, color #a39e98, weight 600
Table cells: 14px, color rgba(0,0,0,0.95), padding 12px 16px
Row dividers: border-bottom 1px solid rgba(0,0,0,0.05)
Row hover: background #e6e5e0
```

### For modals and overlays

```
Modal: bg #ffffff, border-radius 12px, shadow rgba(0,0,0,0.14) 0px 28px 70px
Backdrop: rgba(0,0,0,0.3) blur(4px)
Header: 18px, weight 600, letter-spacing -0.25px
```

---

*Last updated: 2026-04-19*
*Design system: Notion × Cursor hybrid — SNS Automation COO Dashboard*
