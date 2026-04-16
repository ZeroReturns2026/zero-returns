# Hey Tailor — Demo Script

Use this when recording the first Loom for a pilot merchant.

## Before the recording (prep, not filmed)

1. Run `npm run migrate && npm run seed` in `web/` so the DB is fresh.
2. Make sure `web` backend is running (`npm run dev`) and `shopify app dev` tunnel is live.
3. In your dev store admin: Products → create 1-2 test products. Rename their Shopify IDs in `web/scripts/seed.ts` if you want a real PDP to map to seeded measurements, **or** use the dev shortcut below.
4. Open the dev store theme editor, add the "Hey Tailor Sizing Widget" block to the product template, save.

### Dev shortcut for PDP mapping

If you don't want to mess with real product IDs, edit `web/scripts/seed.ts` and set `shopify_product_id` on the first seeded product to a real product ID from your dev store (copy the GID from the admin URL). Re-run `npm run seed`.

## The recording (~90 seconds)

**0:00 — Intro**
> "This is Hey Tailor, a lightweight sizing recommendation app for Shopify merchants. I'm going to show the shopper-facing experience on a men's top."

**0:10 — Open a PDP**
- Navigate to the product page
- Point to the widget card: "Find My Best Size"

**0:20 — Start the flow**
- Click "Find My Size"
- Modal opens on the brand picker

**0:25 — Step 1: Brand**
- Click a brand you own (e.g. Lululemon)
- Click Next

**0:32 — Step 2: Item**
- Pick an item type (e.g. Metal Vent Tech)
- Click Next

**0:40 — Step 3: Size you wear**
- Pick the size (e.g. M)
- Click Next

**0:48 — Fit preference**
- Pick Standard
- Click "Get My Size"

**0:54 — Recommendation**
- Big size number appears with a confidence percentage
- Read the fit note aloud
- Click "Select Size [X]"
- Point out that the PDP's size selector is now set to the recommended size

**1:15 — Wrap**
> "Everything you saw is logged server-side — widget opens, recommendations shown, sizes selected — so merchants can measure real usage in week one. No checkout integration, no shopper account system, and it runs on a single Shopify theme app extension block."

## Things to have ready to show if asked

- **Events table**: `psql heytailor -c "select event_type, count(*) from events group by 1;"`
- **Recommendation engine**: open `web/src/services/recommendationEngine.ts`, show the scoring formula
- **Admin CLI**: `cd web && npm run admin`, then `list`, `show 1`, `set 1 M 41 17.75 28.5`
- **Data model**: open `web/migrations/001_init.sql`, walk through the 6 tables

## Troubleshooting during demo

- **Widget doesn't appear**: theme editor didn't save, or the app block wasn't added. Check Online Store → Themes → Customize → Product template → Add section → Apps.
- **Modal loads but brand list is empty**: backend can't reach the DB or seed didn't run. `npm run seed` again.
- **Recommendation errors out**: the seeded `shopify_product_id` doesn't match the PDP's real product ID. Update `seed.ts` and re-seed, or edit the row directly via the admin CLI.
- **App proxy returns 401**: `VERIFY_PROXY_SIGNATURE=false` in `.env` for local dev.
