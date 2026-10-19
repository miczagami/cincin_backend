/**
 * Email verification links, password reset emails, and token-type enforcement.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

jest.mock("../src/config/database", () => ({
  user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  session: { create: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn() },
  passwordReset: { create: jest.fn(), findUnique: jest.fn() },
}));
jest.mock("../src/services/notificationService", () => ({ sendAccountEmail: jest.fn(async () => true) }));

const prisma = require("../src/config/database");
const notificationService = require("../src/services/notificationService");
const config = require("../src/config");
const authService = require("../src/services/authService");
const { requireAuth } = require("../src/middleware/auth");

const linkToken = () => new URL(notificationService.sendAccountEmail.mock.calls.at(-1)[1].actionUrl).searchParams.get("token");

beforeEach(() => jest.clearAllMocks());

describe("email verification", () => {
  test("signup emails a verification link to the new user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "u1", email: "new@test.com", emailVerified: false });

    await authService.signUp({ email: "new@test.com", password: "TestPass1", displayName: "New" });

    const [to, email] = notificationService.sendAccountEmail.mock.calls[0];
    expect(to).toBe("new@test.com");
    expect(email.actionUrl).toMatch(`${config.appUrl}/auth/verify-email?token=`);
  });

  test("signup still succeeds if the email can't be sent", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "u1", email: "new@test.com" });
    notificationService.sendAccountEmail.mockResolvedValueOnce(false);
    await expect(authService.signUp({ email: "new@test.com", password: "TestPass1", displayName: "New" }))
      .resolves.toHaveProperty("accessToken");
  });

  test("a valid link verifies the email", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@test.com", emailVerified: false });
    await authService.resendVerificationEmail("u1");

    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@test.com", emailVerified: false, deletedAt: null });
    await expect(authService.verifyEmail(linkToken())).resolves.toMatchObject({ emailVerified: true });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" }, data: expect.objectContaining({ emailVerified: true }),
    }));
  });

  test("a link for a previous email address is rejected", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "old@test.com", emailVerified: false });
    await authService.resendVerificationEmail("u1");

    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "new@test.com", emailVerified: false, deletedAt: null });
    await expect(authService.verifyEmail(linkToken())).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("an access token can't be used as a verification link", async () => {
    const access = jwt.sign({ userId: "u1", type: "access" }, config.jwt.secret);
    await expect(authService.verifyEmail(access)).rejects.toMatchObject({ statusCode: 400 });
  });

  test("resend is a no-op for already verified users", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@test.com", emailVerified: true });
    await expect(authService.resendVerificationEmail("u1")).resolves.toMatchObject({ emailVerified: true });
    expect(notificationService.sendAccountEmail).not.toHaveBeenCalled();
  });
});

describe("password reset email", () => {
  test("emails a link and stores only a hash of the token", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "a@test.com", deletedAt: null });
    await authService.requestPasswordReset("a@test.com");

    const token = linkToken();
    expect(notificationService.sendAccountEmail.mock.calls[0][1].actionUrl).toMatch("/auth/forgot-password?token=");
    const stored = prisma.passwordReset.create.mock.calls[0][0].data.token;
    expect(stored).not.toBe(token);
    expect(stored).toBe(crypto.createHash("sha256").update(token).digest("hex"));
  });

  test("does not reveal whether an account exists", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(authService.requestPasswordReset("nobody@test.com")).resolves.toHaveProperty("message");
    expect(notificationService.sendAccountEmail).not.toHaveBeenCalled();
  });
});

describe("requireAuth", () => {
  const run = async (token) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();
    await requireAuth(req, res, next);
    return { res, next };
  };

  const liveSession = { userId: "u1", expiresAt: new Date(Date.now() + 60_000), user: { id: "u1", deletedAt: null } };

  test.each(["refresh", "email_verify"])("rejects %s tokens", async (type) => {
    prisma.session.findUnique.mockResolvedValue(liveSession);
    const { res, next } = await run(jwt.sign({ userId: "u1", sid: "s1", type }, config.jwt.secret));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts access tokens with a live session", async () => {
    prisma.session.findUnique.mockResolvedValueOnce(liveSession);
    const { next } = await run(jwt.sign({ userId: "u1", sid: "s1", type: "access" }, config.jwt.secret));
    expect(prisma.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1" } }));
    expect(next).toHaveBeenCalledWith();
  });

  test.each([
    ["revoked", null],
    ["expired", { ...liveSession, expiresAt: new Date(Date.now() - 1000) }],
    ["someone else's", { ...liveSession, userId: "u2" }],
  ])("rejects access tokens whose session is %s", async (_label, session) => {
    prisma.session.findUnique.mockResolvedValueOnce(session);
    const { res, next } = await run(jwt.sign({ userId: "u1", sid: "s1", type: "access" }, config.jwt.secret));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects access tokens issued before sessions carried an id", async () => {
    const { res } = await run(jwt.sign({ userId: "u1", type: "access" }, config.jwt.secret));
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
