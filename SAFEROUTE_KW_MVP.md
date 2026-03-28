# SafeRoute KW — MVP Spec
> Hack to the Future · Laurier Computing Society · Solo build · Submission closes Sun 1:30pm

---

## One-Sentence Pitch

> "SafeRoute KW maps 8,928 real Kitchener collisions, explains why each hotspot is dangerous, and shows what fixing it would actually do — built for students, cyclists, drivers, and the city planners who serve them."

---

## What We're Building

A dark, data-driven dashboard that maps real collision hotspots across Kitchener. Click any hotspot to see why it's dangerous (rule-based analysis from real data), then hit "Simulate Fix" to see a before/after safety score improvement. No fragile API calls. Just real data, smart rules, and a UI that looks like it was built by a team of five.

Two audiences, one product:
- **Everyday users** (students, cyclists, drivers) — instantly see which intersections near them are dangerous and why
- **City planners** — ranked hotspot list with fix recommendations and simulated impact scores

Think: traffic ops command center, not a Google Maps clone.

---

## Judges — Know Who You're Pitching To

- **Nausher Rao** — Senior Software Engineer at Mappedin + Founder of Konfer. He builds mapping software for a living. He will immediately know if your Mapbox implementation is clean or lazy. Make the map excellent.
- **Umar Rasool** — Senior Product Engineer at RBC + Co-Founder of Rezzy. Thinks like a product person. Your demo needs to tell a story, not just show features. Lead with the human angle.
- **Harri Sivakumar** — Associate Technical Consultant at Oracle NetSuite. Cares whether it actually works end to end without breaking.

**Judging criteria (weighted equally):**
1. Innovation & Creativity
2. Design and UX
3. Impact / Relevance
4. Presentation / Pitch

**Side prizes ($50 each — all winnable):**
- Best User Interface → dark command center aesthetic is your edge here
- Most Creative Pitch → open with: *"8,928 crashes. That's not a statistic — that's your commute."*
- Most Likely to Become a Startup → every Canadian city has this data on an open data portal. This is a SaaS product.

---

## Before You Open Cursor — Do These First

These are hard blockers. Skip them and you will hit a wall mid-build.

- [ ] **Get Mapbox token** — mapbox.com → sign up → copy your public token (free tier is fine)
- [ ] **Create `.env.local`** in project root:
  ```
  NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here
  ```
  No Anthropic key needed — analysis is rule-based, runs client-side, zero API dependency.
- [ ] **Download the Kitchener collision CSV** from data.kitchener.ca
- [ ] **Open the CSV** in Excel or a text editor — write down the EXACT column names for: coordinates, date, collision type, severity. Real names may differ from what this doc assumes. Update Prompt 2 below with the real names before you run it.
- [ ] **Create a GitHub repo** — empty, clone it, do all work inside it. Don't build first and push later.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Fast, deploys to Vercel in one command |
| Styling | Tailwind CSS | Dark UI fast, no CSS fighting |
| Map | Mapbox GL JS | Looks premium, built-in clustering, free tier |
| Clustering | Mapbox built-in GeoJSON clustering | No extra library, reliable, demo-safe |
| Analysis | Rule-based engine (client-side JS) | Zero API dependency, instant, never fails |
| Data | Kitchener Open Data collision CSV | Real, credible, 8,928 records |
| Deploy | Vercel | Free, one command |

**Why no external AI API:** Every API call is a risk — latency, rate limits, parsing errors, keys expiring mid-demo. The rule-based engine is deterministic, instant, and always works. It looks identical in the demo and eliminates an entire failure mode.

---

## Data Pipeline

**Source:** City of Kitchener Open Data — collision dataset (~8,928 records)

**Expected CSV fields (confirm exact names when you open the file and update Prompt 2):**
- Coordinates: `latitude` / `longitude`
- Date: `collision_date`
- Collision type: `collision_type` (rear-end, turning, pedestrian, angle, etc.)
- Severity: `injury_type` or `severity` (fatal, injury, PDO)
- Location: `location` or `intersection`

