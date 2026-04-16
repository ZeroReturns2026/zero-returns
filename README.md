# Hey Tailor

A narrow MVP Shopify app that shows a sizing widget on product pages, asks a shopper 2-3 questions, and returns a recommended size with a confidence score.

**Scope:** Men's tops, 10-20 SKUs, one merchant, no checkout integration.

---

## What's in the box

```
hey-tailor/
├── web/                    Node.js + TypeScript backend (Express + SQLite)
│   ├── src/                Routes, services, recommendation engine
│   ├── migrations/         SQL schema
│   └── scripts/            migrate.ts, seed.ts
├── widget/                 React widget (Vite build) embedded in theme extension
├── extensions/
│   └── sizing-widget/      Shopify theme app extension (app block for PDP)
├── shopify.app.toml        Shopify app config
└── docs/DEMO.md            Loom/demo script
```

> **Database:** SQLite via Node 22's built-in `node:sqlite`. No database to install. The backend creates `web/data/hey-tailor.db` automatically on first run.

## High-level flow

1. Merchant installs Hey Tailor on their dev store
2. Merchant adds the "Hey Tailor Sizing Widget" app block to their product template
3. Shopper lands on a PDP and sees "Find My Best Size"
4. Shopper clicks, answers 3 questions in a modal (brand, item type, size)
5. Widget POSTs to the backend through the Shopify app proxy
6. Backend scores every available size for the PDP's product and returns the best match + confidence
7. Widget shows the result and offers a CTA that selects the recommended size

---

## From zero: full setup

### 0. Prerequisites

Install these on your machine:

