/**
 * Game results feed the palate profile: category stats (aggregate + per drink
 * type, as percentages) and the per-game trend snapshot.
 */
jest.mock("../src/config/database", () => ({
  palateCategory: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  palateSnapshot: { upsert: jest.fn() },
}));

const prisma = require("../src/config/database");
const { recordGameResults } = require("../src/services/palateProfileService");

beforeEach(() => jest.clearAllMocks());

const guesses = [
  { category: "berry", isCorrect: true },
  { category: "berry", isCorrect: false },
  { category: "oak", isCorrect: true },
];

test("creates aggregate and per-drink-type category rows and a snapshot", async () => {
  prisma.palateCategory.findFirst.mockResolvedValue(null);

  await recordGameResults("u1", "g1", { drinkType: "WINE", guesses });

  const created = prisma.palateCategory.create.mock.calls.map(([{ data }]) => data);
  expect(created).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: "berry", drinkType: null, totalGuesses: 2, correctGuesses: 1, accuracy: 50, gamesAppearedIn: 1 }),
    expect.objectContaining({ category: "berry", drinkType: "WINE", totalGuesses: 2, correctGuesses: 1, accuracy: 50 }),
    expect.objectContaining({ category: "oak", drinkType: null, accuracy: 100 }),
  ]));
  expect(created).toHaveLength(4);

  const snapshot = prisma.palateSnapshot.upsert.mock.calls[0][0];
  expect(snapshot.where).toEqual({ userId_gameId: { userId: "u1", gameId: "g1" } });
  expect(snapshot.create).toMatchObject({ correctGuesses: 2, totalGuesses: 3 });
  expect(snapshot.create.overallAccuracy).toBeCloseTo(66.67, 1);
});

test("adds to existing rows instead of duplicating them", async () => {
  prisma.palateCategory.findFirst.mockResolvedValue({ id: "row", totalGuesses: 2, correctGuesses: 2, gamesAppearedIn: 3 });

  await recordGameResults("u1", "g2", { drinkType: null, guesses: [{ category: "berry", isCorrect: false }] });

  expect(prisma.palateCategory.create).not.toHaveBeenCalled();
  expect(prisma.palateCategory.update).toHaveBeenCalledWith({
    where: { id: "row" },
    data: expect.objectContaining({ totalGuesses: 3, correctGuesses: 2, gamesAppearedIn: 4 }),
  });
});

test("records nothing for a player with no guesses", async () => {
  await recordGameResults("u1", "g3", { drinkType: "WINE", guesses: [] });
  expect(prisma.palateCategory.create).not.toHaveBeenCalled();
  expect(prisma.palateSnapshot.upsert).not.toHaveBeenCalled();
});
