/**
 * The links the backend sends (push, email, invites) open the app's real screens.
 * The app's own suite (cincin_frontend tests/e2e/links.spec.js) opens every path in
 * services/appLinks.js; these tests pin that the backend's links come from there.
 */
jest.mock("../src/config/database", () => ({})); // links need no database

const config = require("../src/config");
const notificationService = require("../src/services/notificationService");
const { appPaths } = require("../src/services/appLinks");

const APP = config.appUrl;

describe("push and email deep links", () => {
  test.each([
    [{ type: "game_invite", gameCode: "ABC123" }, "/game/join?code=ABC123"],
    [{ type: "game_invite" }, "/game/join"],
    [{ type: "season_ending", clubId: "club-1" }, "/clubs/club-1/season-end"],
    [{ type: "season_ended", clubId: "club-1" }, "/clubs/club-1/season-end"],
    [{ type: "club_member_joined", clubId: "club-1" }, "/clubs/club-1"],
    [{ type: "weekly_standings", clubId: "club-1" }, "/clubs/club-1"],
    [{ type: "club_game_approved" }, "/clubs"],
    [{ type: "palate_updated" }, "/palate/profile"],
    [{ type: "monthly_palate_wrapped" }, "/palate/wrapped"],
    [{ type: "payment_failed" }, "/subscription"],
    [{ type: "something_new" }, "/notifications"],
  ])("%o links to %s", (data, path) => {
    expect(notificationService.buildDeepLink(data)).toBe(`${APP}${path}`);
  });

  test("IDs and codes are encoded into the path", () => {
    expect(notificationService.buildDeepLink({ type: "season_ended", clubId: "a/b c" })).toBe(`${APP}/clubs/a%2Fb%20c/season-end`);
    expect(notificationService.buildDeepLink({ type: "game_invite", gameCode: "A&B" })).toBe(`${APP}/game/join?code=A%26B`);
  });
});

describe("the app paths the backend links to", () => {
  test("a club invite opens the club join screen with its code", () => {
    expect(appPaths.clubJoin({ inviteCode: "WINE42" })).toBe("/clubs/join?code=WINE42");
  });

  test("every path is a same-app path, built from named params alone", () => {
    const params = { gameCode: "ABC123", inviteCode: "WINE42", clubId: "club-1", token: "t0k" };
    for (const [name, pathFor] of Object.entries(appPaths)) {
      expect(pathFor(params)).toMatch(/^\/(?!\/)/, name);
    }
  });
});