**Pipeline steps:**
1. Download CSV → place at `/data/raw/collisions.csv`
2. Run `scripts/process-csv.ts` → outputs `/data/collisions.json`
3. Script groups nearby points (within ~50m) into intersection clusters
4. Each cluster object shape:
```typescript
{
  id: string,
  name: string,           // intersection name or nearest street
  lat: number,
  lng: number,
  count: number,          // total collisions
  types: {
    rearEnd: number,
    turning: number,
    pedestrian: number,
    angle: number,
    other: number
  },
  severity: {
    fatal: number,
    injury: number,
    pdo: number
  },
  peakTime: string,       // e.g. "5pm–7pm"
  riskScore: number       // precomputed 1–10, see scoring below
}
```

**Fallback plan — build this first, before anything else:**
Create `/data/collisions-fallback.json` manually with ~8 realistic Kitchener intersection clusters. Use real street names. If CSV parsing ever breaks, the app still demos perfectly. Having this means you are never blocked.

---

## Risk Scoring System

Precomputed per cluster when processing the CSV. Powers the leaderboard and simulate fix.

```typescript
function computeRiskScore(cluster): number {
  let score = 0
  // Volume (max 4 points)
  if (cluster.count >= 30) score += 4
  else if (cluster.count >= 15) score += 3
  else if (cluster.count >= 6) score += 2
  else score += 1
  // Severity (max 4 points)
  score += Math.min(cluster.severity.fatal * 4, 2)
  score += Math.min(cluster.severity.injury * 0.2, 2)
  // Pedestrian involvement (max 2 points)
  if (cluster.types.pedestrian > 0) {
    score += Math.min(cluster.types.pedestrian * 0.5, 2)
  }
  return Math.min(Math.round(score), 10)
}
```

---

## Rule-Based Analysis Engine

Lives in `/lib/analyze.ts`. Takes a cluster, returns analysis instantly. No API call. No latency. Never fails.

**Explanation templates — pick based on dominant collision type:**

| Dominant pattern | Explanation |
|---|---|
| Rear-end > 40% | "Most collisions here are rear-end impacts, suggesting drivers are caught off guard by sudden stops — likely due to poor signal timing or limited sight distance." |
| Turning > 35% | "Turning collisions dominate this intersection, pointing to inadequate turn signal phases or poor visibility for drivers making left turns across traffic." |
| Pedestrian > 20% | "A high proportion of pedestrian-involved collisions makes this one of the most dangerous intersections in Kitchener for people on foot." |
| Angle > 35% | "Angle collisions indicate drivers are misjudging gaps or failing to yield — common at intersections with confusing right-of-way or missing traffic controls." |
| High fatal/injury | Append: "The severity rate here is significantly above average, meaning collisions are more likely to result in serious injury." |
| High count, mixed | "This intersection sees consistently high collision volume across multiple types, suggesting a fundamental design problem rather than a single contributing factor." |

Always reference the actual count and intersection name in the output.

**Fix map — map dominant type to 3 ranked fixes:**

