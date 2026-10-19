/**
 * Webhook endpoints over HTTP: raw-body handling and fail-closed behaviour.
 */
const crypto = require("crypto");

process.env.AGE_VERIFY_PROVIDER = "onfido";
process.env.AGE_VERIFY_WEBHOOK_SECRET = "whsec_test";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

jest.mock("../src/config/database", () => ({ user: { findUnique: jest.fn(), update: jest.fn() } }));

const app = require("../src/app");

let server;
let base;
beforeAll((done) => {
  server = app.listen(0, () => {
    base = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});
afterAll(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
}));

test("Stripe webhook is rejected when Stripe is not configured", async () => {
  const res = await fetch(`${base}/api/subscription/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "checkout.session.completed", data: { object: { metadata: { userId: "u1" } } } }),
  });
  expect(res.status).toBe(503);
});

test("age-verify webhook checks the signature over the raw body", async () => {
  // Whitespace survives only if the raw bytes are used (re-serialised JSON would differ)
  const body = '{ "payload": { "resource_type": "report", "action": "report.completed" } }';
  const sig = crypto.createHmac("sha256", "whsec_test").update(body).digest("hex");

  const good = await fetch(`${base}/api/auth/age-verify/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sha2-signature": sig },
    body,
  });
  expect(good.status).toBe(200);
  expect(await good.json()).toMatchObject({ received: true, ignored: true });

  const bad = await fetch(`${base}/api/auth/age-verify/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sha2-signature": "nope" },
    body,
  });
  expect(bad.status).toBe(403);
});
