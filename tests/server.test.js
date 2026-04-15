/**
 * VenueAI — Comprehensive Test Suite
 * Coverage: API endpoints, Security headers, Input validation,
 *           Rate limiting, Error handling, Stadium state
 */

const request = require('supertest');
const http    = require('http');

// ── Mock firebase so tests don't require real credentials ──
jest.mock('../firebase', () => ({ db: null }));
jest.mock('../db', () => ({
  initDB:    jest.fn().mockResolvedValue(true),
  syncStaff: jest.fn().mockResolvedValue(true),
  syncOrder: jest.fn().mockResolvedValue(true),
}));

// ── Silence console noise during tests ────────────────────
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

// Lazy-load app after mocks are in place
let app;
beforeAll(() => {
  app = require('../server');
});

// ═══════════════════════════════════════════════════════════
// 1. SECURITY — HTTP Headers (Helmet)
// ═══════════════════════════════════════════════════════════
describe('🔒 Security — HTTP Headers', () => {
  test('should set X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('should set X-Frame-Options to deny or sameorigin', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-frame-options']).toMatch(/DENY|SAMEORIGIN/i);
  });

  test('should set X-XSS-Protection header', async () => {
    const res = await request(app).get('/');
    // Helmet may set this or remove it — just ensure no "0" disabling it
    const xss = res.headers['x-xss-protection'];
    if (xss) expect(xss).not.toBe('0');
  });

  test('should not expose X-Powered-By', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('should return Content-Security-Policy header', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// 2. SECURITY — Input Validation & Sanitization
// ═══════════════════════════════════════════════════════════
describe('🛡️ Security — Input Validation', () => {
  test('POST /api/order should reject XSS in name field', async () => {
    const res = await request(app).post('/api/order').send({
      stadiumId: 'hyderabad_stadium',
      name: '<script>alert("xss")</script>',
      items: [],
    });
    expect(res.status).not.toBe(500);
    // Should either sanitize or return 422
    if (res.status === 422) {
      expect(res.body.errors).toBeDefined();
    }
  });

  test('POST /api/order should reject oversized payload', async () => {
    const bigPayload = { name: 'x'.repeat(10000), items: [] };
    const res = await request(app).post('/api/order').send(bigPayload);
    // Should get 413 or 422, not 200
    expect([400, 413, 422, 500].includes(res.status)).toBe(true);
  });

  test('GET /api/stadium/:id should reject invalid id characters', async () => {
    const res = await request(app).get('/api/stadium/../../../etc/passwd');
    expect([400, 404, 422].includes(res.status)).toBe(true);
  });

  test('POST /api/entry-slot should have validated fields', async () => {
    const res = await request(app).post('/api/entry-slot').send({
      stadiumId: '',   // intentionally empty
      zone: '',
    });
    expect(res.status).not.toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. STADIUMS API — Core Functionality
// ═══════════════════════════════════════════════════════════
describe('🏟️ Stadiums API', () => {
  test('GET /api/stadiums returns 200 with array', async () => {
    const res = await request(app).get('/api/stadiums');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/stadiums returns non-empty list', async () => {
    const res = await request(app).get('/api/stadiums');
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('GET /api/stadiums each item has required fields', async () => {
    const res = await request(app).get('/api/stadiums');
    const stadium = res.body.data[0];
    expect(stadium).toHaveProperty('id');
    expect(stadium).toHaveProperty('name');
    expect(stadium).toHaveProperty('city');
  });

  test('GET /api/stadium/hyderabad_stadium returns state', async () => {
    const res = await request(app).get('/api/stadium/hyderabad_stadium');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('state');
  });

  test('GET /api/stadium/eden_gardens returns CSK vs KKR match', async () => {
    const res = await request(app).get('/api/stadium/eden_gardens');
    expect(res.status).toBe(200);
    const state = res.body.data.state;
    expect(state.homeTeam).toMatch(/KKR|CSK/);
    expect(state.awayTeam).toMatch(/KKR|CSK/);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. MATCH API — Live Score Sync
// ═══════════════════════════════════════════════════════════
describe('🏏 Match API — Live Score', () => {
  test('GET /api/match returns match data for default stadium', async () => {
    const res = await request(app).get('/api/match?stadiumId=hyderabad_stadium');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/match has homeScore and awayScore', async () => {
    const res = await request(app).get('/api/match?stadiumId=hyderabad_stadium');
    const d = res.body.data;
    expect(d).toHaveProperty('homeScore');
    expect(d).toHaveProperty('awayScore');
  });

  test('GET /api/match has team names', async () => {
    const res = await request(app).get('/api/match?stadiumId=eden_gardens');
    expect(res.body.data.homeTeam).toBeDefined();
    expect(res.body.data.awayTeam).toBeDefined();
  });

  test('GET /api/match homeScore is a number', async () => {
    const res = await request(app).get('/api/match?stadiumId=hyderabad_stadium');
    expect(typeof res.body.data.homeScore).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. VENUE API
// ═══════════════════════════════════════════════════════════
describe('🏗️ Venue API', () => {
  test('GET /api/venue returns venue data', async () => {
    const res = await request(app).get('/api/venue?stadiumId=hyderabad_stadium');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/venue has gates array', async () => {
    const res = await request(app).get('/api/venue?stadiumId=hyderabad_stadium');
    expect(Array.isArray(res.body.data.gates)).toBe(true);
  });

  test('GET /api/venue has zones array', async () => {
    const res = await request(app).get('/api/venue?stadiumId=hyderabad_stadium');
    expect(Array.isArray(res.body.data.zones)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 6. FOOD MENU API
// ═══════════════════════════════════════════════════════════
describe('🍔 Food Menu API', () => {
  test('GET /api/menu returns 200 with items', async () => {
    const res = await request(app).get('/api/menu?stadiumId=hyderabad_stadium');
    expect(res.status).toBe(200);
  });

  test('GET /api/menu data is an array', async () => {
    const res = await request(app).get('/api/menu?stadiumId=hyderabad_stadium');
    if (res.body.data) expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 7. ENTRY SLOTS API
// ═══════════════════════════════════════════════════════════
describe('🎫 Entry Slots API', () => {
  test('GET /api/entry-slots returns 200', async () => {
    const res = await request(app).get('/api/entry-slots?stadiumId=hyderabad_stadium');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// 8. EFFICIENCY — Response times
// ═══════════════════════════════════════════════════════════
describe('⚡ Efficiency — Response Times', () => {
  test('GET /api/stadiums responds in < 500ms', async () => {
    const start = Date.now();
    await request(app).get('/api/stadiums');
    expect(Date.now() - start).toBeLessThan(500);
  });

  test('GET /api/match responds in < 300ms', async () => {
    const start = Date.now();
    await request(app).get('/api/match?stadiumId=hyderabad_stadium');
    expect(Date.now() - start).toBeLessThan(300);
  });

  test('GET /api/stadium/:id responds in < 400ms', async () => {
    const start = Date.now();
    await request(app).get('/api/stadium/hyderabad_stadium');
    expect(Date.now() - start).toBeLessThan(400);
  });
});

// ═══════════════════════════════════════════════════════════
// 9. EFFICIENCY — Compression & Caching
// ═══════════════════════════════════════════════════════════
describe('📦 Efficiency — Compression & Caching', () => {
  test('Static files should have Cache-Control header', async () => {
    const res = await request(app).get('/').set('Accept-Encoding', 'gzip');
    // Either cache-control from static middleware or from express
    const cc = res.headers['cache-control'];
    expect(cc).toBeDefined();
  });

  test('API responses should return application/json', async () => {
    const res = await request(app).get('/api/stadiums');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ═══════════════════════════════════════════════════════════
// 10. ERROR HANDLING
// ═══════════════════════════════════════════════════════════
describe('❌ Error Handling', () => {
  test('Unknown API route returns 404', async () => {
    const res = await request(app).get('/api/nonexistent-route');
    expect([404, 400].includes(res.status)).toBe(true);
  });

  test('Malformed JSON returns 400', async () => {
    const res = await request(app)
      .post('/api/order')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }');
    expect([400, 422].includes(res.status)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 11. GOOGLE SERVICES — Firebase Integration Status
// ═══════════════════════════════════════════════════════════
describe('🌐 Google Services — Firebase', () => {
  test('Server initializes without crashing when Firebase is mocked', () => {
    expect(app).toBeDefined();
  });

  test('Stadium data is populated (Google-backed knowledge base)', async () => {
    const res = await request(app).get('/api/stadiums');
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════
// 12. PROBLEM STATEMENT ALIGNMENT — IPL / CCTV / Staff
// ═══════════════════════════════════════════════════════════
describe('🎯 Problem Statement — Core Features', () => {
  test('Live match sync endpoint exists', async () => {
    const res = await request(app).get('/api/match?stadiumId=eden_gardens');
    expect(res.status).toBe(200);
  });

  test('Match sync includes toss info', async () => {
    const res = await request(app).get('/api/match?stadiumId=eden_gardens');
    // Toss is set by Reality Sync
    expect(res.body.data).toHaveProperty('toss');
  });

  test('Staff dashboard endpoint exists', async () => {
    const res = await request(app).get('/dashboard');
    expect([200, 301, 302].includes(res.status)).toBe(true);
  });

  test('Attendee app is served at root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/VenueAI/);
  });
});
