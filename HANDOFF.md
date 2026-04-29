# Zero Returns — Project Handoff

Paste this into a new chat and say "this is where we are — let's pick up."

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
                                      │
                                      ↓
   ┌─────────────────────────────────────────────────────────────┐
   │   Railway-hosted Node/TypeScript backend                    │
   │   hey-tailor-web-production.up.railway.app                  │
   │                                                             │
   │   API endpoints:                                            │
   │     POST /api/auth/register     POST /api/auth/login        │
   │     GET  /api/auth/me           POST /api/profiles          │
   │     GET  /api/profiles/:email   GET  /api/profiles/export   │
   │     GET  /api/conversions       GET  /api/profiles          │
   │                                                             │
   │   Sizing engine: passports + factory + hand → confidence    │
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

- **Language:** TypeScript
- **Frontend:** Server-rendered HTML pages with inline vanilla JS (no React/Vue). Chart.js is used on the merchant dashboard for daily-activity line charts and a doughnut for size distribution.
- **Backend:** Node + TypeScript REST API
- **Database:** Postgres on Railway, with persistent volume
- **Auth:** JWT-based for consumers (email + password). Token stored in `localStorage` as `zrToken`. Anonymous email-only lookups are also supported via `GET /api/profiles/:email`.
- **AI:** Anthropic API (Claude) — intended for confidence scoring / recommendations. **`ANTHROPIC_API_KEY` is currently NOT set in Railway env vars**, suggesting the AI layer may not yet be wired in production. Likely lives only in local `.env`.
- **Distribution:** Shopify custom app (not a public Shopify App Store listing) — installed manually on brand stores
- **Charts:** Chart.js (CDN-loaded on dashboard)

## Where everything lives

| Thing | Location |
|---|---|
| GitHub repo | `ZeroReturns2026/zero-returns` |
| Production branch | `main` |
| Railway-deployed code root | `/web` (subfolder of the repo — files like `profiles.ts`, `db.ts`, `migrate.ts`, `dashboard.html` live here) |
| Shopify app code | **Unconfirmed** — likely a sibling folder in the same repo (e.g., `app/`, `extensions/`, or `shopify-app/`) or a separate repo. Worth checking once on the Mac. |
| Railway workspace | `genuine-courage` |
| Railway project | `genuine-courage` |
| Railway app service | `hey-tailor-web` |
| Live base URL | https://hey-tailor-web-production.up.railway.app |
| Consumer passport | https://hey-tailor-web-production.up.railway.app/profile |
| Merchant dashboard | https://hey-tailor-web-production.up.railway.app/dashboard |
| Shopify dev store admin | https://admin.shopify.com/store/zeroreturns |
| Shopify dev store storefront | https://zeroreturns.myshopify.com (password-protected; needs unlock to go live) |
| Shopify app in dev store | "Hey Tailor" — admin → Apps → Hey Tailor |
| Shopify account email | zeroreturns2026@gmail.com |

## Shopify integration details

The custom Shopify app **"Hey Tailor"** has two extensions wired up:

| Extension | Type | What it does |
|---|---|---|
| `sizing-widget` | Theme App Extension | Renders inside a brand's Shopify storefront via a theme block. Shoppers see this on product pages. |
| `app_proxy` | App Proxy | Routes storefront requests through Shopify back to the Railway backend. Keeps the backend URL hidden and lets Shopify authenticate the request. |

**Status:** Both extensions show "Unavailable. Run dev to get previews." in the Dev Console. Last app update was **April 15, 2026 at 10:39 PM**. To iterate on the widget, run `shopify app dev` from inside the Shopify app folder once on the Mac.

**Dev store inventory** (test products for the widget):
- The Rodgers Quarter-Zip
- The Yale Polo
- The Perkins Polo (id: 8247778803756)

## Data model (consumer side)

A **Profile** has:
- `firstName`, `lastName`, `email` (email is required and serves as the cross-store identifier)
- `height` (e.g. `5'10"`), `weight`, `buildType` (`slim` / `athletic` / `average` / `broad`), `chestMeasurement` (optional, in inches)
- `fitPreference` (`trim` / `standard` / `relaxed`)

A profile has up to **5 Items** ("stamps"), each with:
- `brand` (free text — the user types it)
- `productName` (free text; defaults to "{Brand} Polo" if left blank)
- `sizeLabel` (`XS` / `S` / `M` / `L` / `XL` / `XXL`)
- `fitRating` (`too_tight` / `slightly_snug` / `perfect` / `slightly_loose` / `too_loose`)
- `isPrimary` (first stamp is marked primary)

The 5-stamp cap is a deliberate constraint — the UI says "Maximum 5 stamps per passport."

## API surface (confirmed via the live `/profile` page)

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Create account (email, password, firstName, lastName) | None |
| POST | `/api/auth/login` | Login → returns `{ token, user, profile, items }` | None |
| GET | `/api/auth/me` | Get current user | Bearer token |
| POST | `/api/profiles` | Create or update passport (full profile + items array) | Optional Bearer |
| GET | `/api/profiles/:email` | Public lookup by email | None |
| GET | `/api/profiles` | List all profiles (merchant dashboard) | (Likely admin/internal) |
| GET | `/api/profiles/export` | Excel export of all profiles | (Likely admin/internal) |
| GET | `/api/conversions` | Funnel data for merchant dashboard | (Likely admin/internal) |

