/**
 * User authentication and API key management routes
 */
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { PostgresAuthStore } from '../pg-auth-store.js';
const { Pool } = pg;
const BCRYPT_ROUNDS = 12;
/**
 * Validate email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
/**
 * Validate password strength
 */
function isValidPassword(password) {
    return password.length >= 8;
}
/**
 * JWT authentication middleware
 */
function jwtAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({
                error: 'missing_token',
                message: 'JWT token required. Provide via Authorization: Bearer <token>',
            });
            return;
        }
        const token = authHeader.slice(7);
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            throw new Error('JWT_SECRET environment variable not configured');
        }
        const payload = jwt.verify(token, jwtSecret);
        // Attach user info to request
        req.user = payload;
        next();
    }
    catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            res.status(401).json({
                error: 'invalid_token',
                message: 'Invalid or expired JWT token',
            });
            return;
        }
        res.status(500).json({
            error: 'auth_error',
            message: 'Authentication failed',
        });
    }
}
/**
 * Create user routes
 */
export function createUserRouter() {
    const router = Router();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
    /**
     * POST /v1/auth/register
     * Register a new user and create their first API key
     */
    router.post('/v1/auth/register', async (req, res) => {
        try {
            const { email, password } = req.body;
            // Input validation
            if (!email || !password) {
                res.status(400).json({
                    error: 'missing_fields',
                    message: 'Email and password are required',
                });
                return;
            }
            if (!isValidEmail(email)) {
                res.status(400).json({
                    error: 'invalid_email',
                    message: 'Invalid email format',
                });
                return;
            }
            if (!isValidPassword(password)) {
                res.status(400).json({
                    error: 'weak_password',
                    message: 'Password must be at least 8 characters',
                });
                return;
            }
            // Hash password
            const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            // Create user
            const userResult = await pool.query(`INSERT INTO users (email, password_hash, tier, monthly_limit, rate_limit)
        VALUES ($1, $2, 'free', 500, 10)
        RETURNING id, email, tier, monthly_limit, rate_limit, created_at`, [email, passwordHash]);
            const user = userResult.rows[0];
            // Generate API key
            const apiKey = PostgresAuthStore.generateApiKey();
            const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            const keyPrefix = PostgresAuthStore.getKeyPrefix(apiKey);
            // Store API key
            await pool.query(`INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
        VALUES ($1, $2, $3, 'Default')`, [user.id, keyHash, keyPrefix]);
            res.status(201).json({
                user: {
                    id: user.id,
                    email: user.email,
                    tier: user.tier,
                    monthlyLimit: user.monthly_limit,
                    rateLimit: user.rate_limit,
                    createdAt: user.created_at,
                },
                apiKey, // SECURITY: Only returned once, never stored or shown again
            });
        }
        catch (error) {
            if (error.code === '23505') { // Unique violation
                res.status(409).json({
                    error: 'email_exists',
                    message: 'Email already registered',
                });
                return;
            }
            console.error('Registration error:', error);
            res.status(500).json({
                error: 'registration_failed',
                message: 'Failed to register user',
            });
        }
    });
    /**
     * POST /v1/auth/login
     * Login with email/password and get JWT token
     */
    router.post('/v1/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                res.status(400).json({
                    error: 'missing_fields',
                    message: 'Email and password are required',
                });
                return;
            }
            // Get user
            const result = await pool.query('SELECT id, email, password_hash, tier FROM users WHERE email = $1', [email]);
            if (result.rows.length === 0) {
                res.status(401).json({
                    error: 'invalid_credentials',
                    message: 'Invalid email or password',
                });
                return;
            }
            const user = result.rows[0];
            // Verify password
            const passwordValid = await bcrypt.compare(password, user.password_hash);
            if (!passwordValid) {
                res.status(401).json({
                    error: 'invalid_credentials',
                    message: 'Invalid email or password',
                });
                return;
            }
            // Generate JWT
            const jwtSecret = process.env.JWT_SECRET;
            if (!jwtSecret) {
                throw new Error('JWT_SECRET not configured');
            }
            const token = jwt.sign({
                userId: user.id,
                email: user.email,
                tier: user.tier,
            }, jwtSecret, { expiresIn: '30d' });
            res.json({
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    tier: user.tier,
                },
            });
        }
        catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                error: 'login_failed',
                message: 'Failed to login',
            });
        }
    });
    /**
     * GET /v1/me
     * Get current user profile and usage
     */
    router.get('/v1/me', jwtAuth, async (req, res) => {
        try {
            const { userId } = req.user;
            const result = await pool.query(`SELECT 
          u.id, u.email, u.tier, u.monthly_limit, u.rate_limit, u.created_at,
          u.stripe_customer_id, u.stripe_subscription_id
        FROM users u
        WHERE u.id = $1`, [userId]);
            if (result.rows.length === 0) {
                res.status(404).json({
                    error: 'user_not_found',
                    message: 'User not found',
                });
                return;
            }
            const user = result.rows[0];
            res.json({
                id: user.id,
                email: user.email,
                tier: user.tier,
                monthlyLimit: user.monthly_limit,
                rateLimit: user.rate_limit,
                createdAt: user.created_at,
                hasStripe: !!user.stripe_customer_id,
            });
        }
        catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({
                error: 'profile_failed',
                message: 'Failed to get profile',
            });
        }
    });
    /**
     * POST /v1/keys
     * Create a new API key
     */
    router.post('/v1/keys', jwtAuth, async (req, res) => {
        try {
            const { userId } = req.user;
            const { name } = req.body;
            // Generate API key
            const apiKey = PostgresAuthStore.generateApiKey();
            const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            const keyPrefix = PostgresAuthStore.getKeyPrefix(apiKey);
            // Store API key
            const result = await pool.query(`INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
        VALUES ($1, $2, $3, $4)
        RETURNING id, key_prefix, name, created_at`, [userId, keyHash, keyPrefix, name || 'Unnamed Key']);
            const key = result.rows[0];
            res.status(201).json({
                id: key.id,
                key: apiKey, // SECURITY: Only returned once
                prefix: key.key_prefix,
                name: key.name,
                createdAt: key.created_at,
            });
        }
        catch (error) {
            console.error('Create key error:', error);
            res.status(500).json({
                error: 'key_creation_failed',
                message: 'Failed to create API key',
            });
        }
    });
    /**
     * GET /v1/keys
     * List user's API keys (prefix only, never full key)
     */
    router.get('/v1/keys', jwtAuth, async (req, res) => {
        try {
            const { userId } = req.user;
            const result = await pool.query(`SELECT id, key_prefix, name, is_active, created_at, last_used_at
        FROM api_keys
        WHERE user_id = $1
        ORDER BY created_at DESC`, [userId]);
            res.json({
                keys: result.rows.map(key => ({
                    id: key.id,
                    prefix: key.key_prefix,
                    name: key.name,
                    isActive: key.is_active,
                    createdAt: key.created_at,
                    lastUsedAt: key.last_used_at,
                })),
            });
        }
        catch (error) {
            console.error('List keys error:', error);
            res.status(500).json({
                error: 'list_keys_failed',
                message: 'Failed to list API keys',
            });
        }
    });
    /**
     * DELETE /v1/keys/:id
     * Deactivate an API key
     */
    router.delete('/v1/keys/:id', jwtAuth, async (req, res) => {
        try {
            const { userId } = req.user;
            const { id } = req.params;
            // Verify ownership and deactivate
            const result = await pool.query(`UPDATE api_keys 
        SET is_active = false
        WHERE id = $1 AND user_id = $2
        RETURNING id`, [id, userId]);
            if (result.rows.length === 0) {
                res.status(404).json({
                    error: 'key_not_found',
                    message: 'API key not found or access denied',
                });
                return;
            }
            res.json({
                success: true,
                message: 'API key deactivated',
            });
        }
        catch (error) {
            console.error('Delete key error:', error);
            res.status(500).json({
                error: 'delete_key_failed',
                message: 'Failed to delete API key',
            });
        }
    });
    /**
     * GET /v1/usage
     * Get current month usage + limits + rollover
     */
    router.get('/v1/usage', jwtAuth, async (req, res) => {
        try {
            const { userId } = req.user;
            const now = new Date();
            const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const result = await pool.query(`SELECT 
          u.monthly_limit,
          COALESCE(SUM(usage.fetch_count), 0) as fetch_count,
          COALESCE(SUM(usage.search_count), 0) as search_count,
          COALESCE(SUM(usage.browser_count), 0) as browser_count,
          COALESCE(MAX(usage.rollover_credits), 0) as rollover_credits
        FROM users u
        LEFT JOIN api_keys ak ON ak.user_id = u.id
        LEFT JOIN usage ON usage.api_key_id = ak.id AND usage.period = $2
        WHERE u.id = $1
        GROUP BY u.monthly_limit`, [userId, currentPeriod]);
            if (result.rows.length === 0) {
                res.status(404).json({
                    error: 'user_not_found',
                    message: 'User not found',
                });
                return;
            }
            const usage = result.rows[0];
            const totalUsed = usage.fetch_count + usage.search_count + usage.browser_count;
            const totalAvailable = usage.monthly_limit + usage.rollover_credits;
            const remaining = Math.max(0, totalAvailable - totalUsed);
            res.json({
                period: currentPeriod,
                monthlyLimit: usage.monthly_limit,
                rolloverCredits: usage.rollover_credits,
                totalAvailable,
                totalUsed,
                remaining,
                breakdown: {
                    fetch: usage.fetch_count,
                    search: usage.search_count,
                    browser: usage.browser_count,
                },
            });
        }
        catch (error) {
            console.error('Get usage error:', error);
            res.status(500).json({
                error: 'usage_failed',
                message: 'Failed to get usage',
            });
        }
    });
    return router;
}
//# sourceMappingURL=users.js.map