const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_PASSWORD ||= 'test-password-only';
process.env.ADMIN_TOKEN_SECRET ||= 'test-secret-at-least-32-characters-long';
const { app, pool, signAdminToken, verifyAdminToken } = require('./server');

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
});

test('health endpoint reports a valid service state', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.match(body.data.status, /^(ok|degraded)$/);
});

test('admin login rejects invalid credentials', async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    });
    assert.equal(response.status, 401);
});

test('admin endpoints require a bearer token', async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/bookings`);
    assert.equal(response.status, 401);
});

test('signed admin tokens verify and reject tampering', () => {
    const token = signAdminToken({ username: 'admin', role: 'admin' });
    assert.equal(verifyAdminToken(token).sub, 'admin');
    assert.equal(verifyAdminToken(`${token}tampered`), null);
});
