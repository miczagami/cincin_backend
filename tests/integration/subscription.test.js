/**
 * Smoke: subscription checkout over HTTP. Stripe isn't configured here, so checkout runs in
 * development mock mode; what matters is what the route accepts and where it sends the player.
 */
const { startServer, client, createUser } = require("./helpers");

let server;
let api;

beforeAll(async () => {
  server = await startServer();
  api = client(server.url);
});
afterAll(() => server.close());

test("checkout refuses a plan CinCin doesn't sell", async () => {
  const player = await createUser();
  const token = await api.login(player.email);

  const res = await api.post("/subscription/checkout", { plan: "weekly" }, { token });

  expect(res.status).toBe(400);
});

test("checkout sends the player back to the app, whatever return links the request names", async () => {
  const player = await createUser();
  const token = await api.login(player.email);

  const res = await api.post("/subscription/checkout", {
    plan: "monthly", successUrl: "https://evil.example/phish", cancelUrl: "https://evil.example/cancel",
  }, { token });

  expect(res.status).toBe(200);
  expect(new URL(res.body.url).origin).toBe(new URL(process.env.APP_URL || "https://app.playcincin.com").origin);
});
