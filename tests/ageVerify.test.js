/**
 * Age verification: webhooks are a trigger only, results are fetched from the
 * provider and mapped via the stored reference; dev shortcuts stay dev-only.
 */
const crypto = require("crypto");

jest.mock("../src/config/database", () => ({
  user: { findUnique: jest.fn(), update: jest.fn() },
}));

const prisma = require("../src/config/database");
const config = require("../src/config");
const ageVerifyService = require("../src/services/ageVerifyService");

const SECRET = "whsec_test";
const sign = (body) => crypto.createHmac("sha256", SECRET).update(body).digest("hex");
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

const completedEvent = Buffer.from(JSON.stringify({
  payload: { resource_type: "check", action: "check.completed", object: { id: "check-1", status: "complete" } },
}));

function mockOnfido({ result = "clear", applicantId = "applicant-1", dob = yearsAgo(30) } = {}) {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith("/checks/check-1")) return { ok: true, json: async () => ({ id: "check-1", applicant_id: applicantId, result }) };
    if (url.includes("/reports?check_id=check-1")) {
      return { ok: true, json: async () => ({ reports: [{ name: "document", properties: { date_of_birth: dob } }] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const savedEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  config.env = "development";
  config.ageVerifyProvider = "onfido";
  process.env.AGE_VERIFY_WEBHOOK_SECRET = SECRET;
  process.env.AGE_VERIFY_API_KEY = "key";
});
afterAll(() => { process.env = savedEnv; });

describe("Onfido webhook", () => {
  test("rejects a bad signature with 403", async () => {
    await expect(ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": "0".repeat(64) }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test("rejects a signature of the wrong length with 403, not a crash", async () => {
    await expect(ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": "short" }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test("rejects everything when no webhook secret is configured", async () => {
    delete process.env.AGE_VERIFY_WEBHOOK_SECRET;
    await expect(ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": sign(completedEvent) }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test("verifies the user found via the stored reference, using the fetched result", async () => {
    mockOnfido();
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", ageVerifyRegion: "AU" });

    const res = await ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": sign(completedEvent) });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { ageVerifyRef: "applicant-1" } }));
    expect(res).toMatchObject({ userId: "user-1", passed: true });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ ageVerified: true, ageVerifyRef: null });
  });

  test("does not verify a user who is under age for their region", async () => {
    mockOnfido({ dob: yearsAgo(19) });
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", ageVerifyRegion: "US" });

    const res = await ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": sign(completedEvent) });

    expect(res.passed).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("does not verify when the provider result is not clear", async () => {
    mockOnfido({ result: "consider" });
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", ageVerifyRegion: "AU" });

    const res = await ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": sign(completedEvent) });
    expect(res.passed).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("ignores results for unknown references", async () => {
    mockOnfido();
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await ageVerifyService.processWebhook(completedEvent, { "x-sha2-signature": sign(completedEvent) });
    expect(res).toEqual({ ignored: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("dev-only shortcuts", () => {
  test("mock provider is refused in production", async () => {
    config.env = "production";
    config.ageVerifyProvider = "mock";
    await expect(ageVerifyService.processWebhook(Buffer.from("{}"), {})).rejects.toMatchObject({ statusCode: 503 });
  });

  test("manual verification requires the mock provider", async () => {
    await expect(ageVerifyService.manualVerify("user-1", { passed: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("manual verification is refused in production even with the mock provider", async () => {
    config.env = "production";
    config.ageVerifyProvider = "mock";
    await expect(ageVerifyService.manualVerify("user-1", { passed: true })).rejects.toMatchObject({ statusCode: 403 });
  });

  test("manual verification works with the mock provider in development", async () => {
    config.ageVerifyProvider = "mock";
    await expect(ageVerifyService.manualVerify("user-1", { passed: true, dateOfBirth: yearsAgo(30) }))
      .resolves.toMatchObject({ passed: true });
  });
});
