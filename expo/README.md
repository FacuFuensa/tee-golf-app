# Tee — Golf GPS & Scorecard

Live GPS distance to the green, a scorecard, group rounds and scoring stats. iPhone-first,
built with Expo Router and React Native on a Supabase backend.

> **Repository layout.** This repo is a Rork workspace: `rork.json` at the root lists the app
> under `apps[].path`. Every command below runs from `expo/`, not from the repository root.

---

## Running it

```bash
cd expo
npm install --legacy-peer-deps
npm run go            # Expo Go on a device, dev server on port 8090
```

Then open `exp://<your-lan-ip>:8090` in Expo Go, or scan the QR the command prints. If your phone
can't reach the machine, use `npm run go:tunnel`.

| Script | What it does |
| --- | --- |
| `npm run go` | Dev server for Expo Go (port 8090) |
| `npm run go:tunnel` | Same, over an ngrok tunnel when LAN fails |
| `npm run web` | Web build — uses `SatelliteMap.web.tsx` instead of native maps |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npm run doctor` | `expo-doctor` — run before any release build |
| `npm run build:ios` | `eas build --platform ios --profile production` |
| `npm run submit:ios` | `eas submit --platform ios --profile production` |

Node 20+ and npm are all you need. Bun is optional — the lockfile in the repo is `bun.lock`, and
npm's `package-lock.json` is gitignored so CI keeps inferring bun.

---

## Environment

Copy `.env.example` to `.env` and fill in what you have. Every variable is `EXPO_PUBLIC_`, so all
of them ship inside the app bundle — never put a secret here.

| Variable | Required | Without it |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | no (falls back) | — |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | no (falls back) | — |
| `EXPO_PUBLIC_GOLF_COURSE_API_KEY` | **yes for release** | Course search is dead; only hand-mapping works |
| `EXPO_PUBLIC_OPENWEATHER_API_KEY` | **yes for release** | Smart Caddy falls back to raw distance |

For release builds set the two API keys in `eas.json` under `build.production.env`, or as EAS
secrets so they are not committed.

---

## How it fits together

```
app/
  _layout.tsx          root providers + the auth route guard
  sign-in.tsx          email/password (Supabase auth)
  onboarding.tsx       display name, moderated before it is saved
  (tabs)/
    courses.tsx        your library, nearest-first; start solo or host a group
    stats.tsx          scoring analytics
    settings.tsx       units, bag, blocked players, legal links, deletion
  course/
    browse.tsx         search the GolfCourseAPI catalog and import
    new.tsx            map a course by hand, one pin per green
  round/[id].tsx       the play screen — distance, score, caddy, leaderboard
  bag.tsx              clubs and carry distances

providers/             auth, settings, paused round, blocked players
services/              db.ts (all Supabase), golfApi.ts, weather.ts, supabase.ts
utils/                 geo.ts (haversine, units), caddy.ts (plays-like), stats.ts, moderation.ts
supabase/migrations/   the schema and every RLS policy, in order
```

**Data model.** Courses and their greens are *shared* — a green pinned by one golfer is visible to
everyone who plays that course. Which courses appear in *your* list is private, held in the
`user_courses` membership table. Rounds, scores and clubs are per-account and protected by RLS.

**Greens.** Course scorecards give pars and yardages, but no public database has the GPS
coordinate of each green. So golfers pin them, once, and the pin is shared.

---

## Supabase

Run the migrations in `supabase/migrations/` in numeric order, once each, in the SQL editor.

`0010_appstore_hardening.sql` and `0011_scope_reads.sql` were added for App Store submission.
0010 is safe to apply directly. **0011 narrows SELECT policies** — apply it, then walk the
checklist in the comment block at the bottom of that file before shipping a build, because a
mistake there shows up as missing data rather than as an error.

---

## Before submitting to the App Store

See [`store/SUBMISSION.md`](./store/SUBMISSION.md) for the full checklist, the drafted App Store
metadata, the review notes template and the demo-account seed script.
