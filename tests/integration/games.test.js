/**
 * Smoke: scan → pass-the-phone game → results → palate profile, and a multi-device game over sockets.
 */
const { startServer, client, connectSocket, emitAck, nextEvent, prisma } = require("./helpers");

const BOTTLE_ID = "seed-penfolds-bin-389-cabernet-shiraz"; // tasting notes include blackberry, cedar, vanilla

let server;
let api;
let hostToken;
let hostId;

beforeAll(async () => {
  server = await startServer();
  api = client(server.url);
  hostToken = await api.login("host@test.com");
  hostId = (await api.get("/users/me", { token: hostToken })).body.id;
});
afterAll(() => server.close());

describe("scan", () => {
  test("search, confirm (without revealing notes) and taxonomy autocomplete", async () => {
    const search = await api.get("/scan/search?q=Penfolds", { token: hostToken });
    expect(search.status).toBe(200);
    expect(search.body.map((b) => b.id)).toContain(BOTTLE_ID);

    const confirm = await api.post(`/scan/confirm/${BOTTLE_ID}`, undefined, { token: hostToken });
    expect(confirm.status).toBe(200);
    expect(confirm.body.noteRange).toEqual({ low: expect.any(Number), high: expect.any(Number) });
    expect(JSON.stringify(confirm.body)).not.toMatch(/blackberry/i);

    const taxonomy = await api.get("/scan/taxonomy/search?q=ber", { token: hostToken });
    expect(taxonomy.body.map((n) => n.name)).toContain("berry");
  });
});

describe("pass-the-phone game", () => {
  let gameId;
  let guest;

  test("create with a guest player", async () => {
    const res = await api.post("/games", {
      bottleId: BOTTLE_ID, multiplayerType: "PASS_THE_PHONE", guestPlayerNames: ["Guesty"],
    }, { token: hostToken });
    expect(res.status).toBe(201);
    expect(res.body.gameCode).toMatch(/^[A-Z0-9]{6}$/);
    gameId = res.body.id;

    const state = await api.get(`/games/${gameId}/state`, { token: hostToken });
    expect(state.body.game.status).toBe("LOBBY");
    expect(state.body.players.map((p) => p.displayName)).toEqual(["Test Host", "Guesty"]);
    guest = state.body.players.find((p) => p.type === "guest");
  });

  test("turns rotate host → guest → next round", async () => {
    expect((await api.post(`/games/${gameId}/start`, undefined, { token: hostToken })).status).toBe(200);

    let state = await api.get(`/games/${gameId}/state`, { token: hostToken });
    expect(state.body.currentTurn.displayName).toBe("Test Host");

    const hostGuess = await api.post(`/games/${gameId}/guess`, { guessText: "blackberry" }, { token: hostToken });
    expect(hostGuess.body).toMatchObject({ isCorrect: true, pointsAwarded: expect.any(Number) });

    // Guest's turn — but not yet: guessing out of turn is refused
    const early = await api.post(`/games/${gameId}/guess`, { guessText: "plum", isGuest: true, guestPlayerId: guest.id }, { token: hostToken });
    expect(early.status).toBe(400);

    expect((await api.post(`/games/${gameId}/advance`, undefined, { token: hostToken })).body.action).toBe("NEXT_TURN");
    state = await api.get(`/games/${gameId}/state`, { token: hostToken });
    expect(state.body.currentTurn).toMatchObject({ displayName: "Guesty", type: "guest" });

    const guestGuess = await api.post(`/games/${gameId}/guess`, { guessText: "bubblegum", isGuest: true, guestPlayerId: guest.id }, { token: hostToken });
    expect(guestGuess.body.isCorrect).toBe(false);

    const next = await api.post(`/games/${gameId}/advance`, undefined, { token: hostToken });
    expect(next.body).toMatchObject({ action: "NEXT_ROUND", round: 2 });
    state = await api.get(`/games/${gameId}/state`, { token: hostToken });
    expect(state.body.currentTurn.displayName).toBe("Test Host");
    expect(state.body.claimedNotes).toContain("blackberry");
  });

  test("end → results reveal notes and record a palate snapshot", async () => {
    expect((await api.post(`/games/${gameId}/end`, undefined, { token: hostToken })).status).toBe(200);

    const results = await api.get(`/games/${gameId}/results`, { token: hostToken });
    expect(results.status).toBe(200);
    expect(results.body.game.status).toBe("COMPLETED");
    expect(results.body.leaderboard.map((p) => p.displayName)).toEqual(["Test Host", "Guesty"]);
    expect(results.body.noteReveal.find((n) => n.note === "blackberry").guessed).toBe(true);

    const snapshot = await prisma.palateSnapshot.findUnique({ where: { userId_gameId: { userId: hostId, gameId } } });
    expect(snapshot).toMatchObject({ correctGuesses: 1, totalGuesses: 1 });

    // Ending again doesn't double-count palate stats
    await api.post(`/games/${gameId}/end`, undefined, { token: hostToken });
    const rows = await prisma.palateCategory.findMany({ where: { userId: hostId, category: "blackberry", drinkType: null } });
    expect(rows).toHaveLength(1);
  });
});

describe("multi-device game over sockets", () => {
  const sockets = [];
  afterAll(() => sockets.forEach((s) => s.close()));

  test("join, simultaneous round, reveal, next round, end", async () => {
    const p2Token = await api.login("player2@test.com");

    const created = await api.post("/games", { bottleId: BOTTLE_ID, multiplayerType: "MULTI_DEVICE" }, { token: hostToken });
    expect(created.status).toBe(201);
    const gameId = created.body.id;

    const joined = await api.post("/games/join", { gameCode: created.body.gameCode }, { token: p2Token });
    expect(joined.status).toBe(200);

    const host = await connectSocket(server.url, hostToken);
    const p2 = await connectSocket(server.url, p2Token);
    sockets.push(host, p2);
    await emitAck(host, "game:join", { gameId });
    await emitAck(p2, "game:join", { gameId });

    // Round 1 opens for everyone when the host starts
    const round1 = [host, p2].map((s) => nextEvent(s, "game:round-start", (d) => d.roundNumber === 1));
    await emitAck(host, "game:start", { gameId });
    await Promise.all(round1);

    // Both guess; the reveal goes to everyone once the last guess is in
    const reveals = [host, p2].map((s) => nextEvent(s, "game:round-reveal", (d) => d.roundNumber === 1));
    const round2 = [host, p2].map((s) => nextEvent(s, "game:round-start", (d) => d.roundNumber === 2));
    const hostResult = await emitAck(host, "game:guess", { gameId, guessText: "blackberry" });
    expect(hostResult.isCorrect).toBe(true);
    await emitAck(p2, "game:guess", { gameId, guessText: "cedar" });

    const [reveal] = await Promise.all(reveals);
    expect(reveal.claimedThisRound.map((n) => n.note).sort()).toEqual(["blackberry", "cedar"]);
    await Promise.all(round2); // server advances automatically

    const ended = [host, p2].map((s) => nextEvent(s, "game:ended"));
    expect((await api.post(`/games/${gameId}/end`, undefined, { token: hostToken })).status).toBe(200);
    await Promise.all(ended);

    const rounds = await prisma.round.findMany({ where: { gameId }, orderBy: { roundNumber: "asc" } });
    expect(rounds.map((r) => r.roundNumber)).toEqual([1, 2]);
  });
});