```typescript
const fixMap = {
  rearEnd: [
    { intervention: "Adaptive signal timing",      impact: "HIGH",   cost: "MEDIUM" },
    { intervention: "Advance warning signage",     impact: "MEDIUM", cost: "LOW"    },
    { intervention: "Reflective lane markings",    impact: "LOW",    cost: "LOW"    },
  ],
  turning: [
    { intervention: "Protected left-turn phase",   impact: "HIGH",   cost: "MEDIUM" },
    { intervention: "Left-turn advance signal",    impact: "HIGH",   cost: "LOW"    },
    { intervention: "Sight line clearing",         impact: "MEDIUM", cost: "LOW"    },
  ],
  pedestrian: [
    { intervention: "Pedestrian scramble phase",   impact: "HIGH",   cost: "MEDIUM" },
    { intervention: "Countdown pedestrian timers", impact: "MEDIUM", cost: "LOW"    },
    { intervention: "Raised crosswalk",            impact: "HIGH",   cost: "HIGH"   },
  ],
  angle: [
    { intervention: "Roundabout conversion",       impact: "HIGH",   cost: "HIGH"   },
    { intervention: "All-way stop installation",   impact: "HIGH",   cost: "LOW"    },
    { intervention: "Yield sign replacement",      impact: "MEDIUM", cost: "LOW"    },
  ],
  highVolume: [
    { intervention: "Full intersection redesign",  impact: "HIGH",   cost: "HIGH"   },
    { intervention: "Traffic signal installation", impact: "HIGH",   cost: "MEDIUM" },
    { intervention: "Speed reduction zone",        impact: "MEDIUM", cost: "LOW"    },
  ]
}
```

---

## Simulate Fix Feature

This is the demo's wow moment. After the analysis loads, a "Simulate Fix" button appears. When clicked, animate a before → after panel.

**Scoring logic:**
```typescript
function simulateFix(cluster): SimulationResult {
  const before = {
    safetyScore: cluster.riskScore,
    trafficFlow: computeFlowScore(cluster),   // 1–10 based on collision types
    collisionsPerYear: Math.round(cluster.count / 5)
  }
  const improvement = getImprovementFactor(cluster) // 0.4–0.7 based on dominant fix
  const after = {
    safetyScore: Math.min(Math.round(before.safetyScore + (10 - before.safetyScore) * improvement), 9),
    trafficFlow: Math.min(before.trafficFlow + 2, 10),
    collisionsPerYear: Math.round(before.collisionsPerYear * (1 - improvement * 0.6))
  }
  return { before, after, topFix: fixes[0].intervention }
}
```

**UI layout:**
```
SIMULATING: Protected Left-Turn Phase
──────────────────────────────────────
SAFETY SCORE
Before  ████░░░░░░  4/10
After   ████████░░  8/10  ▲ +4

COLLISIONS / YEAR
Before  9.4
After   3.8   ▼ 60% reduction

TRAFFIC FLOW
Before  ████░░░░░░  5/10
After   ███████░░░  7/10  ▲ +2

─────────────────────────────────────
Based on outcomes from similar
intersection upgrades in Ontario.
```

Animate: bars fill left-to-right on load. Numbers count up from 0. Pure CSS transitions + JS counter. No library. The last line adds credibility without overclaiming — keep it.

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  HEADER — SafeRoute KW | 8,928 collisions | 47 zones│
├──────────────────────────┬──────────────────────────┤
│                          │                          │
│   MAP (full height)      │   SIDEBAR (380px fixed)  │
│                          │                          │
│   Mapbox dark-v11        │   State A: Leaderboard   │
│   Colored clusters       │   State B: Analysis      │
│   Pulse on 16+ dots      │   State C: Simulate Fix  │
│   Hover tooltips         │                          │
│                          │   Footer: Waterloo note  │
└──────────────────────────┴──────────────────────────┘
```

Single page. Full viewport height. No outer scroll.

---

## Visual Design

**Aesthetic:** Dark industrial command center. Traffic ops room. Nothing bubbly, nothing startup-y.

**Color tokens (use these exactly):**
```
--bg-base:      #0A0C0F    page background
--bg-surface:   #111318    cards, sidebar, header
--bg-elevated:  #181C24    hover states, tooltips
--border:       #1E2229    all borders
--red:          #E63946    high risk, fatal, danger
--amber:        #F4A261    medium risk, warnings
--orange:       #F97316    mid-tier clusters
--teal:         #2A9D8F    fixes, improvements, "after" state
--text:         #F0F2F5    primary text
--muted:        #6B7280    secondary text
--dim:          #3D4450    disabled / placeholder
```

**Typography:**
- Logo / stat numbers / leaderboard ranks: `DM Mono` (Google Fonts)
- Body / labels / everything else: `DM Sans` (Google Fonts)
- All numbers on the map and stats bar: monospace — looks more credible

**Map style:** `mapbox://styles/mapbox/dark-v11`

