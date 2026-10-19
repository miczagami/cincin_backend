/**
 * Smoke: signup, email verification, sessions, password flows, age verification, security rejections.
 */
const { startServer, client, createUser, prisma, PASSWORD } = require("./helpers");
const notificationService = require("../../src/services/notificationService");

let server;
let api;
const emailSpy = jest.spyOn(notificationService, "sendAccountEmail");
const lastLinkToken = () => new URL(emailSpy.mock.calls.at(-1)[1].actionUrl).searchParams.get("token");

beforeAll(async () => {
  server = await startServer();
  api = client(server.url);
});
afterAll(() => server.close());
beforeEach(() => emailSpy.mockClear());

describe("signup and email verification", () => {
  test("signup emails a link that verifies the account", async () => {
    const email = `signup${Date.now()}@test.com`;
    const signup = await api.post("/auth/signup", { email, password: PASSWORD, displayName: "New Taster" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.emailVerified).toBe(false);
    expect(emailSpy).toHaveBeenCalledWith(email, expect.objectContaining({ type: "email_verification" }));

    const verify = await api.post("/auth/verify-email", { token: lastLinkToken() });
    expect(verify.status).toBe(200);

    const me = await api.get("/users/me", { token: signup.body.accessToken });
    expect(me.body.emailVerified).toBe(true);
  });

  test("resend sends a new link while unverified", async () => {
    const user = await createUser({ emailVerified: false });
    const token = await api.login(user.email);
    const res = await api.post("/auth/verify-email/resend", undefined, { token });
    expect(res.status).toBe(200);
    expect(emailSpy).toHaveBeenCalledWith(user.email, expect.anything());
  });

  test("a tampered link is rejected", async () => {
    const res = await api.post("/auth/verify-email", { token: "not-a-token" });
    expect(res.status).toBe(400);
  });
});

describe("sessions", () => {
  test("wrong password is rejected", async () => {
    const res = await api.post("/auth/login", { email: "host@test.com", password: "WrongPass1" });
    expect(res.status).toBe(401);
  });

  test("refresh issues a new access token; refresh tokens can't call the API", async () => {
    const login = await api.post("/auth/login", { email: "host@test.com", password: PASSWORD });
    const { accessToken, refreshToken } = login.body;

    expect((await api.get("/users/me", { token: accessToken })).status).toBe(200);
    expect((await api.get("/users/me", { token: refreshToken })).status).toBe(401);

    const refreshed = await api.post("/auth/refresh", { refreshToken });
    expect(refreshed.status).toBe(200);
    expect((await api.get("/users/me", { token: refreshed.body.accessToken })).status).toBe(200);
  });
});

describe("passwords", () => {
  test("change password", async () => {
    const user = await createUser();
    const token = await api.login(user.email);

    const wrong = await api.post("/auth/change-password", { currentPassword: "Nope1234", newPassword: "Changed123" }, { token });
    expect(wrong.status).toBe(401);

    const ok = await api.post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "Changed123" }, { token });
    expect(ok.status).toBe(200);
    await expect(api.login(user.email, "Changed123")).resolves.toBeTruthy();
  });

  test("reset password via the emailed link, once", async () => {
    const user = await createUser();
    await api.post("/auth/password-reset/request", { email: user.email });
    expect(emailSpy).toHaveBeenCalledWith(user.email, expect.objectContaining({ type: "password_reset" }));
    const token = lastLinkToken();

    const reset = await api.post("/auth/password-reset", { token, newPassword: "ResetPass9" });
    expect(reset.status).toBe(200);
    await expect(api.login(user.email, "ResetPass9")).resolves.toBeTruthy();

    const reuse = await api.post("/auth/password-reset", { token, newPassword: "Another123" });
    expect(reuse.status).toBe(400);
  });

  test("reset request doesn't reveal unknown emails", async () => {
    const res = await api.post("/auth/password-reset/request", { email: "nobody-here@test.com" });
    expect(res.status).toBe(200);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});

describe("age verification (mock provider)", () => {
  test("unverified users can't play", async () => {
    const user = await createUser({ ageVerified: false });
    const token = await api.login(user.email);
    expect((await api.get("/scan/search?q=Penfolds", { token })).status).toBe(403);
  });

  test("provider result maps to the user and enforces the region's age", async () => {
    const user = await createUser({ ageVerified: false });
    const token = await api.login(user.email);

    const initiate = await api.post("/auth/age-verify/initiate", { region: "US" }, { token });
    expect(initiate.status).toBe(200);
    const ref = initiate.body.checkId;

    const yearsAgo = (n) => new Date(Date.now() - n * 366 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const underage = await api.post("/auth/age-verify/webhook", { ref, dateOfBirth: yearsAgo(20) });
    expect(underage.body).toMatchObject({ passed: false });
    expect((await api.get("/auth/age-verify/status", { token })).body.verified).toBe(false);

    const ofAge = await api.post("/auth/age-verify/webhook", { ref, dateOfBirth: yearsAgo(30) });
    expect(ofAge.body).toMatchObject({ passed: true, userId: user.id });
    expect((await api.get("/auth/age-verify/status", { token })).body.verified).toBe(true);
  });

  test("dev manual verification works with the mock provider", async () => {
    const user = await createUser({ ageVerified: false });
    const token = await api.login(user.email);
    const res = await api.post("/auth/age-verify/manual", { passed: true, dateOfBirth: "1990-01-15" }, { token });
    expect(res.body).toMatchObject({ passed: true });
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.ageVerified).toBe(true);
  });
});

describe("security rejections", () => {
  test("social login can't be forged from the request body", async () => {
    const res = await api.post("/auth/social", {
      provider: "GOOGLE", token: "forged", email: "host@test.com", socialProviderId: "x",
    });
    expect([401, 503]).toContain(res.status);
    expect(res.body.accessToken).toBeUndefined();
  });

  test("unsigned Stripe webhooks are rejected", async () => {
    const res = await api.post("/subscription/webhook", { type: "checkout.session.completed" });
    expect(res.status).toBe(503);
  });
});
