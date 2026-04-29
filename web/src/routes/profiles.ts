import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../db';
import ExcelJS from 'exceljs';
import { normalizeBrand, normalizeFit } from '../services/brandNormalizer';

export const profilesRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'zero-returns-dev-secret-change-in-prod';

/**
 * Verify a Bearer token and return the auth_users row, or null if invalid.
 */
async function authedUser(req: any): Promise<any | null> {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const user = await queryOne<any>(
      `SELECT * FROM auth_users WHERE id = $1`,
      [decoded.userId]
    );
    return user || null;
  } catch {
    return null;
  }
}

/**
 * GET /profiles — List all profiles (for dashboard)
 */
profilesRouter.get('/', async (_req, res) => {
  try {
    const profiles = await query<any>(
      `SELECT * FROM shopper_profiles ORDER BY updated_at DESC`
    );

    const result = [];
    for (const p of profiles) {
      const items = await query<any>(
        `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
        [p.id]
      );
      result.push({
        id: p.id,
        email: p.email,
        firstName: p.first_name,
        lastName: p.last_name,
        height: p.height,
        weight: p.weight,
        buildType: p.build_type,
        chestMeasurement: p.chest_measurement,
        fitPreference: p.fit_preference,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        items: items.map((it: any) => ({
          brand: it.brand,
          productName: it.product_name,
          sizeLabel: it.size_label,
          fitRating: it.fit_rating,
          isPrimary: !!it.is_primary,
        })),
      });
    }

    res.json({ profiles: result, total: result.length });
  } catch (err: any) {
    console.error('[profiles]', err);
    res.status(500).json({ error: 'Failed to list profiles' });
  }
});

/**
 * GET /profiles/export — Download all profiles as .xlsx
 */
profilesRouter.get('/export', async (_req, res) => {
  try {
    const profiles = await query<any>(
      `SELECT * FROM shopper_profiles ORDER BY updated_at DESC`
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Zero Returns';
    wb.created = new Date();

    // --- Sheet 1: Profiles Overview ---
    const ws1 = wb.addWorksheet('Profiles', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws1.columns = [
      { header: 'Name', key: 'name', width: 22 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Height', key: 'height', width: 10 },
      { header: 'Weight', key: 'weight', width: 10 },
      { header: 'Build', key: 'build', width: 12 },
      { header: 'Chest', key: 'chest', width: 10 },
      { header: 'Fit Preference', key: 'fit', width: 16 },
      { header: 'Brands/Sizes', key: 'brands', width: 50 },
      { header: 'Total Stamps', key: 'stamps', width: 14 },
      { header: 'Created', key: 'created', width: 14 },
      { header: 'Updated', key: 'updated', width: 14 },
    ];

    // Header styling
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    ws1.getRow(1).eachCell(cell => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = { vertical: 'middle' };
    });
    ws1.getRow(1).height = 28;

    for (const p of profiles) {
      const items = await query<any>(
        `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
        [p.id]
      );
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Anonymous';
      const brandSizes = items.map((it: any) => {
        const fit = it.product_name ? ` (${it.product_name})` : '';
        return `${it.brand}${fit}: ${it.size_label}`;
      }).join(', ');

      ws1.addRow({
        name,
        email: p.email,
        height: p.height || '',
        weight: p.weight || '',
        build: p.build_type || '',
        chest: p.chest_measurement || '',
        fit: p.fit_preference || '',
        brands: brandSizes,
        stamps: items.length,
        created: p.created_at ? p.created_at.split('T')[0] : '',
        updated: p.updated_at ? p.updated_at.split('T')[0] : '',
      });
    }

    // Zebra striping
    for (let i = 2; i <= ws1.rowCount; i++) {
      if (i % 2 === 0) {
        ws1.getRow(i).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        });
      }
      ws1.getRow(i).eachCell(cell => {
        cell.font = { name: 'Arial', size: 10 };
      });
    }

    // --- Sheet 2: All Brand Stamps (flat list) ---
    const ws2 = wb.addWorksheet('Brand Stamps', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws2.columns = [
      { header: 'Name', key: 'name', width: 22 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Brand', key: 'brand', width: 20 },
      { header: 'Product / Fit', key: 'product', width: 30 },
      { header: 'Size', key: 'size', width: 10 },
      { header: 'Fit Rating', key: 'rating', width: 14 },
    ];

    ws2.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
      cell.alignment = { vertical: 'middle' };
    });
    ws2.getRow(1).height = 28;

    for (const p of profiles) {
      const items = await query<any>(
        `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY brand ASC`,
        [p.id]
      );
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Anonymous';
      for (const it of items) {
        ws2.addRow({
          name,
          email: p.email,
          brand: it.brand,
          product: it.product_name || '',
          size: it.size_label,
          rating: it.fit_rating ? it.fit_rating.replace(/_/g, ' ') : '',
        });
      }
    }

    for (let i = 2; i <= ws2.rowCount; i++) {
      ws2.getRow(i).eachCell(cell => {
        cell.font = { name: 'Arial', size: 10 };
      });
    }

    // --- Sheet 3: Summary Stats ---
    const ws3 = wb.addWorksheet('Summary');
    ws3.getColumn('A').width = 24;
    ws3.getColumn('B').width = 16;

    const brandCounts: Record<string, Record<string, number>> = {};
    for (const p of profiles) {
      const items = await query<any>(
        `SELECT * FROM profile_items WHERE profile_id = $1`,
        [p.id]
      );
      for (const it of items) {
        if (!brandCounts[it.brand]) brandCounts[it.brand] = {};
        const key = it.size_label;
        brandCounts[it.brand][key] = (brandCounts[it.brand][key] || 0) + 1;
      }
    }

    ws3.addRow(['Zero Returns — Profile Summary']);
    ws3.getRow(1).font = { bold: true, name: 'Arial', size: 14 };
    ws3.addRow([`Exported: ${new Date().toLocaleDateString()}`]);
    ws3.getRow(2).font = { name: 'Arial', size: 10, color: { argb: 'FF6B7280' } };
    ws3.addRow([]);
    ws3.addRow(['Total Profiles', profiles.length]);
    ws3.getRow(4).font = { bold: true, name: 'Arial', size: 11 };
    ws3.addRow([]);
    ws3.addRow(['Brand', 'Size Breakdown']);
    ws3.getRow(6).font = { bold: true, name: 'Arial', size: 11 };
    ws3.getRow(6).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });

    for (const [brand, sizes] of Object.entries(brandCounts).sort()) {
      const breakdown = Object.entries(sizes)
        .sort((a, b) => b[1] - a[1])
        .map(([size, count]) => `${size} (${count})`)
        .join(', ');
      ws3.addRow([brand, breakdown]);
      ws3.getRow(ws3.rowCount).font = { name: 'Arial', size: 10 };
    }

    // Send as download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="zero-returns-profiles-${new Date().toISOString().split('T')[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[profiles/export]', err);
    res.status(500).json({ error: 'Failed to export profiles' });
  }
});