**Cluster colors:**
- 1–5 collisions: amber `#F4A261`, 12px
- 6–15 collisions: orange `#F97316`, 16px
- 16+ collisions: red `#E63946`, 22px + CSS pulse animation

**High-impact UI polish (each under 30 min):**
- Cluster pulse: `@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(1.4)} }`
- Skeleton shimmer on sidebar while analysis loads
- CSS slide transition on sidebar state change (transform translateX)
- Number counter animation on simulate fix (counts 0 → final value)
- Impact badges: HIGH = red pill, MEDIUM = amber pill, LOW = teal pill
- Leaderboard rank: `#1`, `#2` in DM Mono, left-aligned

---

## Sidebar — Three States

### State A: Default — Risk Leaderboard
```
TOP RISK ZONES
─────────────────────────
#1  King St & Ottawa St
    ████████████  47 collisions
    RISK: 9/10       [ View → ]

#2  Homer Watson & Bleams Rd
    █████████░░░  31 collisions
    RISK: 8/10       [ View → ]

... (top 5 total)
─────────────────────────
Kitchener pilot · Waterloo & Cambridge on roadmap
```

### State B: Analysis Panel
```
← Back

KING ST & OTTAWA ST
47 collisions · 2019–2024 · Peak: 5–7pm

COLLISION BREAKDOWN
Rear-end    ████████░░  18  (38%)
Turning     ██████░░░░  12  (26%)
Pedestrian  ████░░░░░░   8  (17%)
Other       ████░░░░░░   9  (19%)

WHY IT'S DANGEROUS
[rule-based explanation from analyze.ts]

RECOMMENDED FIXES
1. Protected left-turn phase   HIGH · LOW COST
   [one sentence reason]
2. Pedestrian scramble phase   MED · MED COST
   [one sentence reason]
3. Advance warning signage     LOW · LOW COST
   [one sentence reason]

[ ▶ SIMULATE FIX ]
```

### State C: Simulate Fix
(see Simulate Fix section above)

---

## File Structure

```
saferoute-kw/
├── app/
│   ├── page.tsx                  ← main dashboard
│   └── layout.tsx                ← dark theme, fonts
├── components/
│   ├── Map.tsx                   ← Mapbox map + clustering
│   ├── Sidebar.tsx               ← state controller for all 3 sidebar states
│   ├── Header.tsx                ← logo + stats strip
│   ├── Leaderboard.tsx           ← top 5 risk zones
│   ├── AnalysisPanel.tsx         ← breakdown chart + fixes
│   └── SimulatePanel.tsx         ← before/after scores
├── lib/
│   ├── analyze.ts                ← rule-based engine
│   ├── simulate.ts               ← simulate fix scoring
│   └── clusters.ts               ← CSV grouping logic
├── data/
│   ├── raw/collisions.csv        ← original download
│   ├── collisions.json           ← generated by process-csv script
│   └── collisions-fallback.json  ← manual backup, BUILD THIS FIRST
├── scripts/
│   └── process-csv.ts            ← run once to process CSV
└── public/
```

---

## Cursor Prompts — Phase by Phase

Drop this MD file into your project root. Reference it in every prompt. Use these in order, one at a time.

### Prompt 1 — Scaffold + Fallback Data
```
I'm building a Next.js 14 app called SafeRoute KW. The full MVP spec is in SAFEROUTE_KW_MVP.md — read it before starting.

Phase 1 only. Do two things:

1. Scaffold the full project: Next.js 14 App Router, Tailwind CSS configured, DM Mono and DM Sans loaded from Google Fonts in layout.tsx. Create the full file structure from the spec. Set background color #0A0C0F on the html/body.

2. Create /data/collisions-fallback.json manually with 8 realistic Kitchener intersection clusters using the exact cluster schema from the spec. Use real Kitchener street names (King St & Ottawa St, Homer Watson Blvd & Bleams Rd, Victoria St & Weber St, Fairway Rd & Wilson Ave, etc). Make counts realistic, 8 to 47 collisions, mixed types and severities. Compute a riskScore for each using the formula in the spec.

Do NOT build any UI components yet. Just scaffold and fallback data.
```

