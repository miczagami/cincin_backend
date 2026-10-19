/**
 * Rate limits behind a proxy: requests are keyed on the client IP header the proxy sets.
 */
process.env.CLIENT_IP_HEADER = "CF-Connecting-IP";
process.env.AUTH_RATE_LIMIT_MAX = "2";

jest.mock("../src/config/database", () => ({}));

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

// Unknown auth path: passes the limiters, then 404s without touching the database
const hit = (ip) => fetch(`${base}/api/auth/__limit-probe`, { headers: { "cf-connecting-ip": ip } });

test("each client IP gets its own limit even though all requests share one socket address", async () => {
  expect((await hit("203.0.113.1")).status).toBe(404);
  expect((await hit("203.0.113.1")).status).toBe(404);
  expect((await hit("203.0.113.1")).status).toBe(429);

  expect((await hit("203.0.113.2")).status).toBe(404);
});
