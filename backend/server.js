const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
        if (!match || process.env[match[1]] !== undefined) continue;
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
}

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@eliteclean.sa';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || '';
const AUTO_INIT_DB = process.env.AUTO_INIT_DB === 'true' || (!IS_PRODUCTION && process.env.AUTO_INIT_DB !== 'false');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
for (const vercelHost of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (vercelHost) ALLOWED_ORIGINS.push(`https://${vercelHost}`);
}

// Middleware
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
        'Cross-Origin-Opener-Policy': 'same-origin'
    });
    next();
});
app.use(cors({
    origin(origin, callback) {
        if (!origin || !IS_PRODUCTION || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error('Origin is not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use((err, req, res, next) => {
    if (err?.message === 'Origin is not allowed') return fail(res, err.message, 403);
    next(err);
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(path.join(__dirname, '../')));

// Neon PostgreSQL
const pool = new Pool({
    ...(DATABASE_URL ? { connectionString: DATABASE_URL } : {}),
    ...(DATABASE_URL && !DATABASE_URL.includes('localhost') ? { ssl: { rejectUnauthorized: false } } : {}),
    max: IS_PRODUCTION ? 5 : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});
pool.on('error', err => console.error('Unexpected database pool error:', err.message));

// Auto-init DB
async function initDatabase() {
    if (!DATABASE_URL) {
        console.warn('DATABASE_URL is not configured; database-backed endpoints will return 503.');
        return false;
    }
    if (!AUTO_INIT_DB) {
        console.log('Automatic database initialization is disabled.');
        return true;
    }
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
        await pool.query(sql);
        console.log('✅ Database initialized');
        return true;
    } catch (err) {
        console.error('⚠️ DB init:', err.message);
        return false;
    }
}
let databaseReady = false;
const databaseInitPromise = initDatabase().then(ready => { databaseReady = ready; });

// Helpers
function generateBookingCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'EC-';
    for (let i = 0; i < 6; i++) code += c.charAt(Math.floor(Math.random() * c.length));
    return code;
}

function ok(res, data, msg, status = 200) { res.status(status).json({ success: true, data, message: msg }); }
function fail(res, err, status = 500) {
    if (status >= 500) console.error(err);
    const message = status >= 500 && IS_PRODUCTION ? 'Internal server error' : String(err);
    res.status(status).json({ success: false, error: message });
}

function normalizeText(value, max = 255) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function parsePositiveInt(value, fallback = 1, max = 1000) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isSaudiPhone(value) {
    return /^(?:\+?966|0)?5\d{8}$/.test(String(value || '').replace(/[\s()-]/g, ''));
}

function formatSlotHour(hour) {
    const normalized = hour % 24;
    const period = normalized >= 12 ? 'PM' : 'AM';
    const display = normalized % 12 || 12;
    return `${display}:00 ${period}`;
}

function parseSlotStartHour(slot) {
    const match = String(slot || '').match(/^(\d{1,2}):00 (AM|PM) - /);
    if (!match) return null;
    let hour = Number(match[1]) % 12;
    if (match[2] === 'PM') hour += 12;
    return hour;
}

function httpError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function signAdminToken(user) {
    const payload = base64url(JSON.stringify({
        sub: user.username,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + (8 * 60 * 60)
    }));
    const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyAdminToken(token) {
    if (!TOKEN_SECRET || typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.exp > Math.floor(Date.now() / 1000) ? decoded : null;
}

function requireAdmin(req, res, next) {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const user = verifyAdminToken(token);
        if (!user || user.role !== 'admin') return fail(res, 'Unauthorized', 401);
        req.admin = user;
        next();
    } catch {
        fail(res, 'Unauthorized', 401);
    }
}

const requestBuckets = new Map();
function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const bucket = requestBuckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            requestBuckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        bucket.count += 1;
        if (bucket.count > max) return fail(res, 'Too many requests. Please try again later.', 429);
        next();
    };
}

app.get('/api/v1/health', async (req, res) => {
    if (!DATABASE_URL) return ok(res, { status: 'degraded', database: 'not_configured' });
    try {
        await databaseInitPromise;
        await pool.query('SELECT 1');
        ok(res, { status: 'ok', database: 'connected' });
    } catch {
        ok(res, { status: 'degraded', database: 'unavailable' }, undefined, 503);
    }
});

app.use('/api/v1/public/bookings', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }));
app.use('/api/v1/public/contact', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/api/v1/admin/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/api/v1', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/admin')) return next();
    if (!DATABASE_URL) return fail(res, 'Database is not configured', 503);
    next();
});

// ================================================================
//  PUBLIC API ENDPOINTS
// ================================================================