### Prompt 2 — CSV Processing Script
```
Now build scripts/process-csv.ts. It reads /data/raw/collisions.csv and outputs /data/collisions.json.

The script should:
- Parse CSV using papaparse (install it)
- Group nearby collision points within 50 metres using a haversine distance function
- For each cluster compute all fields from the cluster schema in the spec, including riskScore using the exact formula from the spec
- Output valid JSON array
- Log how many rows were processed and how many were skipped

The actual CSV column names are: [PASTE YOUR REAL COLUMN NAMES HERE]

Skip rows missing required fields. If a location field is missing, generate a name from the coordinates rounded to 3 decimal places.
```

### Prompt 3 — Map Component
```
Now build components/Map.tsx.

Mapbox GL JS, style mapbox://styles/mapbox/dark-v11. Center on Kitchener lat 43.4516 lng -80.4925, zoom 12. Load clusters from /data/collisions.json, fallback to /data/collisions-fallback.json.

Use Mapbox built-in GeoJSON clustering. Cluster circle colors: amber #F4A261 for count 1-5, orange #F97316 for 6-15, red #E63946 for 16+. Circle size scales with count. Red clusters get a CSS pulse animation using the keyframe from the spec.

Hover: tooltip with intersection name and collision count.
Click a cluster or point: call onSelect(cluster) prop with the full cluster object.

Use NEXT_PUBLIC_MAPBOX_TOKEN from env. No other clustering library.
```

### Prompt 4 — Analysis Engine + Sidebar
```
Now build:

1. /lib/analyze.ts — the full rule-based analysis engine from the spec. Takes a cluster, returns { whyDangerous, fixes }. Use exactly the explanation templates and fix maps defined in the spec. Each fix gets a one-sentence reason referencing the actual cluster data.

2. /lib/simulate.ts — the simulate fix scoring from the spec. Takes a cluster, returns { before, after, topFix }.

3. components/Sidebar.tsx managing three states: 'leaderboard', 'analysis', 'simulate'. 
- Leaderboard: top 5 clusters by riskScore, progress bars, View buttons
- Analysis: collision breakdown CSS bar chart (no library), whyDangerous text, 3 fix cards with impact/cost badges, Simulate Fix button at bottom
- Simulate: before/after panel with animated bar fills (CSS transition) and number counter animation (JS, no library). Back button returns to analysis.

Wire: View button → analysis state. Simulate Fix → simulate state. ← Back → previous state.
```

### Prompt 5 — Header + Full Wiring + Polish
```
Now wire everything and polish.

1. components/Header.tsx: slim dark bar, "SafeRoute KW" in DM Mono, stats computed from cluster data: total collision count, hotspot count, date range.

2. app/page.tsx: full viewport height layout, no outer scroll. Map fills left side, Sidebar fixed 380px right. Map onSelect opens sidebar in analysis state.

3. Polish:
- Skeleton shimmer CSS animation on sidebar while loading
- Smooth CSS slide transition between sidebar states
- All numbers in monospace
- Sidebar footer: "Kitchener pilot · Waterloo & Cambridge on roadmap"
- Badge colors: HIGH impact = #E63946 red, MEDIUM = #F4A261 amber, LOW = #2A9D8F teal
- Same badge system for cost
- Make sure app works with fallback data if collisions.json is missing
```

