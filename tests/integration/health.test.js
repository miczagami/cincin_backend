/**
 * Smoke: GET /health runs its database check against real Postgres.
 */
const { startServer } = require("./helpers");

let server;
beforeAll(async () => { server = await startServer(); });
afterAll(() => server.close());

test("/health is ok when the database answers", async () => {
  const res = await fetch(`${server.url}/health`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", database: "connected" });
});