// GET /api/v1/public/services - all active services with packages
app.get('/api/v1/public/services', async (req, res) => {
    try {
        const { category } = req.query;
        let q = 'SELECT * FROM services WHERE is_active = TRUE';
        const p = [];
        if (category && category !== 'all') { p.push(category); q += ` AND category = $${p.length}`; }
        q += ' ORDER BY sort_order ASC, id ASC';
        const { rows: services } = await pool.query(q, p);

        // attach packages to each service
        for (const svc of services) {
            const { rows: pkgs } = await pool.query('SELECT * FROM packages WHERE service_id = $1 AND is_active = TRUE ORDER BY sort_order ASC', [svc.id]);
            svc.packages = pkgs;
            const { rows: addons } = await pool.query('SELECT * FROM add_ons WHERE service_id = $1 AND is_active = TRUE', [svc.id]);
            svc.add_ons = addons;
        }
        ok(res, services);
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/public/services/:slug - single service detail
app.get('/api/v1/public/services/:slug', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM services WHERE slug = $1 AND is_active = TRUE', [req.params.slug]);
        if (!rows.length) return fail(res, 'Service not found', 404);
        const svc = rows[0];
        const { rows: pkgs } = await pool.query('SELECT * FROM packages WHERE service_id = $1 AND is_active = TRUE ORDER BY sort_order ASC', [svc.id]);
        svc.packages = pkgs;
        const { rows: addons } = await pool.query('SELECT * FROM add_ons WHERE service_id = $1 AND is_active = TRUE', [svc.id]);
        svc.add_ons = addons;
        ok(res, svc);
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/public/regions
app.get('/api/v1/public/regions', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM service_regions WHERE is_active = TRUE ORDER BY id ASC');
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/public/packages/:serviceId
app.get('/api/v1/public/packages/:serviceId', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM packages WHERE service_id = $1 AND is_active = TRUE ORDER BY sort_order ASC', [req.params.serviceId]);
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

// POST /api/v1/public/calculate-price
app.post('/api/v1/public/calculate-price', async (req, res) => {
    try {
        const { service_id, package_id, region_id } = req.body;
        const units = parsePositiveInt(req.body.units);
        const coupon_code = normalizeText(req.body.coupon_code, 50).toUpperCase();
        const svcRes = await pool.query('SELECT * FROM services WHERE id = $1 AND is_active = TRUE', [service_id]);
        if (!svcRes.rows.length) return fail(res, 'Service not found', 404);
        const svc = svcRes.rows[0];
        if (units < svc.min_units || units > svc.max_units) return fail(res, 'Invalid service quantity', 400);

        let unit_price = parseFloat(svc.base_price);
        let package_title = null;
        if (package_id) {
            const pkgRes = await pool.query('SELECT * FROM packages WHERE id = $1 AND service_id = $2 AND is_active = TRUE', [package_id, service_id]);
            if (!pkgRes.rows.length) return fail(res, 'Invalid package for selected service', 400);
            unit_price = parseFloat(pkgRes.rows[0].price);
            package_title = pkgRes.rows[0].title_ar;
        }

        const subtotal = unit_price * units;
        let region_fee = 0;
        if (region_id) {
            const rRes = await pool.query('SELECT base_fee FROM service_regions WHERE id = $1', [region_id]);
            if (rRes.rows.length) region_fee = parseFloat(rRes.rows[0].base_fee);
        }

        let discount = 0;
        if (coupon_code) {
            const cRes = await pool.query("SELECT * FROM coupons WHERE code = $1 AND is_active = TRUE AND valid_from <= CURRENT_DATE AND valid_to >= CURRENT_DATE AND used_count < max_uses", [coupon_code]);
            if (cRes.rows.length) {
                const coupon = cRes.rows[0];
                if (subtotal >= parseFloat(coupon.min_order)) {
                    discount = coupon.discount_type === 'percentage' ? subtotal * parseFloat(coupon.discount_value) / 100 : parseFloat(coupon.discount_value);
                }
            }
        }

        const total = Math.max(0, subtotal + region_fee - discount);
        ok(res, { service_title: svc.title_ar, service_title_en: svc.title_en, package_title, unit_price, units, subtotal, region_fee, discount, total });
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/public/availability?date=YYYY-MM-DD
app.get('/api/v1/public/availability', async (req, res) => {
    try {
        const { date } = req.query;
        if (date && !isIsoDate(date)) return fail(res, 'Invalid date. Use YYYY-MM-DD.', 400);
        if (date && date < new Date().toISOString().slice(0, 10)) return fail(res, 'Past dates are unavailable', 400);
        // Check if date is an exception
        if (date) {
            const excRes = await pool.query('SELECT * FROM date_exceptions WHERE exception_date = $1 AND is_closed = TRUE', [date]);
            if (excRes.rows.length) return ok(res, { available: false, slots: [], message: 'This date is unavailable' });
        }

        const dayOfWeek = date ? new Date(date).getDay() : new Date().getDay();
        const whRes = await pool.query('SELECT * FROM working_hours WHERE day_of_week = $1', [dayOfWeek]);
        if (!whRes.rows.length || !whRes.rows[0].is_open) return ok(res, { available: false, slots: [] });

        const wh = whRes.rows[0];
        const slots = [];
        const bookedCounts = new Map();
        if (date) {
            const { rows: counts } = await pool.query(
                "SELECT scheduled_time_slot, COUNT(*)::int AS count FROM bookings WHERE scheduled_date = $1 AND status NOT IN ('REJECTED','CANCELLED') GROUP BY scheduled_time_slot",
                [date]
            );
            counts.forEach(row => bookedCounts.set(row.scheduled_time_slot, row.count));
        }
        const startH = parseInt(wh.start_time.split(':')[0]);
        const endH = parseInt(wh.end_time.split(':')[0]);
        for (let h = startH; h < endH; h += 2) {
            const from = formatSlotHour(h);
            const to = formatSlotHour(h + 2);
            const slot = `${from} - ${to}`;
            if ((bookedCounts.get(slot) || 0) < wh.max_slots_per_hour) {
                slots.push({ slot, slot_ar: `${from.replace('AM', 'ص').replace('PM', 'م')} - ${to.replace('AM', 'ص').replace('PM', 'م')}` });
            }
        }
        ok(res, { available: true, slots, working_hours: wh });
    } catch (err) { fail(res, err.message); }
});

// POST /api/v1/public/bookings - submit booking
app.post('/api/v1/public/bookings', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let { customer_name, customer_phone, customer_email, region_id, address_line, latitude, longitude, notes, scheduled_date, scheduled_time_slot, service_id, package_id, units = 1, coupon_code } = req.body;
        customer_name = normalizeText(customer_name, 120);
        customer_phone = normalizeText(customer_phone, 30).replace(/[\s()-]/g, '');
        customer_email = normalizeText(customer_email, 255).toLowerCase() || null;
        address_line = normalizeText(address_line, 500);
        notes = normalizeText(notes, 1000) || null;
        scheduled_time_slot = normalizeText(scheduled_time_slot, 80);
        coupon_code = normalizeText(coupon_code, 50).toUpperCase() || null;
        units = parsePositiveInt(units);

        // Validate required
        if (!customer_name || !customer_phone || !address_line || !scheduled_date || !scheduled_time_slot || !service_id) {
            throw httpError('Missing required fields');
        }
        if (!isSaudiPhone(customer_phone)) throw httpError('Invalid Saudi mobile number');
        if (customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) throw httpError('Invalid email address');
        if (!isIsoDate(scheduled_date) || scheduled_date < new Date().toISOString().slice(0, 10)) throw httpError('Invalid scheduled date');
        const schedule = await client.query(`
            SELECT wh.is_open, wh.start_time, wh.end_time, wh.max_slots_per_hour,
                   EXISTS(SELECT 1 FROM date_exceptions de WHERE de.exception_date = $1 AND de.is_closed = TRUE) AS is_exception,
                   (SELECT COUNT(*)::int FROM bookings b WHERE b.scheduled_date = $1 AND b.scheduled_time_slot = $2 AND b.status NOT IN ('REJECTED','CANCELLED')) AS booked
            FROM working_hours wh
            WHERE wh.day_of_week = $3
        `, [scheduled_date, scheduled_time_slot, new Date(`${scheduled_date}T12:00:00Z`).getUTCDay()]);
        const scheduleRow = schedule.rows[0];
        if (!scheduleRow || !scheduleRow.is_open || scheduleRow.is_exception) throw httpError('Selected date is unavailable');
        const slotStart = parseSlotStartHour(scheduled_time_slot);
        const workingStart = Number(String(scheduleRow.start_time || '0').split(':')[0]);
        const workingEnd = Number(String(scheduleRow.end_time || '0').split(':')[0]);
        if (slotStart === null || slotStart < workingStart || slotStart >= workingEnd || (slotStart - workingStart) % 2 !== 0) {
            throw httpError('Invalid time slot');
        }
        if (scheduleRow.booked >= scheduleRow.max_slots_per_hour) throw httpError('Selected time slot is fully booked', 409);

        // Get/Create customer
        let custRes = await client.query('SELECT * FROM customers WHERE phone = $1', [customer_phone]);
        let customer_id;
        if (custRes.rows.length) {
            customer_id = custRes.rows[0].id;
            await client.query('UPDATE customers SET full_name = $1, email = COALESCE($2, email), total_bookings = total_bookings + 1, updated_at = NOW() WHERE id = $3', [customer_name, customer_email, customer_id]);
        } else {
            const newCust = await client.query('INSERT INTO customers (full_name, phone, email, total_bookings) VALUES ($1, $2, $3, 1) RETURNING id', [customer_name, customer_phone, customer_email]);
            customer_id = newCust.rows[0].id;
        }

        // Price calculation
        const svc = (await client.query('SELECT * FROM services WHERE id = $1 AND is_active = TRUE', [service_id])).rows[0];
        if (!svc) throw new Error('Service not found');
        if (units < svc.min_units || units > svc.max_units) throw httpError('Invalid service quantity');

        let unit_price = parseFloat(svc.base_price);
        if (package_id) {
            const pkg = (await client.query('SELECT price FROM packages WHERE id = $1 AND service_id = $2 AND is_active = TRUE', [package_id, service_id])).rows;
            if (!pkg.length) throw httpError('Invalid package for selected service');
            unit_price = parseFloat(pkg[0].price);
        }

        const subtotal = unit_price * parseInt(units);
        let region_fee = 0;
        if (region_id) {
            const rr = (await client.query('SELECT base_fee FROM service_regions WHERE id = $1 AND is_active = TRUE', [region_id])).rows;
            if (!rr.length) throw httpError('Invalid service region');
            region_fee = parseFloat(rr[0].base_fee);
        }

        let discount = 0;
        if (coupon_code) {
            const cr = (await client.query("SELECT * FROM coupons WHERE code = $1 AND is_active = TRUE AND valid_from <= CURRENT_DATE AND valid_to >= CURRENT_DATE AND used_count < max_uses FOR UPDATE", [coupon_code])).rows;
            if (cr.length) {
                const c = cr[0];
                if (subtotal >= parseFloat(c.min_order)) {
                    discount = c.discount_type === 'percentage' ? subtotal * parseFloat(c.discount_value) / 100 : parseFloat(c.discount_value);
                    discount = Math.min(discount, subtotal);
                    await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [c.id]);
                }
            }
        }

        const total_amount = Math.max(0, subtotal + region_fee - discount);
        const booking_code = generateBookingCode();

        const bookingRes = await client.query(`
            INSERT INTO bookings (booking_code, customer_id, customer_name, customer_phone, customer_email, region_id, address_line, latitude, longitude, notes, scheduled_date, scheduled_time_slot, subtotal, region_fee, discount, coupon_code, total_amount, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'NEW')
            RETURNING id, booking_code, total_amount, status, created_at
        `, [booking_code, customer_id, customer_name, customer_phone, customer_email, region_id, address_line, latitude, longitude, notes, scheduled_date, scheduled_time_slot, subtotal, region_fee, discount, coupon_code, total_amount]);

        const booking = bookingRes.rows[0];

        await client.query(`INSERT INTO booking_items (booking_id, service_id, package_id, service_title_ar, service_title_en, unit_quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [booking.id, svc.id, package_id || null, svc.title_ar, svc.title_en, units, unit_price, subtotal]);

        await client.query(`INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by, reason) VALUES ($1, NULL, 'NEW', 'CUSTOMER', 'Online booking submitted')`, [booking.id]);

        // Log notification
        if (customer_email) {
            await client.query(`INSERT INTO notifications (recipient_type, recipient_contact, channel, subject, body, booking_id, status) VALUES ('customer', $1, 'email', $2, $3, $4, 'pending')`,
                [customer_email, `Booking Confirmed: ${booking_code}`, `Your booking ${booking_code} has been received. We will contact you shortly.`, booking.id]);
        }
        await client.query(`INSERT INTO notifications (recipient_type, recipient_contact, channel, subject, body, booking_id, status) VALUES ('admin', 'admin@eliteclean.sa', 'email', $1, $2, $3, 'pending')`,
            [`New Booking: ${booking_code}`, `New booking from ${customer_name} (${customer_phone}) for ${svc.title_en}`, booking.id]);

        await client.query('COMMIT');
        ok(res, booking, 'Booking submitted successfully', 201);
    } catch (err) {
        await client.query('ROLLBACK');
        fail(res, err.message, err.status || 500);
    } finally { client.release(); }
});

// GET /api/v1/public/bookings/:code - track booking
app.get('/api/v1/public/bookings/:code', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT b.id, b.booking_code, b.customer_name, b.scheduled_date,
                   b.scheduled_time_slot, b.total_amount, b.status, b.created_at,
                   r.name_ar as region_name_ar, r.name_en as region_name_en
            FROM bookings b LEFT JOIN service_regions r ON b.region_id = r.id
            WHERE b.booking_code = $1
        `, [req.params.code]);
        if (!rows.length) return fail(res, 'Booking not found', 404);
        const booking = rows[0];
        const { rows: items } = await pool.query('SELECT * FROM booking_items WHERE booking_id = $1', [booking.id]);
        booking.items = items;
        const { rows: history } = await pool.query('SELECT * FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at DESC', [booking.id]);
        booking.status_history = history;
        ok(res, booking);
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/public/faq
app.get('/api/v1/public/faq', async (req, res) => {
    try {
        const { category } = req.query;
        let q = 'SELECT * FROM faq_items WHERE is_active = TRUE';
        const p = [];
        if (category && category !== 'all') { p.push(category); q += ` AND category = $${p.length}`; }
        q += ' ORDER BY sort_order ASC';
        const { rows } = await pool.query(q, p);
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

// POST /api/v1/public/contact
app.post('/api/v1/public/contact', async (req, res) => {
    try {
        const name = normalizeText(req.body.name, 120);
        const email = normalizeText(req.body.email, 255).toLowerCase() || null;
        const phone = normalizeText(req.body.phone, 30) || null;
        const subject = normalizeText(req.body.subject, 200) || null;
        const message = normalizeText(req.body.message, 3000);
        if (!name || !message) return fail(res, 'Name and message are required', 400);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'Invalid email address', 400);
        await pool.query('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES ($1,$2,$3,$4,$5)', [name, email, phone, subject, message]);
        ok(res, null, 'Message received successfully', 201);
    } catch (err) { fail(res, err.message); }
});

// POST /api/v1/public/validate-coupon
async function validateCoupon(req, res) {
    try {
        const code = normalizeText(req.body.code, 50).toUpperCase();
        const subtotal = Math.max(0, Number(req.body.subtotal) || 0);
        const { rows } = await pool.query("SELECT * FROM coupons WHERE code = $1 AND is_active = TRUE AND valid_from <= CURRENT_DATE AND valid_to >= CURRENT_DATE AND used_count < max_uses", [code]);
        if (!rows.length) return fail(res, 'Invalid or expired coupon', 404);
        const c = rows[0];
        if (subtotal < parseFloat(c.min_order)) return fail(res, `Minimum order amount is ${c.min_order} SAR`, 400);
        const discount = c.discount_type === 'percentage' ? subtotal * parseFloat(c.discount_value) / 100 : parseFloat(c.discount_value);
        ok(res, { code: c.code, discount_type: c.discount_type, discount_value: parseFloat(c.discount_value), calculated_discount: discount });
    } catch (err) { fail(res, err.message); }
}
app.post('/api/v1/public/validate-coupon', validateCoupon);
app.post('/api/v1/public/promos/validate', validateCoupon);

// ================================================================
//  ADMIN API ENDPOINTS
// ================================================================

// POST /api/v1/admin/auth/login
app.post('/api/v1/admin/auth/login', async (req, res) => {
    const username = normalizeText(req.body.username, 255).toLowerCase();
    const password = String(req.body.password || '');
    if (!ADMIN_PASSWORD || !TOKEN_SECRET) return fail(res, 'Admin authentication is not configured', 503);
    const validIdentity = username === ADMIN_USERNAME.toLowerCase() || username === ADMIN_EMAIL.toLowerCase();
    const supplied = Buffer.from(password);
    const expected = Buffer.from(ADMIN_PASSWORD);
    const validPassword = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (validIdentity && validPassword) {
        const user = { username: ADMIN_USERNAME, email: ADMIN_EMAIL, full_name: 'مدير النظام', role: 'admin' };
        return ok(res, { token: signAdminToken(user), expires_in: 28800, user });
    }
    fail(res, 'Invalid credentials', 401);
});

app.use('/api/v1/admin', requireAdmin);
app.use('/api/v1/admin', (req, res, next) => {
    if (!DATABASE_URL) return fail(res, 'Database is not configured', 503);
    next();
});

// GET /api/v1/admin/dashboard/stats
app.get('/api/v1/admin/dashboard/stats', async (req, res) => {
    try {
        const totalBookings = (await pool.query('SELECT COUNT(*) as c FROM bookings')).rows[0].c;
        const newBookings = (await pool.query("SELECT COUNT(*) as c FROM bookings WHERE status = 'NEW'")).rows[0].c;
        const inProgress = (await pool.query("SELECT COUNT(*) as c FROM bookings WHERE status = 'IN_PROGRESS'")).rows[0].c;
        const completed = (await pool.query("SELECT COUNT(*) as c FROM bookings WHERE status = 'COMPLETED'")).rows[0].c;
        const totalRevenue = (await pool.query("SELECT COALESCE(SUM(total_amount),0) as s FROM bookings WHERE status IN ('COMPLETED','IN_PROGRESS')")).rows[0].s;
        const totalCustomers = (await pool.query('SELECT COUNT(*) as c FROM customers')).rows[0].c;
        const todayBookings = (await pool.query("SELECT COUNT(*) as c FROM bookings WHERE scheduled_date = CURRENT_DATE")).rows[0].c;
        const unreadMessages = (await pool.query("SELECT COUNT(*) as c FROM contact_messages WHERE is_read = FALSE")).rows[0].c;
        const recentBookings = (await pool.query(`SELECT b.*, r.name_ar as region_name FROM bookings b LEFT JOIN service_regions r ON b.region_id = r.id ORDER BY b.created_at DESC LIMIT 10`)).rows;

        ok(res, { totalBookings, newBookings, inProgress, completed, totalRevenue, totalCustomers, todayBookings, unreadMessages, recentBookings });
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/admin/bookings
app.get('/api/v1/admin/bookings', async (req, res) => {
    try {
        const { status, search, from_date, to_date, page = 1, limit = 50 } = req.query;
        let q = `SELECT b.*, r.name_ar as region_name, r.name_en as region_name_en FROM bookings b LEFT JOIN service_regions r ON b.region_id = r.id WHERE 1=1`;
        const p = [];
        if (status) { p.push(status); q += ` AND b.status = $${p.length}`; }
        if (search) { p.push(`%${search}%`); q += ` AND (b.customer_name ILIKE $${p.length} OR b.customer_phone ILIKE $${p.length} OR b.booking_code ILIKE $${p.length})`; }
        if (from_date) { p.push(from_date); q += ` AND b.scheduled_date >= $${p.length}`; }
        if (to_date) { p.push(to_date); q += ` AND b.scheduled_date <= $${p.length}`; }
        q += ' ORDER BY b.id DESC';
        const offset = (parseInt(page) - 1) * parseInt(limit);
        p.push(parseInt(limit)); q += ` LIMIT $${p.length}`;
        p.push(offset); q += ` OFFSET $${p.length}`;

        const { rows } = await pool.query(q, p);
        // Attach items to each booking
        for (const b of rows) {
            const { rows: items } = await pool.query('SELECT * FROM booking_items WHERE booking_id = $1', [b.id]);
            b.items = items;
        }
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

// GET /api/v1/admin/bookings/:id
app.get('/api/v1/admin/bookings/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT b.*, r.name_ar as region_name, r.name_en as region_name_en FROM bookings b LEFT JOIN service_regions r ON b.region_id = r.id WHERE b.id = $1', [req.params.id]);
        if (!rows.length) return fail(res, 'Not found', 404);
        const b = rows[0];
        b.items = (await pool.query('SELECT * FROM booking_items WHERE booking_id = $1', [b.id])).rows;
        b.status_history = (await pool.query('SELECT * FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at DESC', [b.id])).rows;
        ok(res, b);
    } catch (err) { fail(res, err.message); }
});

// PATCH /api/v1/admin/bookings/:id/status
app.patch('/api/v1/admin/bookings/:id/status', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { new_status, reason = '' } = req.body;
        const allowedStatuses = ['NEW', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'];
        if (!allowedStatuses.includes(new_status)) throw httpError('Invalid booking status');
        const curr = (await client.query('SELECT status, customer_email, booking_code FROM bookings WHERE id = $1', [req.params.id])).rows[0];
        if (!curr) throw new Error('Booking not found');

        await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', [new_status, req.params.id]);
        await client.query('INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by, reason) VALUES ($1,$2,$3,$4,$5)', [req.params.id, curr.status, new_status, 'ADMIN', reason]);

        // Notify customer
        if (curr.customer_email) {
            await client.query(`INSERT INTO notifications (recipient_type, recipient_contact, channel, subject, body, booking_id, status) VALUES ('customer', $1, 'email', $2, $3, $4, 'pending')`,
                [curr.customer_email, `Booking ${curr.booking_code} Updated`, `Your booking status has been updated to: ${new_status}`, req.params.id]);
        }

        await client.query('COMMIT');
        ok(res, null, `Status updated to ${new_status}`);
    } catch (err) { await client.query('ROLLBACK'); fail(res, err.message, err.status || 500); }
    finally { client.release(); }
});

// PUT /api/v1/admin/bookings/:id
app.put('/api/v1/admin/bookings/:id', async (req, res) => {
    try {
        const { scheduled_date, scheduled_time_slot, admin_notes, assigned_team } = req.body;
        await pool.query('UPDATE bookings SET scheduled_date = COALESCE($1, scheduled_date), scheduled_time_slot = COALESCE($2, scheduled_time_slot), admin_notes = COALESCE($3, admin_notes), assigned_team = COALESCE($4, assigned_team), updated_at = NOW() WHERE id = $5',
            [scheduled_date, scheduled_time_slot, admin_notes, assigned_team, req.params.id]);
        ok(res, null, 'Booking updated');
    } catch (err) { fail(res, err.message); }
});

// --- SERVICES CRUD ---
app.get('/api/v1/admin/services', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM services ORDER BY sort_order ASC, id ASC');
        for (const s of rows) { s.packages = (await pool.query('SELECT * FROM packages WHERE service_id = $1 ORDER BY sort_order ASC', [s.id])).rows; }
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

app.post('/api/v1/admin/services', async (req, res) => {
    try {
        const { slug, title_ar, title_en, category, description_ar, description_en, image_url, unit_name_ar, unit_name_en, base_price, min_units, max_units, estimated_duration_mins, sort_order } = req.body;
        const { rows } = await pool.query('INSERT INTO services (slug, title_ar, title_en, category, description_ar, description_en, image_url, unit_name_ar, unit_name_en, base_price, min_units, max_units, estimated_duration_mins, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
            [slug, title_ar, title_en, category, description_ar, description_en, image_url, unit_name_ar, unit_name_en, base_price, min_units || 1, max_units || 100, estimated_duration_mins || 60, sort_order || 0]);
        ok(res, rows[0], 'Service created');
    } catch (err) { fail(res, err.message); }
});

app.put('/api/v1/admin/services/:id', async (req, res) => {
    try {
        const { title_ar, title_en, category, description_ar, description_en, image_url, unit_name_ar, unit_name_en, base_price, min_units, max_units, estimated_duration_mins, is_active, sort_order } = req.body;
        await pool.query('UPDATE services SET title_ar=COALESCE($1,title_ar), title_en=COALESCE($2,title_en), category=COALESCE($3,category), description_ar=COALESCE($4,description_ar), description_en=COALESCE($5,description_en), image_url=COALESCE($6,image_url), unit_name_ar=COALESCE($7,unit_name_ar), unit_name_en=COALESCE($8,unit_name_en), base_price=COALESCE($9,base_price), min_units=COALESCE($10,min_units), max_units=COALESCE($11,max_units), estimated_duration_mins=COALESCE($12,estimated_duration_mins), is_active=COALESCE($13,is_active), sort_order=COALESCE($14,sort_order) WHERE id=$15',
            [title_ar, title_en, category, description_ar, description_en, image_url, unit_name_ar, unit_name_en, base_price, min_units, max_units, estimated_duration_mins, is_active, sort_order, req.params.id]);
        ok(res, null, 'Service updated');
    } catch (err) { fail(res, err.message); }
});

app.delete('/api/v1/admin/services/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM services WHERE id = $1', [req.params.id]);
        ok(res, null, 'Service deleted');
    } catch (err) { fail(res, err.message); }
});

// --- PACKAGES CRUD ---
app.get('/api/v1/admin/packages', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT p.*, s.title_ar as service_title_ar, s.title_en as service_title_en FROM packages p LEFT JOIN services s ON p.service_id = s.id ORDER BY p.service_id, p.sort_order ASC');
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

app.post('/api/v1/admin/packages', async (req, res) => {
    try {
        const { service_id, title_ar, title_en, description_ar, description_en, price, features_ar, features_en, sort_order } = req.body;
        const { rows } = await pool.query('INSERT INTO packages (service_id, title_ar, title_en, description_ar, description_en, price, features_ar, features_en, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
            [service_id, title_ar, title_en, description_ar, description_en, price, features_ar, features_en, sort_order || 0]);
        ok(res, rows[0], 'Package created');
    } catch (err) { fail(res, err.message); }
});

app.put('/api/v1/admin/packages/:id', async (req, res) => {
    try {
        const { title_ar, title_en, description_ar, description_en, price, features_ar, features_en, is_active, sort_order } = req.body;
        await pool.query('UPDATE packages SET title_ar=COALESCE($1,title_ar), title_en=COALESCE($2,title_en), description_ar=COALESCE($3,description_ar), description_en=COALESCE($4,description_en), price=COALESCE($5,price), features_ar=COALESCE($6,features_ar), features_en=COALESCE($7,features_en), is_active=COALESCE($8,is_active), sort_order=COALESCE($9,sort_order) WHERE id=$10',
            [title_ar, title_en, description_ar, description_en, price, features_ar, features_en, is_active, sort_order, req.params.id]);
        ok(res, null, 'Package updated');
    } catch (err) { fail(res, err.message); }
});

app.delete('/api/v1/admin/packages/:id', async (req, res) => {
    try { await pool.query('DELETE FROM packages WHERE id = $1', [req.params.id]); ok(res, null, 'Package deleted'); }
    catch (err) { fail(res, err.message); }
});

// --- REGIONS CRUD ---
app.get('/api/v1/admin/regions', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM service_regions ORDER BY id ASC'); ok(res, rows); }
    catch (err) { fail(res, err.message); }
});

app.post('/api/v1/admin/regions', async (req, res) => {
    try {
        const { name_ar, name_en, base_fee } = req.body;
        const { rows } = await pool.query('INSERT INTO service_regions (name_ar, name_en, base_fee) VALUES ($1,$2,$3) RETURNING *', [name_ar, name_en, base_fee || 0]);
        ok(res, rows[0], 'Region created');
    } catch (err) { fail(res, err.message); }
});

app.put('/api/v1/admin/regions/:id', async (req, res) => {
    try {
        const { name_ar, name_en, base_fee, is_active } = req.body;
        await pool.query('UPDATE service_regions SET name_ar=COALESCE($1,name_ar), name_en=COALESCE($2,name_en), base_fee=COALESCE($3,base_fee), is_active=COALESCE($4,is_active) WHERE id=$5',
            [name_ar, name_en, base_fee, is_active, req.params.id]);
        ok(res, null, 'Region updated');
    } catch (err) { fail(res, err.message); }
});

app.delete('/api/v1/admin/regions/:id', async (req, res) => {
    try { await pool.query('DELETE FROM service_regions WHERE id = $1', [req.params.id]); ok(res, null, 'Deleted'); }
    catch (err) { fail(res, err.message); }
});

// --- CUSTOMERS ---
app.get('/api/v1/admin/customers', async (req, res) => {
    try {
        const { search, page = 1, limit = 50 } = req.query;
        let q = 'SELECT * FROM customers WHERE 1=1';
        const p = [];
        if (search) { p.push(`%${search}%`); q += ` AND (full_name ILIKE $${p.length} OR phone ILIKE $${p.length})`; }
        q += ' ORDER BY created_at DESC';
        const off = (parseInt(page) - 1) * parseInt(limit);
        p.push(parseInt(limit)); q += ` LIMIT $${p.length}`;
        p.push(off); q += ` OFFSET $${p.length}`;
        const { rows } = await pool.query(q, p);
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

// --- WORKING HOURS ---
app.get('/api/v1/admin/working-hours', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM working_hours ORDER BY day_of_week ASC'); ok(res, rows); }
    catch (err) { fail(res, err.message); }
});

app.put('/api/v1/admin/working-hours/:id', async (req, res) => {
    try {
        const { start_time, end_time, max_slots_per_hour, is_open } = req.body;
        await pool.query('UPDATE working_hours SET start_time=COALESCE($1,start_time), end_time=COALESCE($2,end_time), max_slots_per_hour=COALESCE($3,max_slots_per_hour), is_open=COALESCE($4,is_open) WHERE id=$5',
            [start_time, end_time, max_slots_per_hour, is_open, req.params.id]);
        ok(res, null, 'Working hours updated');
    } catch (err) { fail(res, err.message); }
});

// --- NOTIFICATIONS ---
app.get('/api/v1/admin/notifications', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT n.*, b.booking_code FROM notifications n LEFT JOIN bookings b ON n.booking_id = b.id ORDER BY n.created_at DESC LIMIT 100');
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

// --- CONTACT MESSAGES ---
app.get('/api/v1/admin/contact-messages', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100');
        ok(res, rows);
    } catch (err) { fail(res, err.message); }
});

app.patch('/api/v1/admin/contact-messages/:id/read', async (req, res) => {
    try { await pool.query('UPDATE contact_messages SET is_read = TRUE WHERE id = $1', [req.params.id]); ok(res, null, 'Marked as read'); }
    catch (err) { fail(res, err.message); }
});

// --- SITE SETTINGS ---
app.get('/api/v1/admin/settings', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM site_settings ORDER BY setting_key'); ok(res, rows); }
    catch (err) { fail(res, err.message); }
});

app.put('/api/v1/admin/settings', async (req, res) => {
    try {
        const { settings } = req.body; // array of {key, value}
        for (const s of settings) {
            await pool.query('INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()', [s.key, s.value]);
        }
        ok(res, null, 'Settings updated');
    } catch (err) { fail(res, err.message); }
});

// --- FAQ ADMIN ---
app.get('/api/v1/admin/faq', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM faq_items ORDER BY sort_order ASC'); ok(res, rows); }
    catch (err) { fail(res, err.message); }
});

app.post('/api/v1/admin/faq', async (req, res) => {
    try {
        const { category, question_ar, question_en, answer_ar, answer_en, sort_order } = req.body;
        const { rows } = await pool.query('INSERT INTO faq_items (category, question_ar, question_en, answer_ar, answer_en, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
            [category, question_ar, question_en, answer_ar, answer_en, sort_order || 0]);
        ok(res, rows[0], 'FAQ created');
    } catch (err) { fail(res, err.message); }
});

app.put('/api/v1/admin/faq/:id', async (req, res) => {
    try {
        const { category, question_ar, question_en, answer_ar, answer_en, is_active, sort_order } = req.body;
        await pool.query('UPDATE faq_items SET category=COALESCE($1,category), question_ar=COALESCE($2,question_ar), question_en=COALESCE($3,question_en), answer_ar=COALESCE($4,answer_ar), answer_en=COALESCE($5,answer_en), is_active=COALESCE($6,is_active), sort_order=COALESCE($7,sort_order) WHERE id=$8',
            [category, question_ar, question_en, answer_ar, answer_en, is_active, sort_order, req.params.id]);
        ok(res, null, 'FAQ updated');
    } catch (err) { fail(res, err.message); }
});

app.delete('/api/v1/admin/faq/:id', async (req, res) => {
    try { await pool.query('DELETE FROM faq_items WHERE id = $1', [req.params.id]); ok(res, null, 'Deleted'); }
    catch (err) { fail(res, err.message); }
});

// --- COUPONS ADMIN ---
app.get('/api/v1/admin/coupons', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC'); ok(res, rows); }
    catch (err) { fail(res, err.message); }
});

app.post('/api/v1/admin/coupons', async (req, res) => {
    try {
        const { code, discount_type, discount_value, min_order, max_uses, valid_from, valid_to } = req.body;
        const { rows } = await pool.query('INSERT INTO coupons (code, discount_type, discount_value, min_order, max_uses, valid_from, valid_to) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [code, discount_type, discount_value, min_order || 0, max_uses || 100, valid_from, valid_to]);
        ok(res, rows[0], 'Coupon created');
    } catch (err) { fail(res, err.message); }
});

app.delete('/api/v1/admin/coupons/:id', async (req, res) => {
    try { await pool.query('DELETE FROM coupons WHERE id = $1', [req.params.id]); ok(res, null, 'Deleted'); }
    catch (err) { fail(res, err.message); }
});

// --- CMS ---
app.get('/api/v1/admin/cms', async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM cms_content'); ok(res, rows); }
    catch (err) { fail(res, err.message); }
});

app.post('/api/v1/admin/cms', async (req, res) => {
    try {
        const { key, value_ar, value_en } = req.body;
        await pool.query('INSERT INTO cms_content (content_key, content_value_ar, content_value_en) VALUES ($1,$2,$3) ON CONFLICT (content_key) DO UPDATE SET content_value_ar = $2, content_value_en = $3, updated_at = NOW()', [key, value_ar, value_en]);
        ok(res, null, 'CMS updated');
    } catch (err) { fail(res, err.message); }
});

app.use('/api', (req, res) => fail(res, 'API endpoint not found', 404));

// Fallback: serve index.html for unmatched browser GET routes
app.use((req, res) => {
    if (req.method !== 'GET' || !req.accepts('html')) return fail(res, 'Not found', 404);
    const file = path.join(__dirname, '../index.html');
    if (fs.existsSync(file)) res.sendFile(file);
    else res.status(404).json({ error: 'Not found' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 EliteClean API running on http://localhost:${PORT}`);
    });
}

// Vercel's Node runtime expects the CommonJS export itself to be the
// request handler. Express apps are callable handlers, so export `app`
// directly while retaining named properties for local tests and tooling.
module.exports = app;
Object.assign(module.exports, { app, pool, initDatabase, signAdminToken, verifyAdminToken });