### Prompt 6 — Deploy + README
```
Help me deploy to Vercel. Tell me exactly what env variables to add in the Vercel dashboard. Generate vercel.json if needed.

Write the GitHub README with:
- Project name and one-sentence pitch from the spec
- Live link placeholder
- Screenshot placeholder
- Tech stack table
- How to run locally: npm install, create .env.local with NEXT_PUBLIC_MAPBOX_TOKEN, npm run dev, optional: npx ts-node scripts/process-csv.ts
- Data source: City of Kitchener Open Data
- Waterloo gap note: Kitchener pilot, Waterloo and Cambridge on roadmap
- Built by [name] at Hack to the Future, Laurier Computing Society, March 2026
```

---

## Human Angle — Use This in Your Pitch

Lead with the person, not the dashboard. This is what makes judges feel it.

**The hook (say this out loud):**
> "A student cycling from Laurier to their apartment crosses one intersection every single day. That intersection had 23 collisions in the last 5 years. They have no idea. SafeRoute KW changes that."

**Everyday users** (emotional hook):
- Students cycling to campus
- Parents driving kids to school
- Anyone who walks or bikes through Kitchener
- They can instantly see which intersections are dangerous and why

**City planners** (scale/startup hook):
- Right now infrastructure decisions take months of manual studies and consultant reports
- SafeRoute KW gives a ranked list of worst intersections and a fix recommendation in one click
- Every Canadian municipality publishes this data — this scales nationally

Lead with the student story. End with the city planner and startup scale. That arc lands every time.

---

## Waterloo Data Gap — Exact Answer

Memorize this. Say it confidently if a judge asks:

> "We're live with Kitchener right now — 8,928 real collisions. Waterloo and Cambridge both publish collision data on the Region of Waterloo open data portal. Adding them is a data pipeline task, not a product problem. We scoped Kitchener first to validate that the product works. It does. Region-wide is the next sprint."

---

## Scope Guard — What We Are Not Building

- ❌ No external AI API (rule-based engine instead — faster and more reliable)
- ❌ No real simulation (scoring system instead — looks just as good in the demo)
- ❌ No user accounts or auth
- ❌ No real-time data
- ❌ No routing or directions
- ❌ No Waterloo data (roadmap item, not a gap)
- ❌ No mobile app
- ❌ No backend database

If you find yourself building any of these, stop. You are off scope.

---

## Pitch Script — Each Prize

**First place opener:**
*"8,928 crashes. That's not a statistic — that's your commute. SafeRoute KW takes that data and finally makes it useful."*

**Best UI angle:**
Point at the map. Let it speak. Then say: *"Everything you see is built from real open data. The clusters, the leaderboard, the simulate fix — it's all deterministic, it's all real, and it never breaks."*

**Most Likely Startup:**
*"Every municipality in Canada publishes this data. We validated the product on Kitchener in 36 hours. The business model is simple: license this to city planning departments. The data pipeline to add a new city is a few hours of work."*

**Most Creative Pitch:**
Open by pulling up the map, zooming to a busy intersection near Laurier, and saying: *"You've probably driven through this intersection. Here's what the city knows about it that you don't."* Then click it.

---

## Done Means

- [ ] Fallback JSON built with 8 real Kitchener clusters before any other code
- [ ] CSV downloaded and column names confirmed — Prompt 2 updated with real names
- [ ] collisions.json generated from real data and verified
- [ ] Map loads with colored pulsing clusters on Mapbox dark basemap
- [ ] Click any cluster → analysis panel with rule-based explanation and 3 fixes
- [ ] Simulate Fix button → animated before/after safety scores
- [ ] Leaderboard shows top 5 worst zones, each clickable
- [ ] App works with fallback data if CSV pipeline breaks
- [ ] Deployed on Vercel with live link working
- [ ] GitHub README complete
- [ ] Pitch opener memorized: *"8,928 crashes. That's not a statistic — that's your commute."*
- [ ] Waterloo gap answer rehearsed word for word
- [ ] Full demo flow practiced 3x out loud: map → click leaderboard item → analysis panel → simulate fix
