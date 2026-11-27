/**
 * Email sends log the recipient's user ID, never their email address, so
 * addresses stay out of host logs and error-monitoring breadcrumbs.
 */
jest.mock("@sendgrid/mail", () => ({ setApiKey: jest.fn(), send: jest.fn(async () => [{ statusCode: 202 }]) }));
jest.mock("../src/config/database", () => ({
  user: { findUnique: jest.fn() },
  notification: { create: jest.fn(async () => ({ id: "notif-1" })), update: jest.fn() },
}));

const prisma = require("../src/config/database");
const { captureConsole } = require("./captureConsole");
const config = require("../src/config");
const notificationService = require("../src/services/notificationService");

const USER = { id: "user-7f3a", email: "taster@example.com" };

const ACCOUNT_EMAIL = {
  type: "password_reset",
  subject: "Reset your CinCin password",
  heading: "Reset your password",
  body: "Tap the button below.",
  actionUrl: "http://app.test/auth/forgot-password?token=abc",
  actionLabel: "Reset password",
};

let captured;
const originalEnv = config.env;
const originalKey = config.email.sendgridApiKey;

beforeEach(() => {
  captured = captureConsole();
});

afterEach(() => {
  jest.restoreAllMocks();
  config.env = originalEnv;
  config.email.sendgridApiKey = originalKey;
});


describe("account emails", () => {
  test("a sent account email logs the user ID, not the address", async () => {
    config.env = "production";
    config.email.sendgridApiKey = "SG.test";

    await expect(notificationService.sendAccountEmail(USER.email, { ...ACCOUNT_EMAIL, userId: USER.id })).resolves.toBe(true);

    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });

  test("a failed account email logs the user ID, not the address", async () => {
    config.env = "production";
    config.email.sendgridApiKey = "SG.test";
    require("@sendgrid/mail").send.mockRejectedValueOnce(new Error("Bad Request"));

    await expect(notificationService.sendAccountEmail(USER.email, { ...ACCOUNT_EMAIL, userId: USER.id })).resolves.toBe(false);

    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });

  test("without SendGrid, the logged stand-in names the user ID, not the address", async () => {
    config.env = "development";
    config.email.sendgridApiKey = undefined;

    await expect(notificationService.sendAccountEmail(USER.email, { ...ACCOUNT_EMAIL, userId: USER.id })).resolves.toBe(true);

    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });
});

const NOTIFICATION_EMAIL = {
  type: "payment_failed",
  title: "Your payment didn't go through",
  body: "Update your card to keep Pro.",
  data: {},
};

describe("notification emails", () => {
  test("a sent notification email logs the user ID, not the address", async () => {
    config.env = "production";
    config.email.sendgridApiKey = "SG.test";

    await expect(notificationService.sendEmailNotification(USER.email, { ...NOTIFICATION_EMAIL, userId: USER.id })).resolves.toBe(true);

    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });

  test("a failed notification email logs the user ID, not the address", async () => {
    config.env = "production";
    config.email.sendgridApiKey = "SG.test";
    require("@sendgrid/mail").send.mockRejectedValueOnce(new Error("Bad Request"));

    await expect(notificationService.sendEmailNotification(USER.email, { ...NOTIFICATION_EMAIL, userId: USER.id })).resolves.toBe(false);

    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });

  test("without SendGrid in development, the logged stand-in names the user ID, not the address", async () => {
    config.env = "development";
    config.email.sendgridApiKey = undefined;

    await expect(notificationService.sendEmailNotification(USER.email, { ...NOTIFICATION_EMAIL, userId: USER.id })).resolves.toBe(true);

    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });
});

describe("delivering a notification", () => {
  test("the email it sends is logged under the recipient's user ID, not their address", async () => {
    config.env = "production";
    config.email.sendgridApiKey = "SG.test";
    prisma.user.findUnique.mockResolvedValue({ id: USER.id, email: USER.email, notifEmail: true, notifPush: false });

    const result = await notificationService.createNotification(USER.id, NOTIFICATION_EMAIL);

    expect(result.emailSent).toBe(true);
    expect(captured.output()).toContain(`user ${USER.id}`);
    expect(captured.output()).not.toContain(USER.email);
  });
});