The merchant dashboard also expects `/api/conversions` to return `{ funnel, rates, daily, products, size_distribution, recent_events }`. Funnel events tracked: `recommendation_shown`, `add_to_cart_after_recommendation`, `purchase_completed`, `return_initiated`.

## Railway env vars currently set

- `DATABASE_URL` — Postgres connection (Railway auto-managed)
- `JWT_SECRET` — token signing for the auth flow above
- `NPM_CONFIG_PRODUCTION` — build flag
- 8 auto-generated Railway vars (PORT, project metadata, etc.)

**Notably missing: `ANTHROPIC_API_KEY`** — see urgent items.

## ⚠️ Urgent items

### 1. ANTHROPIC_API_KEY is NOT in Railway

Most likely it lives in `web/.env` on the Windows machine. Before retiring that machine:
- Find `web/.env` (hidden file — show hidden files in File Explorer)
- Copy contents to a password manager / secure note
- Grep the source for `sk-ant-` to confirm it's not hardcoded anywhere
- Recreate `web/.env` on the Mac
- If production needs Claude calls (likely — for confidence scoring), add `ANTHROPIC_API_KEY` to Railway's Variables tab

### 2. Railway trial expires ~May 17, 2026

As of April 29, 2026: **18 days / $4.68 credit left** before services go offline.

Options: upgrade to Hobby ($5/month), or accept the live deploy goes down and plan around it.

### 3. JWT_SECRET continuity

If the Railway service is ever rebuilt from scratch with a new `JWT_SECRET`, all existing user logins are invalidated. Worth backing up the current value somewhere safe alongside the Anthropic key.

## Mac setup checklist (step-by-step)

User is newer to terminal/CLI — explain commands, don't assume `cd`/`git`/shell familiarity.

1. Install **Homebrew** (Mac package manager): paste install line from https://brew.sh
2. Install **Node.js**: `brew install node` (provides `node` and `npm`)
3. Install **Git**: `brew install git` (often already present)
4. Install **GitHub CLI**: `brew install gh` then `gh auth login`
5. Install **Railway CLI**: `brew install railway` then `railway login`
6. Install **Shopify CLI**: `brew install shopify-cli` (needed to run `shopify app dev` for the widget)
7. Install **VS Code**: `brew install --cask visual-studio-code`
8. Install **Claude Code**: see https://docs.claude.com
9. Clone the repo:
   ```bash
   cd ~/Documents
   git clone https://github.com/ZeroReturns2026/zero-returns.git
   cd zero-returns
   ```
10. Inspect repo structure: `ls -la` (look for `web/`, plus any `app/`, `extensions/`, `shopify-app/`, etc. that holds the Shopify code)
11. Web backend: `cd web && npm install`
12. Recreate `web/.env` with `ANTHROPIC_API_KEY`, `JWT_SECRET`, `DATABASE_URL` (point to local Postgres or use Railway's), and anything else that was in the Windows version
13. Run web locally: check `package.json` for the dev script — likely `npm run dev`
14. If the Shopify app code is in this repo, `cd` into that folder and run `npm install`, then `shopify app dev` to start local widget previews
15. Verify Railway from new machine: `railway status` from inside the repo

## User context

- **Mike** — limited CLI/terminal experience; walk through commands step-by-step
- Comfortable with the TypeScript code itself; newer to surrounding dev tooling
- Prefers practical "let's just get it working" guidance over theory dumps
- New machine: 15-inch MacBook Air M5, 16GB RAM, 512GB

## Cowork-on-Windows pain (historical — for context only)

Switched off Windows because Cowork kept hitting "exited with code 1" errors and a "two separate profiles" bug. Should not follow to Mac.

## Status snapshot

- ✅ Railway deploy is live; consumer `/profile` and merchant `/dashboard` both functional
- ✅ GitHub repo wired to Railway with auto-deploy on `main`
- ✅ Postgres + persistent volume on Railway
- ✅ Shopify dev store (`zeroreturns`) created with 3 test products (golfleisure polos)
- ✅ Custom Shopify app "Hey Tailor" installed in dev store with `sizing-widget` Theme App Extension and `app_proxy`
- ⚠️ Anthropic API key needs to be retrieved from Windows `web/.env` before that machine goes away
- ⚠️ Railway trial expires ~May 17, 2026 — decide on upgrade
- ⚠️ Shopify app dev previews are stale (last update Apr 15) — need to run `shopify app dev` from the Mac to iterate
- ⚠️ Storefront is password-locked — fine for now; will need to unlock when going to a real customer
- ⏭ Mac onboarding next

## Open questions to resolve early on the Mac

1. **Where does the Shopify app code live?** Same repo as `web/`? A sibling folder? Separate repo? `git ls-files` from the repo root will show.
2. **Is Claude actually wired up to the recommendation engine yet, or is it stubbed/rules-based?** Search for `anthropic`, `Claude`, or `claude-` in the source — that'll tell you whether the AI layer is real or planned.
3. **What's the source of "factory measurements" and "hand measurements"?** A seed script? A spreadsheet? Manual entry? Look in `migrate.ts` and any seed/fixture files.
4. **Is the Hey Tailor app published anywhere besides the dev store?** Or is each brand install a manual custom-distribution flow? Check the Shopify Partners dashboard.
