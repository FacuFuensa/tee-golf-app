# Tee — App Store submission pack

Everything needed to submit **Tee** to the App Store, plus the exact list of what only you can do.

Audited against Apple's App Review Guidelines (July 2026 reference). Guideline numbers below are
the ones Apple actually quotes in rejections.

---

## 1. What you still have to do

Two things are left: **§1.3** (register the keys as EAS secrets) and **§1.5** (screenshots).
Everything else in this section is done and verified — kept here so the reasoning survives.

### 1.1 ~~Delete the stale lock file~~ — done

`bun.lock` is removed and `package-lock.json` is committed. npm is now the package manager, so a
cloud build can no longer reinstall the PostHog SDK that `bun.lock` still listed.

### 1.2 ~~Publish the website~~ — done

GitHub Pages is live and all four pages return 200. Paste these into App Store Connect:

| App Store Connect field | URL |
| --- | --- |
| Privacy Policy URL | `https://facufuensa.github.io/tee-golf-app/privacy.html` |
| Support URL | `https://facufuensa.github.io/tee-golf-app/support.html` |
| Marketing URL *(optional)* | `https://facufuensa.github.io/tee-golf-app/` |
| Privacy Choices URL *(optional)* | `https://facufuensa.github.io/tee-golf-app/delete-account.html` |

If the URLs differ from the above, update `expo/constants/links.ts` to match — the app links to
them from Settings, and a dead link there is a 5.1.1(i) rejection.

> The pages publish **ffuensalida@icloud.com** as the support address. Apple requires a real,
> monitored contact route. Swap it for a dedicated address in all four files plus `links.ts` if you
> would rather not publish your personal one.

### 1.3 Register the API keys as EAS secrets

Both keys are obtained and working — verified against the live endpoints (GolfCourseAPI returned
Pebble Beach with an 18-hole scorecard; OpenWeatherMap returned 17.6 °C and 2.24 m/s from 254°).
They are in `expo/.env`, which is gitignored, so local dev works.

