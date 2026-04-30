# Zero Returns — Project Handoff

Paste this into a new chat and say "this is where we are — let's pick up."

Last updated: **April 29, 2026** (end of Mac onboarding + flywheel-closing session)

---

## What Zero Returns is

A **sizing-recommendation platform for apparel brands**, focused on the **golfleisure / polo** niche. The business is built around a data flywheel: the more consumers stamp their wardrobes into a portable "Sizing Passport," the better the system gets at predicting which size of which brand will fit any given shopper. That data powers a Shopify widget that brands embed at checkout to reduce returns.

### The flywheel (this is the strategic core)

```
More consumers create passports
         ↓
Larger graph of brand×size×fit relationships
         ↓
Higher-confidence size recommendations
         ↓
Lower returns for brands using the widget
         ↓
More brands install the widget
         ↓
More shoppers see the passport prompt
         ↓
More consumers create passports  ← (back to top)
```

The recommendation engine combines three data sources:
1. **Consumer passport data** — what brands/sizes a shopper actually owns and how they rated the fit (Too tight / Slightly snug / Perfect / Slightly loose / Too loose)
2. **Factory measurements** — manufacturer-provided size charts (ground truth for each brand's intended sizing)
3. **Hand measurements** — physical measurements (body or garment) for cross-validation

Output: a **confidence score** for "what size of Brand X should this shopper buy?" plus cross-brand fit suggestions ("you wear M in Lululemon → you'll likely wear S in Bonobos").

## The three product surfaces

| Surface | URL | Audience | Purpose |
|---|---|---|---|
| **Sizing Passport** | `/profile` | Consumers | Build the data layer — consumers stamp their wardrobe |
| **Sizing Widget** | Embedded in brand product pages via Shopify app | Shoppers at brand sites | Get a confidence-scored size recommendation at checkout |
| **Merchant Dashboard** | `/dashboard` | Brand operators | See conversion funnel, return rate vs ~22% industry baseline, profile data |

## Naming history (read this — it's confusing)

| Where it appears | Name | Status |
|---|---|---|
| Current product name | **Zero Returns** | Use this everywhere going forward |
| GitHub org / repo | `ZeroReturns2026/zero-returns` | Matches current name |
| Local workspace folder | `Zero Returns` | Matches |
| Shopify dev store | `zeroreturns` (`zeroreturns.myshopify.com`) | Matches |
| Live URL / Railway service | `hey-tailor-web` | Legacy — old working name "Hey Tailor" |
| Shopify app name | `Hey Tailor` | Legacy — should be renamed to "Zero Returns" eventually |
| Railway project (auto-generated) | `genuine-courage` | Never renamed; keep or rename in Railway settings |
| Earlier handoff drafts | "FitViz" | Abandoned name; not used anywhere in code/infra |

## Architecture

```
                    ┌─────────────────────────────────┐
                    │  Consumer Sizing Passport UI    │
                    │  /profile  (vanilla JS form)    │
                    └─────────────────┬───────────────┘
                                      │ saves stamps
                                      ↓
   ┌─────────────────────────────────────────────────────────────┐
   │   Railway-hosted Node/TypeScript backend                    │
   │   hey-tailor-web-production.up.railway.app                  │
   │                                                             │
   │   Each save writes to BOTH:                                 │
   │     • shopper_profiles + profile_items  (live passport)     │
   │     • survey_respondents + survey_items  (engine's data)    │
   │                                                             │
   │   Recommendation engine reads survey_items for collab       │
   │   filtering + factory measurements for measurement match    │
   └────┬─────────────────────────────────────┬──────────────────┘
        │                                     │
        ↓                                     ↑
   ┌────────────┐                  ┌──────────────────────┐
   │  Postgres  │                  │  Shopify App Proxy   │
   │  (Railway) │                  │  /apps/...  → Railway│
   │  + volume  │                  └──────────┬───────────┘
   └────────────┘                             │
                                              ↓
                                   ┌──────────────────────────┐
                                   │  Theme App Extension     │
                                   │  "sizing-widget"         │
                                   │  embedded in brand's     │
                                   │  Shopify product page    │
                                   └──────────────────────────┘
```

## Tech stack

- **Language:** TypeScript (Node ≥ 22.5)
- **Frontend:** Server-rendered HTML pages with inline vanilla JS (no React/Vue) for `/profile` and `/dashboard`. Chart.js (CDN) for dashboard charts. Widget itself is React + Vite (under `widget/`).
- **Backend:** Node + Express REST API, run with `tsx watch` in dev
- **Database:** Postgres on Railway (production), local Postgres for dev. Persistent volume on Railway.
- **Auth:** JWT-based for consumers (email + password). Token stored in `localStorage` as `zrToken`. Anonymous email-only lookups via `GET /api/profiles/:email`.
- **AI / recommendation engine:** **Hand-coded heuristic + collaborative filtering** (no LLM calls). Confirmed via grep — no `anthropic`, `claude-`, or `sk-ant` references anywhere in the codebase. The "AI" is a Levenshtein-distance fuzzy matcher + measurement-based scoring + survey vote counting. See "Recommendation engine" section below.
- **Distribution:** Shopify custom app (not a public Shopify App Store listing) installed manually on brand stores
- **Charts:** Chart.js (CDN-loaded on dashboard)

## Where everything lives

| Thing | Location |
|---|---|
| GitHub repo | `ZeroReturns2026/zero-returns` |
| Production branch | `main` |
| Railway-deployed backend root | `web/` (subfolder of the repo) |
| Shopify widget source | `widget/` (React + Vite — built artifact copied into `extensions/`) |
| Shopify Theme App Extension | `extensions/sizing-widget/` (Liquid + assets/JS) |
| Local workspace folder | `~/Documents/Claude/Projects/Zero Returns` (Mac, Cowork-aware) |
| Railway workspace | `genuine-courage` |
| Railway project | `genuine-courage` |
| Railway app service | `hey-tailor-web` |
| Live base URL | https://hey-tailor-web-production.up.railway.app |
| Consumer passport | https://hey-tailor-web-production.up.railway.app/profile |
| Merchant dashboard | https://hey-tailor-web-production.up.railway.app/dashboard |
| Shopify dev store admin | https://admin.shopify.com/store/zeroreturns |
| Shopify dev store storefront | https://zeroreturns.myshopify.com (password-protected; needs unlock to go live) |
| Shopify app in dev store | "Hey Tailor" — admin → Apps → Hey Tailor |
| Shopify / Railway / GitHub login email | zeroreturns2026@gmail.com |
| Local handoff doc (this file) | `~/Documents/Claude/Projects/Zero Returns/HANDOFF.md` |

## Shopify integration details

The custom Shopify app **"Hey Tailor"** has two extensions wired up:

| Extension | Type | What it does |
|---|---|---|
| `sizing-widget` | Theme App Extension | Renders inside a brand's Shopify storefront via a theme block. Shoppers see this on product pages. |
| `app_proxy` | App Proxy | Routes storefront requests through Shopify back to the Railway backend. Keeps the backend URL hidden and lets Shopify authenticate the request. |

To iterate on the widget locally: install Shopify CLI (`brew install shopify-cli`), then `shopify app dev` from inside the project folder. Last app update was April 15, 2026.

**Dev store inventory** (test products for the widget):
- The Rodgers Quarter-Zip
- The Yale Polo
- The Perkins Polo (id: 8247778803756)

## Data model

### Identity tables

Three tables that all use email as a key but for different purposes:

| Table | Stores | Behavior on save |
|---|---|---|
| `auth_users` | Login credentials (email + bcrypt password + profile_id FK) | Untouched by passport saves. Created via `POST /api/auth/register`. |
| `shopper_profiles` + `profile_items` | The live passport — measurements, fit pref, brand stamps | **Additive upsert** — finds row by email, updates demographics; for items, dedupes by (profile_id, brand, product_name, size_label) and updates fit_rating on matches |
| `survey_respondents` + `survey_items` | Same shape as the live passport. The recommendation engine reads ONLY this set. | **Additive upsert** — every passport save mirrors here so the engine sees updates |

### Profile fields

A **shopper_profile** has:
- `firstName`, `lastName`, `email` (email = cross-store identifier; lowercased on insert)
- `height` (e.g. `5'10"`), `weight`, `buildType` (`slim` / `athletic` / `average` / `broad`), `chestMeasurement` (optional, inches)
- `fitPreference` (`trim` / `standard` / `relaxed`)

### Stamp fields

A **profile_item** ("stamp") has:
- `id` (SERIAL primary key — used by the DELETE endpoint)
- `profile_id` (FK to shopper_profiles)
- `brand` (free text — user types it; normalized via `brandNormalizer`)
- `product_name` (free text; normalized via `normalizeFit` for known brands)
- `size_label` (`XS` / `S` / `M` / `L` / `XL` / `XXL`)
- `fit_rating` (`too_tight` / `slightly_snug` / `perfect` / `slightly_loose` / `too_loose`)
- `is_primary` (first stamp is marked primary)

**No cap on stamp count** — was previously 5, removed April 29 2026 in favor of an "additive only" model. See the "Recent changes" section.

## API surface

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Create account (email, password, firstName, lastName) | None |
| POST | `/api/auth/login` | Login → returns `{ token, user, profile, items }` | None |
| GET | `/api/auth/me` | Get current user + profile + items | Bearer token |
| POST | `/api/profiles` | Create or **additive-upsert** passport. Items are deduped; fit_rating refined on matches. Mirrors writes to survey tables. | Optional Bearer |
| GET | `/api/profiles/:email` | Public lookup by email | None |
| GET | `/api/profiles` | List all profiles (dashboard) | (No auth currently — should be admin-gated eventually) |
| GET | `/api/profiles/export` | Excel export of all profiles | (Same — should be admin) |
| **DELETE** | **`/api/profiles/items/:id`** | **Remove a single stamp from the authenticated user's passport. Auth: Bearer. Looks up owning profile by email (robust to broken auth_users.profile_id linkage). Mirrors the delete to `survey_items` so the engine forgets too.** | **Bearer (required)** |
| GET | `/api/conversions` | Funnel data for merchant dashboard | (Currently broken in production — see "Known issues") |

The merchant dashboard expects `/api/conversions` to return `{ funnel, rates, daily, products, size_distribution, recent_events }`. Funnel events tracked: `recommendation_shown`, `add_to_cart_after_recommendation`, `purchase_completed`, `return_initiated`.

## Recommendation engine

Lives in `web/src/services/recommendationEngine.ts`. **Two layers** that get blended:

### Layer 1: Collaborative filtering

When a shopper says "I wear Lululemon size M and want to buy The Yale Polo":
1. Normalize the incoming brand via `normalizeBrand` (handles typos, abbreviations, fuzzy matches)
2. Query `survey_items` for everyone who owns the same normalized brand+size
3. Pull every other item those matched respondents own
4. Cast votes for each available size of the target product based on their stamps
5. Boost: also pull respondents' chest measurements; the closest matching target size gets a 0.5 vote
6. Pick the winner; assign confidence:

| Votes | Agreement | Confidence |
|---|---|---|
| 5+ | ≥70% | 95% |
| 3+ | ≥60% | 88% |
| 2+ | any | 78% |
| 1 | any | 65% |

### Layer 2: Measurement-based matching

For each available size of the target product:
```
score = chest_diff × 0.5  +  shoulder_diff × 0.3  +  length_diff × 0.2
```

Reference measurements are first adjusted by fit preference:
- **Trim**: chest −0.5", shoulder −0.25"
- **Standard**: 0
- **Relaxed**: chest +0.75", shoulder +0.25", length +0.25"

Lowest score wins. Then **directional guards** kick in:
- Trim winner with chest below the trim floor → bump to next size up
- Relaxed winner with chest >2" larger than reference → bump down

Score → confidence: ≤0.75 → 92%; ≤1.5 → 85%; ≤3.0 → 75%; else 62%.

### The blend

| Situation | Result |
|---|---|
| Both layers pick the same size | Highest confidence (capped 97%) |
| Crowd is strong (≥80% conf, ≥3 votes) but disagrees with measurements | Trust the crowd |
| Weak crowd disagreement | Use measurements but mention alternative |
| No crowd data (<2 votes) | Pure measurement matching |

The response includes a `source` label (`collaborative+measurement`, `collaborative`, `measurement+collab-note`, `measurement`) so the dashboard can attribute outcomes back to which signal drove the recommendation.

## Brand normalization (`brandNormalizer.ts`)

Two-stage matching when a user types a brand or product name:

1. **Exact alias lookup** in a 100+ entry dictionary (`BRAND_ALIASES` and `FIT_ALIASES`). Examples: `'h&b'`, `'h and b'`, `'holderness and bourne'` → `'Holderness & Bourne'`. `'rlx'`, `'ralph lauren'`, `'polo'` → `'Polo Ralph Lauren'`.
2. **Levenshtein-distance fuzzy match** as a fallback. If input doesn't match any alias exactly, find the closest alias key with edit distance within a threshold (1 for medium-length inputs, 2 for longer; 0 for short to avoid false positives). Catches typos like `"borne"` → `"Bourne"`, `"vinyard vines"` → `"Vineyard Vines"`.

`normalizeFit(brand, productName)` does the same two-stage match within brand-specific product-name aliases. e.g. for Holderness & Bourne, `'tailored'`, `'tailored fit'`, `'trim'`, `'trim fit'` → `'Tailored Fit Polo'`.

Normalization is applied:
- **At write time** — `routes/profiles.ts` runs both incoming brand and product name through the normalizer before insert
- **At read time** — `recommendationEngine.ts` normalizes the incoming reference brand before its SQL lookup

## Local dev environment (Mac)

### Prerequisites installed via Homebrew

```bash
brew install git node gh shopify-cli postgresql@16 postgresql@18 railway
```

Postgres versions matter:
- **`postgresql@16`** runs the local server (data lives at `/opt/homebrew/var/postgresql@16/`)
- **`postgresql@18`** is installed only for client tools (`pg_dump`, `psql`) used to talk to Railway's Postgres 18 server. `pg_dump` refuses to dump a newer server, so we need the v18 binary at `/opt/homebrew/opt/postgresql@18/bin/pg_dump` for Railway dumps.

### Local DB

```bash
brew services start postgresql@16        # auto-starts on boot too
createdb zero_returns                    # create the project's local DB
cd ~/Documents/Claude/Projects/Zero\ Returns/web
npm run migrate                          # apply migrations to local DB
```

### `web/.env` for local dev

```
DATABASE_URL=postgresql://localhost/zero_returns
JWT_SECRET=local-dev-secret-change-when-needed
PORT=3000
SHOPIFY_APP_URL=http://localhost:3000
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
VERIFY_PROXY_SIGNATURE=false
ZERO_RETURNS_CSV_URL=
```

The `.env` is gitignored. Shopify keys can stay blank unless iterating on the widget locally.

### Running locally

```bash
cd ~/Documents/Claude/Projects/Zero\ Returns/web
npm run dev
```

Server listens on `http://localhost:3000`. Open `/profile`, `/dashboard`, etc. in browser. Stop with Ctrl+C.

### Common issues

- **`EADDRINUSE: address already in use :::3000`** — a previous server is still holding the port. Fix: `lsof -ti:3000 | xargs kill -9` then restart.
- **`npm run dev` terminal won't accept new commands** — that's expected. The dev server is occupying that tab. Open a new tab (Cmd+T) for git/psql/etc.
- **JWT verification fails after switching from production to localhost** — your localStorage `zrToken` is signed with the production secret; local server has a different one. Fix: log out + log in again on localhost to get a fresh token.

## Pulling production data into local

Useful for working with real data without polluting production.

```bash
# Install Railway CLI (one-time)
brew install railway
railway login                            # browser auth as zeroreturns2026@gmail.com

# Link the project (one-time, run from the repo root)
cd ~/Documents/Claude/Projects/Zero\ Returns
railway link
# Pick: zeroreturns2026's Projects → genuine-courage → production → Postgres

# Dump production → restore into local
railway run --service Postgres bash -c '/opt/homebrew/opt/postgresql@18/bin/pg_dump "$DATABASE_PUBLIC_URL" --clean --if-exists --no-owner --no-privileges' > /tmp/zr_prod.sql
psql zero_returns < /tmp/zr_prod.sql
```

**Critical nuance:** Use `$DATABASE_PUBLIC_URL`, not `$DATABASE_URL`. The internal URL (`postgres.railway.internal`) only resolves inside Railway's network. Public URL works from your Mac.

After restore, your local DB has all production profiles + items. Stop and restart `npm run dev` if it was running before the restore.

## Railway env vars currently set

- `DATABASE_URL` — internal Postgres connection (used by deployed app)
- `DATABASE_PUBLIC_URL` — externally reachable connection string (used for `pg_dump` from your Mac)
- `JWT_SECRET` — token signing
- `NPM_CONFIG_PRODUCTION` — build flag
- 8 auto-generated Railway vars (PORT, project metadata, etc.)

**`ANTHROPIC_API_KEY` is not set and not needed.** Confirmed via grep — no Anthropic SDK references anywhere in the codebase. The "AI" is hand-coded math. Don't worry about recovering an Anthropic key from the Windows machine.

## Recent code changes (this session — Apr 29, 2026)

All shipped in two commits to `main`. Railway auto-deploys on push.

### Commit `ab30f8d` — "Fix migrate await bug, add fuzzy brand normalization + backfill"

- **`web/scripts/migrate.ts`** — was firing migrations in parallel without `await`, which caused `undefined table` errors when later migrations referenced tables from earlier ones. Fixed to `await` each migration sequentially.
- **`web/src/services/brandNormalizer.ts`** — added Levenshtein fuzzy matching as a fallback after exact-alias lookup. Catches typos.
- **`web/src/services/recommendationEngine.ts`** — added `normalizeBrand` to the incoming reference brand in `getCollaborativeSignal()` so typo'd inputs match canonical stored brands.
- **`web/scripts/backfill-normalize.ts`** — new one-time script. Re-normalizes every row in `profile_items` and `survey_items`. Idempotent — safe to re-run.
- **`web/package.json`** — registered `npm run backfill:normalize`.
- **HANDOFF.md** — initial doc.

### Commit `1971986` — "Make passport additive + per-stamp delete"

- **`web/src/routes/profiles.ts`** — `POST /api/profiles` no longer deletes existing stamps. New behavior: dedupes incoming stamps by `(profile_id, brand, product_name, size_label)`; if match → updates `fit_rating` only; if no match → inserts. Survey-table mirror is now an upsert (was insert-if-not-exists), so every save flows into the engine's data — including refinements to existing stamps.
- **`web/src/routes/profiles.ts`** — added `DELETE /api/profiles/items/:id`. Auth required. Looks up the owning profile by email (more robust than trusting `auth_users.profile_id` which can have stale linkage from imported data). Mirrors the delete to `survey_items`.
- **`web/src/profile-app.html`** — removed the `MAX_STAMPS = 5` cap. The X button now calls the DELETE endpoint for saved stamps (and just splices for unsaved ones). Stamps loaded from the server now carry their `id` so deletes have something to reference. Step-4 copy updated to "Add items you already own and love — no limit. Come back anytime to add more, and the recommendations get sharper with every stamp."

### What this gets us

- The flywheel is now fully closed: every passport save (create, update, refine fit, add new stamp) flows into both the live passport AND the recommendation engine's data.
- Consumer passports grow over time — no 5-stamp ceiling.
- Brand normalization handles real-world typos automatically.
- Existing data has been backfilled locally; production still pending (see Open Items).

## ⚠️ Urgent items

### 1. Railway trial expires ~May 17, 2026

As of April 29, 2026: ~**18 days / $4.68 credit left** before services go offline.

Options: upgrade to Hobby ($5/month), or accept the live deploy goes down and plan around it.

### 2. JWT_SECRET continuity

If the Railway service is ever rebuilt from scratch with a new `JWT_SECRET`, all existing user logins are invalidated. Worth backing up the current value somewhere safe.

### 3. Production backfill not yet run

The `npm run backfill:normalize` script was run against the local DB only. Production still has un-normalized rows like "Holderness and borne". Two options:

- **Easy**: connect to production Postgres directly via `railway run --service Postgres psql "$DATABASE_PUBLIC_URL"` and run the script logic via SQL, OR
- **Cleaner**: add a one-shot Railway job that runs `npm run backfill:normalize` against production, OR
- **Easiest right now**: temporarily point your local `web/.env` `DATABASE_URL` at `DATABASE_PUBLIC_URL`, then `npm run backfill:normalize` (which uses your local `web/.env`). Reset `.env` after.

## Known issues

### `/api/conversions` throws `function json_extract(text, unknown) does not exist`

The conversions route uses SQLite-only syntax (`json_extract`) against a Postgres database. This isn't catastrophic — it just means the dashboard's analytics tab shows empty/error states for conversion data — but should be fixed. Replace `json_extract(payload, '$.foo')` with `payload->>'foo'` (Postgres JSON operator).

### Shopify dev preview is stale

Both `app_proxy` and `sizing-widget` extensions show "Unavailable. Run dev to get previews." in the Shopify Dev Console. Last update Apr 15. To iterate: `shopify app dev` from the project folder.

### Cross-user X-button confusion (minor UX)

If a user is logged in as user A but uses "Find my passport" to look up user B's profile, the X buttons appear on B's stamps even though deleting them is server-side blocked (403). The auth guard works correctly — this is just a polish issue. Small fix: hide the X button when `loadedProfileEmail !== loggedInEmail`. Tracked but not yet shipped.

## In-flight: Factory Measurements sync system

**Status as of Apr 29, 2026 (built locally — needs `npm run migrate` + `npm run factory:sync` + commit):**

Factory measurements (manufacturer size charts) are currently **hardcoded** in `web/scripts/seed.ts` as a `REFERENCE_ITEMS` array. Adding a brand requires editing TypeScript and redeploying. Decision: replace this with a Google Sheets → published-CSV → `npm run factory:sync` pipeline, matching the pattern already used for survey data (`ZERO_RETURNS_CSV_URL`).

**Done:**
- Merged Mike's two source files (`garment_comparison.xlsx` + `golf_polo_factory_sizing_v3.xlsx`) into a single workbook: `zero-returns-sizing-master.xlsx`. Six sheets:
  1. README — overview + edit instructions
  2. **Factory Measurements** (92 rows) — `brand`, `polo_line`, `fit`, `tagged_size`, `chest_inches`, `shoulder_inches`, `length_inches`, `source`, `confidence`, `notes`. **This is the sheet the sync script will consume.**
  3. Hand Measurements (48 rows) — Mike's personal garment measurements; 30 with factory matches, 18 without (`Has Factory Spec` flags which)
  4. Brand Fit Notes — research findings + action items for unverified estimates
  5. Size Run Pivot — quick-reference P2P at each size per brand × line × fit
  6. Delta Summary — stats on hand vs factory deltas
- File uploaded to Mike's `zeroreturns2026` Google Drive and converted to a native Google Sheet: https://docs.google.com/spreadsheets/d/1QucmguNhUWmcR9NrdQaH5_9p6oI6gh63vNClT6dvoNQ

**Published CSV URL** (for reference; already wired into `web/.env`):
`https://docs.google.com/spreadsheets/d/e/2PACX-1vTDEk0FXoY-nmk35BbZs-AdYk6Q41EuXLDhcPGya99aq7tzm-7RJGIwMd7HRehX4RQDHyfwMwATcGQS/pub?gid=1028245359&single=true&output=csv`

**Built (local-only — not yet committed):**
- `web/migrations/006_nullable_reference_measurements.sql` — drops NOT NULL on `shoulder_inches` and `length_inches` so partial-spec rows can be ingested. Idempotent.
- `web/migrations/007_reference_source_column.sql` — adds `source TEXT NOT NULL DEFAULT 'factory'` to `external_reference_items` so factory vs hand measurements can be distinguished.
- `web/scripts/sync-references.ts` — fetches the published CSVs for **both** the Factory Measurements and Hand Measurements sheets, parses each, full-replaces `external_reference_items` inside one transaction. Tags rows with `source='factory'` or `source='hand'`. Builds product names as `"<Line/Model> (<Fit>)"`. Note rows in the hand sheet (analytical paragraphs) are detected and filtered silently. Hand sync is optional — runs only if `HAND_MEASUREMENTS_CSV_URL` is set.
- `web/.env` — `FACTORY_MEASUREMENTS_CSV_URL` set; `HAND_MEASUREMENTS_CSV_URL` blank (Mike to fill in after publishing the Hand Measurements tab).
- `web/.env.example` — both template entries added.
- `web/package.json` — registered `"references:sync": "tsx --no-warnings scripts/sync-references.ts"`.

**Dry-run against the local copy of the workbook:**
- Factory: 92 accepted (10 full + 82 chest-only), 0 skipped.
- Hand: 36 accepted (36 full + 0 chest-only), 12 note rows filtered silently, 0 unusable.
- Combined: **128 reference rows** ready to sync.

**Next steps for Mike (run from `~/Documents/Claude/Projects/Zero Returns/web`):**

1. **Publish the Hand Measurements tab as CSV** (mirror what you did for Factory Measurements):
   - In the Google Sheet → File → Share → Publish to web
   - First dropdown: **"Hand Measurements"**
   - Second dropdown: **Comma-separated values (.csv)**
   - Click **Publish**, copy the URL (will end in `output=csv`)
2. Paste that URL into `web/.env` as `HAND_MEASUREMENTS_CSV_URL=...` (line is already there, just blank).
3. `npm run migrate` — applies migrations 006 + 007 to the local DB.
4. `npm run references:sync` — pulls both CSVs, replaces `external_reference_items` with ~128 rows. Confirm output ends with `✓ Sync complete. external_reference_items now contains 128 rows. factory: 92, hand: 36.`
5. Verify: `psql zero_returns -c "SELECT source, COUNT(*) FROM external_reference_items GROUP BY source;"` — should show factory=92, hand=36.
6. **Add the env vars to Railway** so production can sync too:
   - Railway dashboard → `genuine-courage` project → `hey-tailor-web` service → **Variables** tab
   - Add `FACTORY_MEASUREMENTS_CSV_URL=<factory URL>`
   - Add `HAND_MEASUREMENTS_CSV_URL=<hand URL>`
   - Save (Railway redeploys automatically)
7. Commit + push:
   ```bash
   cd ~/Documents/Claude/Projects/Zero\ Returns
   git add web/migrations/006_nullable_reference_measurements.sql \
           web/migrations/007_reference_source_column.sql \
           web/scripts/sync-references.ts \
           web/.env.example web/package.json HANDOFF.md
   git commit -m "Reference measurements sync: factory + hand sources, full-replace pipeline"
   git push
   ```
   (Skip `web/.env` — it's gitignored.)
8. After Railway redeploys, run the sync against production once. Easiest method: same trick as the survey backfill — temporarily point local `web/.env`'s `DATABASE_URL` at `DATABASE_PUBLIC_URL`, run `npm run references:sync`, reset `.env`. (Or open a Railway shell and run it there.)

**(Later) Schedule it.** Once the manual flow feels right, add a Railway cron task to run `npm run references:sync` hourly.

**Why this was paused before:** Find My Size + Brand Recs depend on this data; building features on a hardcoded seed array was wasteful. Foundation first, features second.

## Find My Size + Discover Brands (consumer-facing features)

**Built same session as the sync pipeline. End-to-end now:**

### Backend
- **`web/src/routes/passportRecs.ts`** — already had `POST /api/passport/find-size` and `GET /api/passport/brand-recs`. **Now mounted in `index.ts`** at `app.use('/api/passport', passportRecsRouter)`. Endpoints are reachable.
- **`getUserReference()` rewritten with three-tier matching** so a user's stamp ("Nike, Dri-FIT Standard, M") still finds its reference row even though our stored canonical name is "Nike, Dri-FIT Standard (Slim), M":
  1. Exact: brand + product_name + size
  2. Loose: brand + size + product_name overlap (LIKE either direction). Factory rows preferred over hand rows.
  3. Fallback: brand + size only, factory preferred
- **Stamps with `fit_rating='perfect'` are preferred** as the reference (over older stamps), so recommendations are based on what actually fits the user well.
- **Engine NULL handling fixed.** `measurementMatch()` previously read `reference.shoulder_inches + offset.shoulder` directly — when shoulder was NULL, JS coerced `null + 0.25 → 0.25` and produced ~18-inch artificial penalties. Now each component (chest/shoulder/length) only contributes if both reference and candidate have a number; remaining weights are renormalized so a chest-only score is comparable to a full-measurement score (both expressed in average inches of difference, so the existing `scoreToConfidence` thresholds carry over).
- **`ExternalReferenceItem` type updated** in `web/src/types.ts` — `shoulder_inches` and `length_inches` are now `number | null`.
- The directional fit guards (trim floor, relaxed ceiling) gated on `refChest !== null` for safety.

### Frontend (`web/src/profile-app.html`)
- **Find My Size search bar** above the passport: `Find my size in another brand` heading + brand input + Find button. Visible whenever there's a context email (logged in, profile loaded via lookup, or a saved passport). Renders the recommended size big, confidence pill, fit note, and "Based on your <brand> <size> stamp" attribution. Submit on Enter.
- **Discover Brands section** appended to the success page (shown after the user saves a passport). Calls `GET /api/passport/brand-recs` and renders the top 5 brands the user doesn't own, each with recommended size + confidence + product. Empty state explains why nothing is there yet (e.g. "add a stamp for a brand we cover").
- **`setFindSizeVisibility()`** toggled from: `setLoggedIn`, `setLoggedOut`, save success, profile lookup (`fillForm`), and email-field blur.
- Styling matches the existing dark/parchment theme (`#d4c9a8` accents on `#1e3328` background).

### Files changed in this round
- `web/src/index.ts` — imported and mounted `passportRecsRouter`
- `web/src/routes/passportRecs.ts` — three-tier reference matching, perfect-fit preference, "based on" exposes the user's actual stamp text
- `web/src/services/recommendationEngine.ts` — NULL-safe measurement scoring with renormalized weights
- `web/src/types.ts` — nullable shoulder/length on `ExternalReferenceItem`
- `web/src/profile-app.html` — CSS, HTML, and JS for both feature surfaces

### What still needs to happen for Mike to see it work
1. `npm run migrate` (applies 006 + 007).
2. `npm run references:sync` (loads 128 rows from the two sheets).
3. `npm run dev` and open `http://localhost:3000/profile`.
4. Sanity test: log in / look up a profile that has stamps for one of the brands in the sheet (e.g. Peter Millar, Nike, Lululemon, Polo Ralph Lauren), then search for a different brand on the spreadsheet. Should get a size + confidence + "based on" line.
5. After saving a passport, the success page should auto-show 3-5 Discover Brands cards.
6. Commit everything (full file list in the next section).

### Known follow-ups (not blocking)
- Brand recs currently ranks purely by engine confidence ≥ 70%. With factory + hand combined giving good catalog coverage, that's fine. If too many brands qualify, consider also weighting by survey-vote count or limiting to brands with at least N sizes.
- Cross-user X-button confusion (existing minor UX issue) is unchanged.
- Schedule the references sync on Railway so production stays auto-fresh.

### Full git add for this round
```bash
git add \
  web/migrations/006_nullable_reference_measurements.sql \
  web/migrations/007_reference_source_column.sql \
  web/scripts/sync-references.ts \
  web/src/index.ts \
  web/src/routes/passportRecs.ts \
  web/src/services/recommendationEngine.ts \
  web/src/types.ts \
  web/src/profile-app.html \
  web/.env.example \
  web/package.json \
  HANDOFF.md
```

## Open questions to resolve

1. **Widget → Passport handshake.** When a shopper visits a brand's product page, does the widget auto-pull their passport (by email or persistent identifier) and use those stamps as the reference for the recommendation? Or does it ask the shopper to manually enter a brand+size each time? Worth auditing `web/src/routes/recommend.ts`, `web/src/routes/proxy.ts`, and `widget/src/Widget.tsx` to confirm the full data path.
2. **Where do factory and hand measurements come from?** Are they seed data, manual entry via admin, or imported? Look in `web/migrations/` and `web/scripts/seed.ts`.
3. **Should the Shopify app be renamed from "Hey Tailor" to "Zero Returns"?** Mostly a branding consistency call.

## Mac setup checklist (if doing this fresh again)

```bash
# 1. Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# Then run the 3 echo/eval lines brew tells you to.

# 2. Tools
brew install git node gh shopify-cli postgresql@16 postgresql@18 railway

# 3. Identity + GitHub auth
git config --global user.name "ZeroReturns2026"
git config --global user.email "zeroreturns2026@gmail.com"
gh auth login   # GitHub.com → HTTPS → Yes → web browser

# 4. Postgres + DB
brew services start postgresql@16
createdb zero_returns

# 5. Clone the repo into the Cowork-aware folder
cd ~/Documents/Claude/Projects
mv "Zero Returns/HANDOFF.md" /tmp/HANDOFF.md     # preserve the handoff if it's there
rmdir "Zero Returns" 2>/dev/null
git clone https://github.com/ZeroReturns2026/zero-returns.git "Zero Returns"
mv /tmp/HANDOFF.md "Zero Returns/HANDOFF.md" 2>/dev/null

# 6. Install deps
cd "Zero Returns"
npm run setup           # runs npm install in both web/ and widget/

# 7. Create web/.env (see "web/.env for local dev" section above)

# 8. Migrate + run
cd web
npm run migrate
npm run dev             # backend at http://localhost:3000

# 9. Optional: pull production data into local
#    See "Pulling production data into local" section above.
```

## User context

- **Mike** (zeroreturns2026@gmail.com) — founder/builder. Limited CLI/terminal experience; explain commands step-by-step. Comfortable with TypeScript code itself; newer to surrounding dev tooling. Prefers practical "let's just get it working" guidance over theory dumps.
- **Brandon Hoffman** — second profile in the system; appears to be a partner/cofounder/test user.
- **New machine:** 15-inch MacBook Air M5, 16GB RAM, 512GB. Switched off Windows because Cowork was unstable there.

## Status snapshot

- ✅ Mac dev environment is fully set up and working
- ✅ Local Postgres mirrors production (data imported via Railway CLI)
- ✅ Local backend runs cleanly on `localhost:3000`
- ✅ Brand normalization with fuzzy matching shipped to production
- ✅ Recommendation engine reads normalized brands
- ✅ Migrate.ts bug fixed (sequential await)
- ✅ Backfill script written, run locally
- ✅ Passport saves are now additive (no destructive replace)
- ✅ Per-stamp DELETE endpoint with email-based auth check shipped
- ✅ 5-stamp UI cap removed; unlimited stamps supported
- ✅ All changes committed and pushed; Railway auto-deploys
- ⚠️ Production backfill still pending
- ⚠️ Railway trial expires ~May 17 — need to upgrade or wind down
- ⚠️ `/api/conversions` SQLite-syntax bug still in production
- ⏭ Future: widget→passport handshake audit, Shopify widget local iteration, factory/hand measurement source confirmation
