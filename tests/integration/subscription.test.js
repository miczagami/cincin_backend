/**
 * Smoke: subscription checkout over HTTP. Stripe isn't configured here, so checkout runs in
 * development mock mode. That Stripe gets only APP_URL return links is covered by
 * tests/stripeReturnLinks.test.js, against a mocked Stripe client.
 */
const { startServer, client, createUser } = require("./helpers");

let server;
let api;

beforeAll(async () => {
  server = await startServer();
  api = client(server.url);
});
afterAll(() => server.close());

test.each([["weekly"], [["monthly"]], [{ plan: "monthly" }]])("checkout refuses a plan CinCin doesn't sell: %j", async (plan) => {
  const player = await createUser();
  const token = await api.login(player.email);

  const res = await api.post("/subscription/checkout", { plan }, { token });

  expect(res.status).toBe(400);
});

test("development checkout lands the player on the app's success screen", async () => {
  const player = await createUser();
  const token = await api.login(player.email);

  const res = await api.post("/subscription/checkout", { plan: "monthly" }, { token });

  expect(res.status).toBe(200);
  const landing = new URL(res.body.url);
  expect(landing.origin).toBe(new URL(process.env.APP_URL || "https://app.playcincin.com").origin);
  expect(landing.pathname).toBe("/subscription/success");
});