They are **not** in `eas.json`, because that file is committed and this repository is public. A
published key can be spent by anyone against your quota. Register them as EAS secrets instead:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_GOLF_COURSE_API_KEY --value <golf key>
```
```bash
eas secret:create --scope project --name EXPO_PUBLIC_OPENWEATHER_API_KEY --value <weather key>
```

Both values are in `expo/.env`. Verify with `eas secret:list` before building — an
`EXPO_PUBLIC_` variable missing at build time is baked in as absent, and the feature ships dead.

**Upgrade GolfCourseAPI before submitting.** The free tier is 50 requests/day and the key is baked
into every copy of the binary, so the budget is shared across the entire installed base rather than
per user. It will run dry during a multi-day review window, and the search screen then shows
"Search failed" — a 2.1 "backend unavailable" rejection.

### 1.4 ~~Apply the two SQL migrations~~ — done and verified

Both are applied. `node store/verify-backend.mjs` signs in as the demo account and walks the same
reads the app performs, then probes the writes that should now be refused. All 11 checks pass:

- The app still works: 18 holes load, all greens pinned, 54 scores, 14 clubs.
- Privacy is closed: 0 other golfers' profiles visible, 0 foreign hand-mapped courses readable.
- Writes are scoped: rewriting a hole's `par` is refused with `42501` (insufficient_privilege), and
  the moderation trigger rejects an objectionable display name while accepting a normal one.

Re-run that script any time you touch RLS.

### 1.5 Take the screenshots

Only **one** size class is required, because the app is iPhone-only and portrait-locked:

**6.9″ portrait — 1320 × 2868, or 1290 × 2796, or 1260 × 2736.** Up to 10; Apple downscales for
every other device.

Shoot on an iPhone 16 Pro Max / 17 Pro Max simulator, signed in as the demo account:

1. Play screen with the big yardage number
2. Satellite green picker with the crosshair
3. Smart Caddy sheet
4. Group leaderboard with the invite code
5. Courses tab with the library
6. Stats — scoring average hero
7. Your bag

Do **not** screenshot the sign-in or splash screen — 2.3.3 rejects those specifically.

Simulator captures are RGBA. **Alpha in a screenshot is a hard upload failure**, so flatten them:

```bash
sips -s format png --setProperty formatOptions default shot.png --out flat.png
```

---

## 2. Demo account — already created and seeded

Live now, on your Supabase project. Paste into **App Store Connect → App Review Information**.

```
Username:  appreview@teegolf.app
Password:  see expo/store/.demo-credentials
```

> The password is deliberately **not** in this file. This repository is public, and a published
> password would let anyone sign in as the reviewer account and wipe its seeded course, bag and
> rounds — possibly mid-review. It lives in `expo/store/.demo-credentials`, which is gitignored.

Seeded with: an 18-hole mapped course (all greens pinned), a 14-club bag, and three finished rounds
scoring 89 / 85 / 79 so the Stats tab shows a real improving trend rather than an empty state.

Re-run `node store/seed-demo-account.mjs` any time to top it up — it is idempotent. **Re-verify the
login after every rejection**; a locked demo account is the second most common 2.1 rejection.

---

## 3. App Store Connect metadata

Every claim below is a feature that works in the shipping build. The catalog search and the
wind/temperature caddy are included because the API keys are now configured — if you ever ship
without them, remove the FIND ANY COURSE and SMART CADDY blocks, because 2.3.1 rejects a
description promoting a feature the app doesn't have.

**App Name** (25/30)
```
Tee: Golf GPS & Scorecard
```

**Subtitle** (29/30)
```
Rangefinder, scores and stats
```

**Promotional Text** (160/170)
```
Map any course by dropping a pin on each green, then walk up and see your number. Solo or with a group — share a 6-character code and race the live leaderboard.
```

**Keywords** (99/100 — no spaces after commas; `golf`, `gps`, `tee` and `scorecard` are omitted
because the name and subtitle already index them)
```
yardage,distance,green,caddie,course,birdie,par,strokes,round,handicap,clubs,carry,bag,scoring,fairway
```

**Description**
```
Tee tells you one thing, fast: how far you are from the green.

Open a hole and the number is right there — live GPS distance from where you stand to the green, in yards or metres. No menus, no clutter. Know your number, pick a club, hit it.

FIND ANY COURSE
Search a catalog of 30,000+ courses worldwide and add yours in a tap, with the full scorecard — every par and yardage — already filled in. Your library sorts itself so the course you're standing on is at the top.

SMART CADDY
Wind and temperature change how far a shot really plays. Tee reads the conditions at your position, splits the wind into the part that fights you and the part that just pushes you sideways, and shows what the distance actually plays like — then picks the club in your bag that matches.

BUILD YOUR OWN COURSES
Course scorecards give pars and yardages, but no database has the GPS coordinate of each green. So you drop a pin on the centre of each one — from the course itself, or from your sofa on the satellite map. A green you pin is shared, so nobody has to map the same hole twice.

PLAY AND SCORE
Tap through holes, set your score with a single stepper, and watch your round to par build across the scorecard strip. Adjust a green from the satellite map any time the pin moves.

PLAY WITH YOUR GROUP
Host a round and share the six-character code. Everyone who joins keeps their own scorecard, and the leaderboard updates live for the whole group as scores come in.

YOUR BAG
Add your clubs and the carry distance you actually hit them. Tee then suggests the club that matches the number in front of you.

SEE WHERE THE STROKES GO
Scoring average per 18, score to par on par 3s, 4s and 5s, your best round, and the full history of every round you have played.

MADE FOR THE ROUND
Yards or metres, one tap. Portrait, one hand, big type you can read in the sun.

