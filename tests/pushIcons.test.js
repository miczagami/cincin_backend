/**
 * Web push notifications name icons the app actually serves (cincin_frontend/public:
 * icon-192.png and badge-72.png), so the notification shows the CinCin icon.
 */
const mockFcmSend = jest.fn(async () => "projects/test/messages/1");
jest.mock("firebase-admin", () => ({
  apps: [],
  credential: { cert: jest.fn(() => ({})) },
  initializeApp: jest.fn(),
  messaging: () => ({ send: mockFcmSend }),
}));
jest.mock("../src/config/database", () => ({
  pushToken: { findMany: jest.fn(async () => [{ id: "t1", token: "web-token-0123456789abcdef", platform: "web" }]) },
}));

const config = require("../src/config");
const notificationService = require("../src/services/notificationService");

beforeEach(() => {
  config.push.fcmServiceAccount = JSON.stringify({ project_id: "cincin-test" });
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("a web push names the app's icon and badge files", async () => {
  await notificationService.sendPushNotification("u1", { title: "Game invite", body: "Sam invited you", data: { type: "game_invite", gameCode: "ABC123" } });

  const { webpush } = mockFcmSend.mock.calls.at(-1)[0];
  expect(webpush.notification.icon).toBe("/icon-192.png");
  expect(webpush.notification.badge).toBe("/badge-72.png");
});
