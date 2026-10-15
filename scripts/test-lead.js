// Tests api/lead.js with mock req/res objects and a mocked fetch (no network, no Resend account).
// Run:  node scripts/test-lead.js
const assert = require('assert');
const handler = require('../api/lead.js');

const ENV = { RESEND_API_KEY: 're_test', LEAD_TO_EMAIL: 'owner@example.com, office@example.com', LEAD_FROM_EMAIL: 'On Q Website <leads@onqasphalt.com>' };
let calls = [];
let fetchReply = { ok: true, status: 200, body: { id: 'email_123' } };
global.fetch = async (url, opts) => {
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  if (fetchReply.throws) throw new Error('network down');
  return { ok: fetchReply.ok, status: fetchReply.status, json: async () => fetchReply.body, text: async () => JSON.stringify(fetchReply.body) };
};

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, redirectedTo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.redirect = (c, url) => { res.statusCode = c; res.redirectedTo = url; return res; };
  return res;
}
async function call({ method = 'POST', body, query = {}, json = true, env = ENV }) {
  for (const k of Object.keys(ENV)) delete process.env[k];
  Object.assign(process.env, env);
  calls = [];
  const req = { method, body, query, headers: json ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' } };
  const res = mockRes();
  const origError = console.error;
  console.error = () => {};
  try { await handler(req, res); } finally { console.error = origError; }
  return res;
}

const lead = {
  form_name: 'Free on-site quote', first_name: 'Jane', last_name: 'Doe', phone: '505-555-0100', email: 'jane@example.com',
  address: '87124', property_type: 'Business parking lot', services: ['Crack filling & sealing', 'Sealcoating', 'Striping'],
  size: 'Small lot', timeframe: 'Within a month', military: 'Yes', message: 'Lines are faded <b>badly</b>', page: '/free-quote/', company: '',
};

const tests = {
  async 'success: JSON post emails the lead and returns ok'() {
    fetchReply = { ok: true, status: 200, body: { id: 'x' } };
    const res = await call({ body: lead });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { ok: true });
    assert.strictEqual(calls.length, 1);
    const sent = calls[0].body;
    assert.strictEqual(calls[0].url, 'https://api.resend.com/emails');
    assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer re_test');
    assert.deepStrictEqual(sent.to, ['owner@example.com', 'office@example.com']);
    assert.strictEqual(sent.reply_to, 'jane@example.com');
    assert.match(sent.subject, /Jane Doe/);
    assert.match(sent.text, /Veteran \/ active military: Yes/);
    assert.match(sent.html, /&lt;b&gt;badly&lt;\/b&gt;/, 'message is HTML-escaped');
  },
  async 'services checkboxes arrive as a readable list'() {
    const res = await call({ body: lead });
    assert.strictEqual(res.statusCode, 200);
    const { text, html } = calls[0].body;
    assert.match(text, /Services needed:\n  - Crack filling & sealing\n  - Sealcoating\n  - Striping/);
    assert.match(html, /<ul[^>]*><li>Crack filling &amp; sealing<\/li><li>Sealcoating<\/li><li>Striping<\/li><\/ul>/);
    // A single checked box (string, not array) still works
    await call({ body: { ...lead, services: 'Sealcoating' } });
    assert.match(calls[0].body.text, /Services needed:\n  - Sealcoating\nApproximate/);
  },
  async 'honeypot: pretends success and sends nothing'() {
    const res = await call({ body: { ...lead, company: 'Spam Inc' } });
    assert.deepStrictEqual(res.body, { ok: true });
    assert.strictEqual(calls.length, 0);
  },
  async 'missing name or phone → 400'() {
    let res = await call({ body: { ...lead, first_name: '' } });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.ok, false);
    res = await call({ body: { ...lead, phone: '  ' } });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(calls.length, 0);
  },
  async 'missing env vars → 500, nothing sent'() {
    const res = await call({ body: lead, env: { RESEND_API_KEY: 're_test' } });
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error, 'Form is not configured yet.');
    assert.strictEqual(calls.length, 0);
  },
  async 'Resend error → 502'() {
    fetchReply = { ok: false, status: 403, body: { message: 'domain not verified' } };
    let res = await call({ body: lead });
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.ok, false);
    fetchReply = { throws: true };
    res = await call({ body: lead });
    assert.strictEqual(res.statusCode, 502);
    fetchReply = { ok: true, status: 200, body: { id: 'x' } };
  },
  async 'plain urlencoded post (no JS) → 303 redirect to /thank-you/'() {
    const params = new URLSearchParams({ first_name: 'Bo', phone: '5055550101', property_type: 'Home driveway' });
    params.append('services', 'Repair');
    params.append('services', 'Not sure');
    const res = await call({ body: params.toString(), json: false });
    assert.strictEqual(res.statusCode, 303);
    assert.strictEqual(res.redirectedTo, '/thank-you/');
    assert.match(calls[0].body.text, /Services needed:\n  - Repair\n  - Not sure/);
    // Vercel may pre-parse urlencoded bodies into an object with arrays
    const res2 = await call({ body: { first_name: 'Bo', phone: '1', services: ['Repair', 'Striping'] }, json: false });
    assert.strictEqual(res2.statusCode, 303);
    // No-JS validation error returns plain text, not JSON
    const res3 = await call({ body: 'first_name=&phone=', json: false });
    assert.strictEqual(res3.statusCode, 400);
    assert.strictEqual(typeof res3.body, 'string');
  },
  async 'GET without ?check → 405'() {
    const res = await call({ method: 'GET' });
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.headers.Allow, 'POST');
  },
  async '?check reports booleans and sender domain, never values'() {
    const res = await call({ method: 'GET', query: { check: '' } });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(
      { k: res.body.RESEND_API_KEY, t: res.body.LEAD_TO_EMAIL, f: res.body.LEAD_FROM_EMAIL, d: res.body.senderDomain },
      { k: true, t: true, f: true, d: 'onqasphalt.com' }
    );
    assert.ok(!JSON.stringify(res.body).includes('re_test'), 'API key never echoed');
    assert.ok(!JSON.stringify(res.body).includes('owner@example.com'), 'recipient never echoed');
    assert.strictEqual(res.body.testEmail, undefined);
    assert.strictEqual(calls.length, 0);
    const empty = await call({ method: 'GET', query: { check: '' }, env: {} });
    assert.deepStrictEqual([empty.body.RESEND_API_KEY, empty.body.LEAD_TO_EMAIL, empty.body.LEAD_FROM_EMAIL], [false, false, false]);
  },
  async '?check&send= only sends to a LEAD_TO_EMAIL address'() {
    let res = await call({ method: 'GET', query: { check: '', send: 'stranger@evil.com' } });
    assert.strictEqual(res.body.testEmail.sent, false);
    assert.strictEqual(calls.length, 0);
    res = await call({ method: 'GET', query: { check: '', send: 'Office@Example.com' } });
    assert.strictEqual(res.body.testEmail.sent, true);
    assert.strictEqual(res.body.testEmail.resendStatus, 200);
    assert.deepStrictEqual(calls[0].body.to, ['office@example.com']);
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log(`  ✔ ${name}`); } catch (e) { failed++; console.log(`  ✘ ${name}\n    ${e.message}`); }
  }
  console.log(failed ? `\n${failed} test(s) failed` : `\nAll ${Object.keys(tests).length} lead API tests passed`);
  process.exit(failed ? 1 : 0);
})();