Tee stores your courses, rounds and clubs in your own account. There are no ads and no tracking. You can delete all of your data, or delete your account entirely, from Settings at any time.
```

**Other fields**

| Field | Value |
| --- | --- |
| Primary category | **Sports** |
| Secondary category | Navigation |
| Copyright | `2026 Facundo Fuensalida` *(must match your Developer Program account holder name)* |
| Version | 1.0.0 |
| What's New | *(first release — describe the app, not "bug fixes")* |

---

## 4. Age rating questionnaire

Target: **4+**. Answer honestly — mis-rating is a 2.3.6 rejection.

| Question | Answer | Why |
| --- | --- | --- |
| User-Generated Content | **Yes** | Display names and hand-mapped course names are shown to other golfers |
| Social Media | **No** | The leaderboard is a read-only rank/name/score list — no feed, likes, comments or discovery |
| Messaging and Chat | No | — |
| Unrestricted Web Access | No | — |
| Advertising | No | — |
| Everything else | None | — |

Answering **Yes** to UGC is what makes the Guideline 1.2 moderation stack mandatory. All four
mechanisms now ship — see §6.

---

## 5. App Privacy (Nutrition Label)

Declare exactly this. It matches `app.json`'s privacy manifest and the published policy.

| Data type | Collected | Linked to user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Email Address | Yes | Yes | No | App Functionality |
| Name (display name) | Yes | Yes | No | App Functionality |
| User ID | Yes | Yes | No | App Functionality |
| Precise Location | Yes | **No** | No | App Functionality |
| Other User Content (scores, courses, clubs) | Yes | Yes | No | App Functionality |
| Search History (course search terms) | Yes | **No** | No | App Functionality |

**Nothing is used to track you**, so the ATT prompt is not needed and `NSUserTrackingUsageDescription`
is deliberately absent. That is now true of the binary — see §6.

---

## 6. What was fixed for submission

### Blockers resolved

| Guideline | Was | Now |
| --- | --- | --- |
| 5.1.2(i) | `metro.config.js` wrapped the build in `withRorkMetro`, whose transformer injected a PostHog analytics provider into the **production** root layout, reporting screen views and route params to `toolkit.rork.com` with no consent or disclosure | Wrapper removed; `@rork-ai/toolkit-sdk` uninstalled. **Verified by scanning the compiled production iOS bundle: zero occurrences of `posthog`, `toolkit.rork.com` or `RorkAnalyticsProvider`** |
| 5.1.1(i) | No privacy policy existed, and no in-app link | Full policy written and published; linked from Settings → Help & legal |
| 1.5 | No support URL, no contact route anywhere | Support page with FAQ + monitored email; Contact support row in Settings |
| 1.2 (×4) | Display names and course names reach other golfers with no filtering, no reporting, no blocking, no published contact | All four now ship — see below |
| 2.1(a) | No demo account; a reviewer landed in three empty tabs | Account created and seeded with a course, a bag and three rounds |
| 2.1 | Distance to green was unclamped — a reviewer at a desk saw a six-digit yardage as the app's hero number | Off-course state above 1,500 m: "You're not at this course" |
| 2.3.7 | Bundle ID `app.rork.24em0b51cklzuccswbgcu` under a namespace you don't own, permanent after first submission | `com.teegolf.app` |
| 2.3.1 | URL scheme `rork-app` (shared with every Rork app), expo-router origin pointing at `rork.com` | Scheme `tee`; origin removed |
| 2.1 | `+native-intent.tsx` returned `/` for every deep link, silently swallowing auth callbacks | Returns the path |

### Guideline 1.2 moderation stack

1. **Filtering before posting** — `utils/moderation.ts` screens display names and course names for
   slurs and obscenity across English and Spanish, defeating leetspeak, spacing and accent evasion.
   Enforced again server-side by triggers in migration 0010 so it can't be bypassed via the API.
2. **Reporting** — tap any player on the leaderboard → *Report player*, which opens a pre-filled
   email with the name and round reference.
3. **Blocking** — same menu → *Block player*. Blocked golfers vanish from leaderboards immediately.
   Manageable from Settings → Blocked players.
4. **Published contact** — Settings → Contact support, plus the support page.

### Correctness fixes a reviewer would have hit

- Onboarding no longer flashes on every cold start (the route guard raced the profile fetch), and a
  failed profile load no longer strands an existing golfer there with a raw Postgres error on screen.
- Stats showed "No stats yet" when the backend failed, telling golfers they'd never played. Now an
  error state with retry.
- Mapping a course: a failed save silently dropped the last green, and retrying persisted an
  incomplete course.
- Multiplayer score writes failed silently — your stepper showed a score the server never got. Now
  a tappable retry banner.
- `+not-found.tsx` was unmodified Expo boilerplate, comment `// template` and all.

