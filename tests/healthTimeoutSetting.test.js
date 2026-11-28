/**
 * GET /health with an unusable HEALTH_DB_TIMEOUT_MS: the check falls back to its default
 * timeout, so one bad variable can't fail the health check against a working database.
 */
jest.mock("../src/config/database", () => ({ $queryRaw: jest.fn() }));

const { captureConsole } = require("./captureConsole");

// A database that answers after 50ms: well inside the default, but past a broken timeout
const slowOk = () => new Promise((resolve) => setTimeout(() => resolve([{ "?column?": 1 }]), 50));

async function healthStatusWith(timeoutSetting) {
  let app;
  process.env.HEALTH_DB_TIMEOUT_MS = timeoutSetting;
  jest.isolateModules(() => {
    // The app reads config once on load, so load a fresh copy for each setting
    require("../src/config/database").$queryRaw.mockImplementation(slowOk);
    app = require("../src/app");
  });
  require("../src/config/database").$queryRaw.mockImplementation(slowOk);

  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const out = captureConsole();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    return res.status;
  } finally {
    out.restore();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

afterAll(() => { delete process.env.HEALTH_DB_TIMEOUT_MS; });

test.each(["-1", "99999999999"])("HEALTH_DB_TIMEOUT_MS=%s falls back to the default", async (setting) => {
  expect(await healthStatusWith(setting)).toBe(200);
});
