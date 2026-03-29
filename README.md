# SafeRoute KW

SafeRoute KW maps real Kitchener collision data to help students, cyclists, and drivers see which intersections are dangerous and why.

**Live:** [saferouting.vercel.app](https://saferouting.vercel.app)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Map | Mapbox GL JS |
| Data | City of Kitchener Open Data (2015–2022) |
| Hosting | Vercel |

---

## Run Locally

```bash
npm install
```

Create a `.env.local` file in the project root:

```
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token_here
```

Then start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Roadmap

Kitchener collision data is live. Waterloo and Cambridge are on the roadmap.

---

## About

Built by **Ajay Kular** at [Hack to the Future](https://lauriercs.ca) — Laurier Computing Society, March 2026.