### Backend hardening (migrations 0010 / 0011)

- `holes` was wholesale-writable by any authenticated user — not just the green pin but par, hole
  number, yardage and `course_id`, on every course in the database. Column-level grants now limit
  writes to `green_lat`/`green_lng`, preserving community greens.
- `join_round_by_code` was callable anonymously and acted as a hit/miss oracle for join codes. Now
  guarded and revoked from `anon`.
- "Delete all my data" left your course library and club bag behind, which made its own label untrue.
- Deleting an account left hand-mapped courses (a name you typed, plus coordinates you stood at)
  readable by everyone forever. Now deleted, per 5.1.1(v).
- `profiles`, `courses` and `holes` were readable in full by anyone who signed up — enough to join
  display names and handicaps to precise coordinates. Scoped in 0011.

### Removed from the binary

`@rork-ai/toolkit-sdk`, `posthog-react-native`, `@teovilla/react-native-web-maps`, `zustand`,
`expo-image-picker` (photo-library and camera API surface with no purpose strings — a 5.1.1(iii)
data-minimization problem), `expo-blur`, `expo-image`, `expo-symbols`, `expo-linear-gradient`,
`react-native-worklets`, `@stardazed/streams-text-encoding`, `@ungap/structured-clone`.

Production iOS bundle: **12.4 MB → 9.8 MB**.

---

## 7. Notes for Review — paste this, substituting the password

Replace `<PASSWORD>` below with the value from `expo/store/.demo-credentials` before pasting into
App Store Connect. It is not written here because this repository is public.

```
=== DEMO ACCOUNT ===
Username: appreview@teegolf.app
Password: <PASSWORD>
No 2FA. This account does not expire and is not rate-limited.
It is pre-seeded with a mapped 18-hole course, a full club bag,
and three completed rounds, so no field work is needed to see the app populated.

=== WHAT THE APP DOES ===
Tee is a golf GPS rangefinder and scorecard. Its core feature is the live
distance from the golfer's position to the green of the hole they are playing.

=== HOW TO REACH THE MAIN FEATURES ===
1. Live distance — Sign in > Courses tab > tap "Riverbend Links" > Play solo.
   The large number is the live GPS distance to that hole's green.
   NOTE: because you are not physically at this course, the screen will show
   "You're not at this course" instead of a yardage. This is intended behaviour,
   not a bug. To see the distance readout working from where you are:
     Play screen > tap the satellite map preview > drag the map so the crosshair
     sits a short distance away from the blue dot showing your position >
     "Save green". The hero number then shows your live distance to that pin and
     updates as you move.

2. Scoring — On the play screen, use the +/- stepper. The scorecard strip at the
   bottom shows every hole; tap any hole to jump to it. "Finish" saves the round
   to history and statistics.

3. Mapping a course — Courses tab > "+" (top right) > name it > "Start mapping" >
   drag the map and tap "Set green" once per hole. You can save a partial course.

4. Group rounds — Tap a course > "Host a group". A 6-character code appears in
   the Leaderboard sheet (people icon, top bar). To test the join side, create a
   second account and enter that code via Courses tab > "Join".

5. Smart Caddy — Appears on the play screen once a green is mapped and there are
   clubs in the bag (the demo account has both). It converts the raw distance
   into a "plays like" distance and recommends a club.

=== USER-GENERATED CONTENT AND MODERATION (Guideline 1.2) ===
The only user-authored content is a golfer's display name and the name of a
course they map by hand, both of which other golfers can see in a group round.
All four required mechanisms are implemented:
  - Filtering before posting: display names and course names are screened
    against a blocklist both client-side and by a database trigger.
  - Reporting: Leaderboard sheet > tap any player > "Report player".
  - Blocking: same menu > "Block player". Managed in Settings > Blocked players.
  - Published contact: Settings > Contact support, and the Support URL.

=== PERMISSIONS ===
- Location (When In Use only): used to compute the distance from the device to
  the saved green coordinate, and to sort the course list nearest-first. The app
  is fully usable if declined — you can still add courses, keep score, and view
  statistics. No background location is requested.
- No ATT prompt: the app does not track users, contains no advertising or
  analytics SDK, and does not access the advertising identifier.

=== ACCOUNT DELETION (Guideline 5.1.1(v)) ===
Settings > Delete account. This immediately and permanently deletes the account
record, the golfer's rounds, scores, saved courses, club bag, and any course they
mapped by hand. Settings > Delete all my data does the same minus the account itself.
Green coordinates contributed to the shared course map are retained — they are
attached to a golf hole, carry no identifier, and other golfers depend on them.
This is stated in the privacy policy and on the account deletion page.

=== BACKEND ===
Supabase (PostgreSQL + auth). Live and reachable throughout review.
No regional restrictions.

=== THIRD-PARTY CONTENT ===
Golf course scorecard data is licensed from GolfCourseAPI (golfcourseapi.com).
Weather from OpenWeatherMap. Satellite imagery via Apple Maps.
The demo course "Riverbend Links" is fictional.

=== CONTACT ===
Facundo Fuensalida — ffuensalida@icloud.com
```