interface ProfileBody {
  email: string;
  firstName?: string;
  lastName?: string;
  height?: string;
  weight?: string;
  buildType?: string;
  chestMeasurement?: string;
  fitPreference?: string;
  items?: Array<{
    brand: string;
    productName: string;
    sizeLabel: string;
    fitRating?: string;
    isPrimary?: boolean;
  }>;
}

/**
 * POST /profiles — Create or update a sizing profile
 */
profilesRouter.post('/', async (req, res) => {
  try {
    const body = req.body as ProfileBody;
    if (!body.email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const email = body.email.toLowerCase().trim();

    // Check if profile exists
    let profile = await queryOne<any>(
      `SELECT * FROM shopper_profiles WHERE email = $1`,
      [email]
    );

    if (profile) {
      // Update existing profile
      await query(
        `UPDATE shopper_profiles SET
          first_name = $1, last_name = $2, height = $3, weight = $4,
          build_type = $5, chest_measurement = $6, fit_preference = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE email = $8`,
        [
          body.firstName || profile.first_name,
          body.lastName || profile.last_name,
          body.height || profile.height,
          body.weight || profile.weight,
          body.buildType || profile.build_type,
          body.chestMeasurement || profile.chest_measurement,
          body.fitPreference || profile.fit_preference,
          email,
        ]
      );
    } else {
      // Create new profile
      await query(
        `INSERT INTO shopper_profiles (email, first_name, last_name, height, weight, build_type, chest_measurement, fit_preference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          email,
          body.firstName || '',
          body.lastName || '',
          body.height || '',
          body.weight || '',
          body.buildType || '',
          body.chestMeasurement || '',
          body.fitPreference || 'standard',
        ]
      );
      profile = await queryOne<any>(
        `SELECT * FROM shopper_profiles WHERE email = $1`,
        [email]
      );
    }

    // ─── Items: ADDITIVE upsert ────────────────────────────────────────
    // Preserve all stamps the user has ever added. For each incoming stamp:
    //   - if a matching (brand, product_name, size_label) row already exists
    //     for this profile, update its fit_rating (allow refinement)
    //   - otherwise insert a new row
    // Existing stamps that aren't in the request are LEFT IN PLACE — the
    // /api/profile-items/:id DELETE endpoint is the only path that removes data.
    if (body.items && body.items.length > 0) {
      for (const item of body.items) {
        if (item.brand && item.productName && item.sizeLabel) {
          const normalBrand = normalizeBrand(item.brand);
          const normalProduct = normalizeFit(normalBrand, item.productName);
          const sizeLabel = item.sizeLabel.trim().toUpperCase();

          const existing = await queryOne<any>(
            `SELECT id FROM profile_items
             WHERE profile_id = $1
               AND LOWER(brand) = LOWER($2)
               AND LOWER(product_name) = LOWER($3)
               AND LOWER(size_label) = LOWER($4)`,
            [profile.id, normalBrand, normalProduct, sizeLabel]
          );

          if (existing) {
            // Same garment — refine the fit_rating if a new one was supplied
            if (item.fitRating) {
              await query(
                `UPDATE profile_items SET fit_rating = $1 WHERE id = $2`,
                [item.fitRating, existing.id]
              );
            }
          } else {
            await query(
              `INSERT INTO profile_items (profile_id, brand, product_name, size_label, fit_rating, is_primary)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                profile.id,
                normalBrand,
                normalProduct,
                sizeLabel,
                item.fitRating || '',
                item.isPrimary ? 1 : 0,
              ]
            );
          }
        }
      }
    }

    // Return the full profile with items
    const items = await query<any>(
      `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
      [profile.id]
    );

    // ─── Mirror to survey tables (the engine reads these) ──────────────
    // Always upsert — every passport save flows into the engine's data,
    // including refinements to existing stamps. Items are deduped on
    // (respondent_id, brand, product_name, size_label) so the engine never
    // sees duplicate votes from a single shopper.
    try {
      let respondent = await queryOne<any>(
        `SELECT id FROM survey_respondents WHERE email = $1`,
        [email]
      );
      if (respondent) {
        await query(
          `UPDATE survey_respondents SET
            first_name = COALESCE(NULLIF($1, ''), first_name),
            last_name = COALESCE(NULLIF($2, ''), last_name),
            height = COALESCE(NULLIF($3, ''), height),
            weight = COALESCE(NULLIF($4, ''), weight),
            build_type = COALESCE(NULLIF($5, ''), build_type),
            chest_measurement = COALESCE(NULLIF($6, ''), chest_measurement),
            fit_preference = COALESCE(NULLIF($7, ''), fit_preference)
          WHERE id = $8`,
          [
            body.firstName || '',
            body.lastName || '',
            body.height || '',
            body.weight || '',
            body.buildType || '',
            body.chestMeasurement || '',
            body.fitPreference || '',
            respondent.id,
          ]
        );
      } else if (body.items && body.items.length > 0) {
        await query(
          `INSERT INTO survey_respondents (email, first_name, last_name, height, weight, build_type, chest_measurement, fit_preference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            email,
            body.firstName || '',
            body.lastName || '',
            body.height || '',
            body.weight || '',
            body.buildType || '',
            body.chestMeasurement || '',
            body.fitPreference || 'standard',
          ]
        );
        respondent = await queryOne<any>(
          `SELECT id FROM survey_respondents WHERE email = $1`,
          [email]
        );
      }

      if (respondent && body.items) {
        // Determine the next slot number for new items
        const maxSlotRow = await queryOne<any>(
          `SELECT COALESCE(MAX(slot), 0) AS max_slot FROM survey_items WHERE respondent_id = $1`,
          [respondent.id]
        );
        let nextSlot = (maxSlotRow?.max_slot ?? 0) + 1;

        for (const item of body.items) {
          if (item.brand && item.sizeLabel) {
            const nb = normalizeBrand(item.brand);
            const np = normalizeFit(nb, item.productName?.trim() || '');
            const sizeLabel = item.sizeLabel.trim().toUpperCase();

            const existingSurvey = await queryOne<any>(
              `SELECT id FROM survey_items
               WHERE respondent_id = $1
                 AND LOWER(brand) = LOWER($2)
                 AND LOWER(product_name) = LOWER($3)
                 AND LOWER(size_label) = LOWER($4)`,
              [respondent.id, nb, np, sizeLabel]
            );

            if (existingSurvey) {
              if (item.fitRating) {
                await query(
                  `UPDATE survey_items SET fit_rating = $1 WHERE id = $2`,
                  [item.fitRating, existingSurvey.id]
                );
              }
            } else {
              await query(
                `INSERT INTO survey_items (respondent_id, slot, brand, product_name, size_label, fit_rating)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [respondent.id, nextSlot++, nb, np, sizeLabel, item.fitRating || '']
              );
            }
          }
        }
      }
    } catch (err) {
      console.error('[profiles] survey mirror error:', err);
      // Don't fail the request — survey table sync is secondary to the passport save
    }

    res.json({
      profile: {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        height: profile.height,
        weight: profile.weight,
        buildType: profile.build_type,
        chestMeasurement: profile.chest_measurement,
        fitPreference: profile.fit_preference,
      },
      items: items.map((it: any) => ({
        id: it.id,
        brand: it.brand,
        productName: it.product_name,
        sizeLabel: it.size_label,
        fitRating: it.fit_rating,
        isPrimary: !!it.is_primary,
      })),
    });
  } catch (err: any) {
    console.error('[profiles]', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

/**
 * DELETE /profiles/items/:id — Remove a single stamp from the authenticated
 * user's passport. Also removes the matching row from survey_items so the
 * recommendation engine doesn't keep reading deleted data.
 *
 * Header: Authorization: Bearer <token>
 */
profilesRouter.delete('/items/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    if (!Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    const user = await authedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find the profile that belongs to this user. Prefer email match
    // (more robust than auth_users.profile_id which can be stale or null
    // if data was imported from elsewhere with a broken FK).
    const ownerProfile = await queryOne<any>(
      `SELECT id FROM shopper_profiles WHERE LOWER(email) = LOWER($1)`,
      [user.email]
    );
    if (!ownerProfile) {
      return res.status(404).json({ error: 'No profile for this user' });
    }

    // Look up the item, verify it belongs to this user's profile
    const item = await queryOne<any>(
      `SELECT * FROM profile_items WHERE id = $1`,
      [itemId]
    );
    if (!item) {
      return res.status(404).json({ error: 'Stamp not found' });
    }
    if (item.profile_id !== ownerProfile.id) {
      return res.status(403).json({ error: 'Not your stamp' });
    }

    // Delete from profile_items
    await query(`DELETE FROM profile_items WHERE id = $1`, [itemId]);

    // Mirror the delete to survey_items so the engine forgets it too
    try {
      const profile = await queryOne<any>(
        `SELECT email FROM shopper_profiles WHERE id = $1`,
        [item.profile_id]
      );
      if (profile?.email) {
        const respondent = await queryOne<any>(
          `SELECT id FROM survey_respondents WHERE email = $1`,
          [profile.email]
        );
        if (respondent) {
          await query(
            `DELETE FROM survey_items
             WHERE respondent_id = $1
               AND LOWER(brand) = LOWER($2)
               AND LOWER(product_name) = LOWER($3)
               AND LOWER(size_label) = LOWER($4)`,
            [respondent.id, item.brand, item.product_name, item.size_label]
          );
        }
      }
    } catch (err) {
      console.error('[profiles] survey delete mirror error:', err);
      // Don't fail the request — primary delete already succeeded
    }

    res.json({ ok: true, deletedId: itemId });
  } catch (err: any) {
    console.error('[profiles/items DELETE]', err);
    res.status(500).json({ error: 'Failed to delete stamp' });
  }
});

/**
 * GET /profiles/:email — Look up a profile by email
 */
profilesRouter.get('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase().trim();
    const profile = await queryOne<any>(
      `SELECT * FROM shopper_profiles WHERE email = $1`,
      [email]
    );

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const items = await query<any>(
      `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
      [profile.id]
    );

    res.json({
      profile: {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        height: profile.height,
        weight: profile.weight,
        buildType: profile.build_type,
        chestMeasurement: profile.chest_measurement,
        fitPreference: profile.fit_preference,
      },
      items: items.map((it: any) => ({
        id: it.id,
        brand: it.brand,
        productName: it.product_name,
        sizeLabel: it.size_label,
        fitRating: it.fit_rating,
        isPrimary: !!it.is_primary,
      })),
    });
  } catch (err: any) {
    console.error('[profiles]', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});
