import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../db';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'zero-returns-dev-secret-change-in-prod';
const JWT_EXPIRES_IN = '30d'; // Stay logged in for 30 days

interface AuthUser {
  id: number;
  email: string;
  password_hash: string;
  profile_id: number | null;
  created_at: string;
  last_login_at: string | null;
}

/**
 * POST /auth/register
 * Body: { email, password, firstName?, lastName? }
 */
authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existing = await queryOne<AuthUser>(
      `SELECT * FROM auth_users WHERE email = $1`,
      [normalEmail]
    );
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    // Check if a shopper_profile already exists for this email (from passport)
    let profile = await queryOne<any>(
      `SELECT * FROM shopper_profiles WHERE email = $1`,
      [normalEmail]
    );

    if (!profile) {
      // Create a new profile
      await query(
        `INSERT INTO shopper_profiles (email, first_name, last_name, fit_preference)
         VALUES ($1, $2, $3, $4)`,
        [normalEmail, firstName || '', lastName || '', 'standard']
      );
      profile = await queryOne<any>(
        `SELECT * FROM shopper_profiles WHERE email = $1`,
        [normalEmail]
      );
    }

    // Create auth user linked to profile
    await query(
      `INSERT INTO auth_users (email, password_hash, profile_id)
       VALUES ($1, $2, $3)`,
      [normalEmail, passwordHash, profile.id]
    );

    const user = await queryOne<AuthUser>(
      `SELECT * FROM auth_users WHERE email = $1`,
      [normalEmail]
    );

    // Generate JWT
    const token = jwt.sign(
      { userId: user!.id, email: normalEmail, profileId: profile.id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Load profile items
    const items = await query<any>(
      `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
      [profile.id]
    );

    res.status(201).json({
      token,
      user: {
        id: user!.id,
        email: normalEmail,
        profileId: profile.id,
      },
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
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /auth/login
 * Body: { email, password }
 */
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalEmail = email.toLowerCase().trim();

    const user = await queryOne<AuthUser>(
      `SELECT * FROM auth_users WHERE email = $1`,
      [normalEmail]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await query(
      `UPDATE auth_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    );

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: normalEmail, profileId: user.profile_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Load profile + items
    const profile = await queryOne<any>(
      `SELECT * FROM shopper_profiles WHERE id = $1`,
      [user.profile_id]
    );

    const items = profile ? await query<any>(
      `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
      [profile.id]
    ) : [];

    res.json({
      token,
      user: {
        id: user.id,
        email: normalEmail,
        profileId: user.profile_id,
      },
      profile: profile ? {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        height: profile.height,
        weight: profile.weight,
        buildType: profile.build_type,
        chestMeasurement: profile.chest_measurement,
        fitPreference: profile.fit_preference,
      } : null,
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
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /auth/me
 * Header: Authorization: Bearer <token>
 * Returns the current user's profile and items
 */
authRouter.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const token = authHeader.split(' ')[1];
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await queryOne<AuthUser>(
      `SELECT * FROM auth_users WHERE id = $1`,
      [decoded.userId]
    );
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const profile = await queryOne<any>(
      `SELECT * FROM shopper_profiles WHERE id = $1`,
      [user.profile_id]
    );

    const items = profile ? await query<any>(
      `SELECT * FROM profile_items WHERE profile_id = $1 ORDER BY is_primary DESC, id ASC`,
      [profile.id]
    ) : [];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        profileId: user.profile_id,
      },
      profile: profile ? {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        height: profile.height,
        weight: profile.weight,
        buildType: profile.build_type,
        chestMeasurement: profile.chest_measurement,
        fitPreference: profile.fit_preference,
      } : null,
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
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});