---

## 8. Pre-flight checklist

**Build**
- [x] No private APIs; Expo SDK 54 / React Native 0.81
- [x] Version 1.0.0, build number 1, `autoIncrement` on in `eas.json`
- [x] `ITSAppUsesNonExemptEncryption: false` — HTTPS only, exemption applies
- [x] No hardcoded IPv4 literals (all HTTPS hostnames — IPv6-safe)
- [x] No debug menus, test flags or placeholder screens
- [x] Icon 1024×1024, RGB, **no alpha**, no baked-in corners — verified by decoding the PNG header
- [x] `bun.lock` removed; npm is the package manager and `package-lock.json` is committed
- [x] API keys verified against the live endpoints and inlined into the production bundle
- [ ] `eas secret:create` for both keys, then `eas secret:list` to confirm (§1.3)
- [ ] `eas build --platform ios --profile production` succeeds

**Privacy**
- [x] Privacy manifest declares all six collected data types
- [x] Required-reason API declared (`UserDefaults`, `CA92.1`)
- [x] Location purpose string names the feature and the benefit
- [x] No tracking, no ATT prompt, no advertising SDK — verified against the compiled bundle
- [x] Privacy policy live and publicly reachable — all four pages return 200
- [ ] App Privacy answers entered per §5

**Accounts**
- [x] Account deletion in-app, deleting the record and all associated data
- [x] Sign in with Apple not required — no social login, own-account exemption (4.8) applies
- [x] Demo account created and seeded
- [ ] Demo login re-verified on a device before hitting Submit

**Content & safety**
- [x] All four Guideline 1.2 mechanisms
- [ ] Age rating questionnaire answered per §4

**Metadata**
- [x] Name / subtitle / keywords / description drafted within every limit
- [ ] Screenshots captured, flattened, uploaded (§1.5)
- [ ] Support and Privacy Policy URLs entered
- [ ] Copyright and category set

**Legal**
- [ ] EU DSA trader status (App Store Connect → Business → Trader Status) — without it the app is
      removed from the EU App Store
- [ ] Export compliance: answer **No** to non-exempt encryption (already declared in `app.json`)
- [ ] Paid Apps agreement not needed — the app is free with no IAP

---

## 9. Build and submit

```bash
cd expo
npm run doctor
npm run typecheck
eas login
eas build:configure
npm run build:ios
npm run submit:ios
```

Fill in `eas.json` → `submit.production.ios` with your Apple ID, App Store Connect app ID and Team
ID first — the three `REPLACE_WITH_` placeholders.
