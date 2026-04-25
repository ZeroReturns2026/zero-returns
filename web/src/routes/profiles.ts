import { Router } from 'express';
import { query, queryOne } from '../db';
import ExcelJS from 'exceljs';
import { normalizeBrand, normalizeFit } from '../services/brandNormalizer';

export const profilesRouter = Router();

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

    // Update items if provided
    if (body.items && body.items.length > 0) {
      // Clear existing items and re-insert
      await query(`DELETE FROM profile_items WHERE profile_id = $1`, [profile.id]);

      for (const item of body.items) {
        if (item.brand && item.productName && item.sizeLabel) {
          const normalBrand = normalizeBrand(item.brand);
          await query(
            `INSERT INTO profile_items (profile_id, brand, product_name, size_label, fit_rating, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              profile.id,
              normalBrand,
              normalizeFit(normalBrand, item.productName),
              item.sizeLabel.trim().toUpperCase(),
              item.fitRating || '',
              item.isPrimary ? 1 : 0,
            ]
          );
        }
      }
    }

    // Return the full profile with items
    const items = await query<any>(
      `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
      [profile.id]
    );

    // Also feed into survey_items for collaborative filtering
    try {
      const surveyRespondent = await queryOne<any>(
        `SELECT id FROM survey_respondents WHERE email = $1`,
        [email]
      );
      if (!surveyRespondent && body.items && body.items.length > 0) {
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
        const newResp = await queryOne<any>(
          `SELECT id FROM survey_respondents WHERE email = $1`,
          [email]
        );
        if (newResp) {
          for (let i = 0; i < body.items.length; i++) {
            const item = body.items[i];
            if (item.brand && item.sizeLabel) {
              const nb = normalizeBrand(item.brand);
              await query(
                `INSERT INTO survey_items (respondent_id, slot, brand, product_name, size_label, fit_rating)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [newResp.id, i + 1, nb, normalizeFit(nb, item.productName?.trim() || ''), item.sizeLabel.trim().toUpperCase(), item.fitRating || '']
              );
            }
          }
        }
      }
    } catch (_) {
      // Survey tables might not exist — that's OK
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
