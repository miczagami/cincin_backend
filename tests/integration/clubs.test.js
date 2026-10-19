/**
 * Smoke: Cellar Clubs — list/detail, create, join by invite code, game approval feeding the leaderboard.
 */
const { startServer, client, createUser } = require("./helpers");

const BOTTLE_ID = "seed-penfolds-bin-389-cabernet-shiraz";

let server;
let api;
let hostToken;

beforeAll(async () => {
  server = await startServer();
  api = client(server.url);
  hostToken = await api.login("host@test.com");
});
afterAll(() => server.close());

/** Play a minimal completed pass-the-phone game as the host. */
async function completedGame() {
  const game = (await api.post("/games", {
    bottleId: BOTTLE_ID, multiplayerType: "PASS_THE_PHONE", guestPlayerNames: ["Guesty"],
  }, { token: hostToken })).body;
  await api.post(`/games/${game.id}/start`, undefined, { token: hostToken });
  await api.post(`/games/${game.id}/guess`, { guessText: "vanilla" }, { token: hostToken });
  await api.post(`/games/${game.id}/end`, undefined, { token: hostToken });
  return game.id;
}

test("seeded club appears in the list with its season and loads in detail", async () => {
  const list = await api.get("/clubs", { token: hostToken });
  expect(list.status).toBe(200);
  const club = list.body.find((c) => c.name === "Friday Night Vino");
  expect(club).toMatchObject({ id: expect.any(String), role: "ADMIN", currentSeason: expect.objectContaining({ status: "ACTIVE" }) });

  const detail = await api.get(`/clubs/${club.id}`, { token: hostToken });
  expect(detail.status).toBe(200);
  expect(detail.body).toMatchObject({ isAdmin: true, activeSeason: expect.any(Object) });

  const activity = await api.get(`/clubs/${club.id}/activity`, { token: hostToken });
  expect(activity.body).toHaveProperty("activities");
});

test("create → join by invite code → tag game → approve → leaderboard", async () => {
  const created = await api.post("/clubs", { name: `Smoke Club ${Date.now()}`, seasonType: "ROLLING" }, { token: hostToken });
  expect(created.status).toBe(201);
  const { id: clubId, inviteCode } = created.body;

  // Non-members can't see it; joining by code grants access
  const member = await createUser();
  const memberToken = await api.login(member.email);
  expect((await api.get(`/clubs/${clubId}`, { token: memberToken })).status).toBe(403);
  const joined = await api.post("/clubs/join", { inviteCode }, { token: memberToken });
  expect(joined.body).toMatchObject({ clubId });
  expect((await api.get(`/clubs/${clubId}`, { token: memberToken })).status).toBe(200);

  // A completed game tagged to the club waits for admin approval
  const gameId = await completedGame();
  expect((await api.post(`/clubs/${clubId}/games/${gameId}/tag`, undefined, { token: hostToken })).status).toBe(200);
  const pending = await api.get(`/clubs/${clubId}/games/pending`, { token: hostToken });
  expect(pending.body.map((g) => g.id)).toContain(gameId);

  // Only the admin can approve
  expect((await api.post(`/clubs/${clubId}/games/${gameId}/approve`, undefined, { token: memberToken })).status).toBe(403);
  expect((await api.post(`/clubs/${clubId}/games/${gameId}/approve`, undefined, { token: hostToken })).status).toBe(200);

  const board = await api.get(`/clubs/${clubId}/leaderboard`, { token: memberToken });
  expect(board.body.leaderboard).toEqual([expect.objectContaining({ displayName: "Test Host", gamesPlayed: 1, rank: 1 })]);
});

test("unverified users can't create or join clubs", async () => {
  const user = await createUser({ emailVerified: false });
  const token = await api.login(user.email);
  const res = await api.post("/clubs", { name: "Nope Club" }, { token });
  expect(res.status).toBe(403);
});