- **Node.js 22.5 or newer** (required for built-in SQLite). Check with `node --version`. If older, update via [nodejs.org](https://nodejs.org) or `nvm install 22`.
- Shopify CLI 3.x (`npm install -g @shopify/cli @shopify/theme`)
- A free Shopify Partners account: https://partners.shopify.com
- A development store inside your Partners account

No Postgres or Docker needed — the backend uses Node's built-in SQLite and stores data in a single file at `web/data/hey-tailor.db`.

### 1. Create the Partners account + dev store

1. Go to https://partners.shopify.com and sign up (free)
2. In the Partners dashboard, **Stores → Add store → Development store**. Pick "Create a store to test and build"
3. Store purpose: "To test an app or theme I'm building"
4. Give it a name like `hey-tailor-dev`. You'll get a URL like `hey-tailor-dev.myshopify.com`

### 2. Clone / unzip this project

```bash
cd ~/Desktop/hey-tailor
```

### 3. Configure environment variables

Copy `.env.example` to `.env` in the `web/` folder:

```bash
cd web
cp .env.example .env
```

The defaults work out of the box. You'll come back to fill in `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` after step 5.

```
DB_PATH=./data/hey-tailor.db
PORT=3000
SHOPIFY_APP_URL=http://localhost:3000
SHOPIFY_API_KEY=           # fill in after step 5
SHOPIFY_API_SECRET=        # fill in after step 5
VERIFY_PROXY_SIGNATURE=false
```

### 5. Create the Shopify app

From the project root:

```bash
shopify app dev
```

First run, the CLI will:
- Ask you to log in to Shopify
- Ask which Partners organization to use
- Ask to create a new app — say yes, name it "Hey Tailor"
- Ask which store to install to — pick your dev store
- Open a tunnel (ngrok-like) and print a URL

Copy the API key + secret that the CLI generates into `web/.env`.

### 6. Install backend deps + run migrations + seed

From the project root:

```bash
npm run setup      # installs web/ and widget/ deps
npm run db:migrate # creates data/hey-tailor.db
npm run db:seed    # loads 1 merchant + 15 products + 26 reference items
```

You should see:

```
✓ 001_init.sql applied
Migrations complete.
✓ Seeded 1 merchant, 15 products, 60 sizes, 26 reference items
```

### 7. Build the widget

```bash
npm run widget:build
```

This runs Vite and copies `sizing-widget.js` + `sizing-widget.css` into `extensions/sizing-widget/assets/` where the theme extension picks it up.

### 8. Start the backend

```bash
npm run backend
```

Backend runs on http://localhost:3000. Hit `http://localhost:3000/` in a browser — you should see `{"service":"hey-tailor","status":"ok"}`.

You can also smoke-test the recommendation engine without Shopify:

```bash
curl -s -X POST http://localhost:3000/api/recommend \
  -H 'content-type: application/json' \
  -d '{"shopDomain":"hey-tailor-dev.myshopify.com","shopifyProductId":"gid://shopify/Product/1001","referenceItemId":8,"fitPreference":"standard"}'
```

### 9. Start the Shopify app dev loop

In a separate terminal, from project root:

```bash
shopify app dev
```

This:
- Tunnels your local backend to a public URL
- Syncs your `shopify.app.toml` config
- Enables the theme extension on your dev store

### 10. Add the widget to a product page

1. In your dev store admin, go to **Online Store → Themes → Customize**
2. Navigate to a product page
3. Click **Add section → Apps → Hey Tailor Sizing Widget**
4. Drag it next to the default size selector
5. Save

### 11. Test

1. Visit any product page on your dev store
2. You should see "Find My Best Size"
3. Click, answer the 3 questions, and see the recommendation

---

## Recommendation engine

For men's tops we score every available size on the current product against a reference item the shopper says fits them well.

```
score = |chest_diff| * 0.5 + |shoulder_diff| * 0.3 + |length_diff| * 0.2
```

Lower is better. We return the size with the lowest score, plus a confidence bucket:

| Score     | Confidence |
|-----------|------------|
| ≤ 0.75"   | 90-95      |
| ≤ 1.5"    | 80-89      |
| ≤ 3.0"    | 70-79      |
| > 3.0"    | < 70       |

The engine lives in `web/src/services/recommendationEngine.ts`.

## Data model

Tables defined in `web/migrations/001_init.sql`:

- **merchants** — one row per Shopify store
- **products** — merchant's SKUs we recommend on
- **product_sizes** — chest/shoulder/length per size per product
- **external_reference_items** — "I wear a Lululemon Metal Vent Tech in M" reference measurements
- **closet_reports** — customer-reported garments pulled from the Zero Returns Google Sheet
- **fit_profiles** — stubbed for future, one row per shopper
- **events** — widget_open, recommendation_requested, recommendation_shown, recommended_size_clicked, add_to_cart_after_recommendation

## Zero Returns sheet sync

Hey Tailor's reference pool grows from real customer data. Zero Returns is a separate form where customers tell us what's in their closet (brand, product, size, fit rating). Those submissions land in a Google Sheet, and Hey Tailor pulls them into `closet_reports` on demand.

### One-time setup

1. Open the Zero Returns Google Sheet
2. **File → Share → Publish to web**
3. Under "Link": pick the whole document (or the submissions tab), format **Comma-separated values (.csv)**
4. Click **Publish**, then copy the generated URL
5. Paste it into `web/.env` as `ZERO_RETURNS_CSV_URL=…`

> The sheet is published read-only and the URL is effectively a long random token — only someone with the URL can fetch it. Unpublish any time via the same menu.

### Running a sync

```bash
npm run sync
```

What it does:

- Fetches the CSV
- Pattern-matches `Garment N <Brand|Product|Size|Fit>` headers, so the form can add/remove garment slots without breaking sync
- Deduplicates on `timestamp + email + brand + product + size`, so re-running is safe
- Normalizes fit ratings into `perfect` / `too_small` / `too_big` / raw text
- Prints a summary of the top reported items that don't yet have measurements in the reference table

### Turning reports into usable references

Reports on their own are just signal — the recommender needs **measurements** before it can use a new brand/product. Workflow:

```bash
npm run admin
> reports                            # see what's most reported + fit distribution
> promote "Rhone" "Commuter Polo" L polo 43 18.5 29.5
  ✓ promoted "Rhone — Commuter Polo (L)" as polo. 3 closet report(s) now back this reference.
```

Item types: `tshirt | polo | oxford | performance_tee | henley`. Chest / shoulder / length are in inches — grab them from the brand's size chart.

Once promoted, the item is immediately available in every shopper's brand/product picker.

## Admin utility

For v1 there's no web admin UI. Product measurements are edited by running:

```bash
cd web
npm run admin
```

This opens a minimal CLI that lets you list products, show their sizes, and update individual measurements. See `web/scripts/admin.ts`.

For quick bulk edits, edit `web/scripts/seed.ts` directly and re-run `npm run seed` (it truncates and reloads).

## API surface

All storefront calls go through the Shopify app proxy at `/apps/hey-tailor/*` which forwards to the backend.

| Route                                  | Method | Purpose                          |
|----------------------------------------|--------|----------------------------------|
| `/apps/hey-tailor/reference-items`     | GET    | List of brands + items for step 1-2 |
| `/apps/hey-tailor/recommend`           | POST   | Score sizes, return recommendation |
| `/apps/hey-tailor/events`              | POST   | Log widget/recommendation events |

## Non-goals for v1

- No checkout extension
- No full catalog sync — products are seeded manually
- No accuracy guarantees
- No full category support — men's tops only

---

## Next steps after the MVP demo works

- Pull real product measurements from Shopify Admin API instead of seeding
- Add a merchant admin UI for editing measurements without touching the DB
- Add category coverage (bottoms, outerwear)
- Persist shopper `fit_profile` so they don't re-answer on every PDP
- Build a simple dashboard for event analytics
