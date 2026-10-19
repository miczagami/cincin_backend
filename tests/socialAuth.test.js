/**
 * Social login must take identity only from a verified provider ID token.
 */
const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = require("jose");

jest.mock("../src/config/database", () => ({
  user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  session: { create: jest.fn(), deleteMany: jest.fn() },
}));

const prisma = require("../src/config/database");
const config = require("../src/config");
const { verifyIdToken, PROVIDERS } = require("../src/services/socialAuthService");
const authService = require("../src/services/authService");

const GOOGLE_AUD = "google-client-1";
let googleKey;
let otherKey;

async function googleToken(claims = {}, { key = googleKey, iss = "https://accounts.google.com", aud = GOOGLE_AUD, exp = "1h" } = {}) {
  return new SignJWT({ email: "Player.One@gmail.com", email_verified: true, name: "Player One", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject(claims.sub || "google-sub-1")
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key.privateKey);
}

beforeAll(async () => {
  googleKey = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(googleKey.publicKey)), kid: "test", alg: "RS256" };
  PROVIDERS.GOOGLE.jwks = createLocalJWKSet({ keys: [jwk] });
  PROVIDERS.APPLE.jwks = createLocalJWKSet({ keys: [jwk] });
});

beforeEach(() => {
  jest.clearAllMocks();
  config.social.googleClientIds = [GOOGLE_AUD];
  config.social.appleClientIds = ["com.cincin.web"];
});

describe("verifyIdToken", () => {
  test("returns the identity from a valid token, normalising email like signup", async () => {
    const identity = await verifyIdToken("GOOGLE", await googleToken());
    expect(identity).toEqual({
      providerUserId: "google-sub-1",
      email: "playerone@gmail.com",
      emailVerified: true,
      name: "Player One",
    });
  });

  test.each([
    ["wrong audience", { aud: "someone-elses-client" }],
    ["wrong issuer", { iss: "https://evil.example" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["signed by an unknown key", { key: null }],
  ])("rejects a token that is %s", async (_label, opts) => {
    const token = await googleToken({}, { ...opts, key: opts.key === null ? otherKey : googleKey });
    await expect(verifyIdToken("GOOGLE", token)).rejects.toMatchObject({ statusCode: 401 });
  });

  test("rejects garbage tokens", async () => {
    await expect(verifyIdToken("GOOGLE", "PLACEHOLDER")).rejects.toMatchObject({ statusCode: 401 });
  });

  test("returns 503 when the provider is not configured", async () => {
    config.social.googleClientIds = [];
    await expect(verifyIdToken("GOOGLE", await googleToken())).rejects.toMatchObject({ statusCode: 503 });
  });

  test("accepts Apple's string email_verified flag", async () => {
    const token = await googleToken({ email_verified: "true" }, { iss: "https://appleid.apple.com", aud: "com.cincin.web" });
    const identity = await verifyIdToken("APPLE", token);
    expect(identity.emailVerified).toBe(true);
  });
});

describe("authService.socialLogin", () => {
  test("ignores identity fields in the request body", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({ id: "new-user", ...data }));

    await authService.socialLogin({
      provider: "GOOGLE",
      token: await googleToken(),
      email: "victim@example.com",
      socialProviderId: "victim-sub",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "playerone@gmail.com" } });
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      email: "playerone@gmail.com",
      socialProviderId: "google-sub-1",
    });
  });

  test("does not link to an existing account when the email is unverified", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      authService.socialLogin({ provider: "GOOGLE", token: await googleToken({ email_verified: false }) })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test("rejects an unverifiable token before touching the database", async () => {
    await expect(authService.socialLogin({ provider: "GOOGLE", token: "forged" })).rejects.toMatchObject({ statusCode: 401 });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
