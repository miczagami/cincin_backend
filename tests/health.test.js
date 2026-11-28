/**
 * GET /health over HTTP: it reports the database, so a wrong DATABASE_URL fails the health check.
 */
jest.mock("../src/config/database", () => ({ $queryRaw: jest.fn() }));

const prisma = require("../src/config/database");
const app = require("../src/app");
const { captureConsole } = require("./captureConsole");

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
let consoleOut;
beforeEach(() => { consoleOut = captureConsole(); });
afterEach(() => {
  consoleOut.restore();
  prisma.$queryRaw.mockReset();
});

test("a database that answers makes /health ok", async () => {
  prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

  const res = await fetch(`${base}/health`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", database: "connected" });
});

test("a failing database query makes /health fail without leaking connection details", async () => {
  prisma.$queryRaw.mockRejectedValue(
    new Error("Can't reach database server at `db.internal.example:5432` (user cincin, password hunter2)")
  );

  const res = await fetch(`${base}/health`);
  const text = await res.text();

  expect(res.status).toBe(503);
  expect(JSON.parse(text)).toMatchObject({ status: "error", database: "unreachable" });
  expect(text).not.toMatch(/db\.internal|5432|hunter2|cincin/);
  // The runbook sends operators to this log line for the reason
  expect(consoleOut.output()).toContain("[health] database query failed: Can't reach database server");
});

test("a database that never answers makes /health fail within its 2s timeout", async () => {
  prisma.$queryRaw.mockReturnValue(new Promise(() => {}));

  // Give up well past the 2s check timeout, so a hung check reads as no reply (status null)
  const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);

  expect(res?.status ?? null).toBe(503);
  expect(await res.json()).toMatchObject({ status: "error", database: "unreachable" });
  expect(consoleOut.output()).toContain("[health] database query failed: no reply within 2000ms");
}, 10000);

test("the liveness check stays ok while the database is down, so the platform doesn't restart the API", async () => {
  prisma.$queryRaw.mockRejectedValue(new Error("Can't reach database server"));

  const res = await fetch(`${base}/health/live`);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

test("the [health] log line itself names the cause when the driver's message spans lines", async () => {
  // Prisma's messages start with a newline and put the cause on a later line
  prisma.$queryRaw.mockRejectedValue(new Error("\nInvalid `prisma.$queryRaw()` invocation:\n\n\nAuthentication failed against database server"));

  await fetch(`${base}/health`);

  const line = consoleOut.output().split("\n").find((l) => l.startsWith("[health]"));
  expect(line).toContain("Authentication failed against database server");
});
