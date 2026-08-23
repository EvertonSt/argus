# Argus Dashboard

Next.js 15 SaaS-grade dashboard for Argus — the autonomous AI QA agent.

## Development

```bash
cd dashboard
npm install
npm run dev        # → http://localhost:3000
```

## Building

```bash
npm run build      # SSG export to out/
npm run export     # alias for `next export`
```

## Deploying to Vercel

```bash
npm run dev        # local dev
vercel --prod      # production deploy (requires Vercel CLI)
```

Or click the button:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository_url=https://github.com/EvertonSt/argus&project-name=argus-dashboard&root-directory=dashboard)

## Data source

The dashboard reads from `data/` at the repo root, which is populated by:

```bash
npm run run:mock    # generates mock data in ../data/
```

When deployed to Vercel, run `npm run dashboard:build` before `next build` to export
the latest run data into the dashboard's static data directory.
