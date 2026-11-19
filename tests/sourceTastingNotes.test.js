/**
 * Tasting-note sourcing, as called by players when they confirm a scanned bottle.
 * The notes are the game's answers, so players only ever get counts back, and the
 * paid AI note-writing runs at most once per bottle.
 */
// The bottle's AI-attempt marker, with Prisma's conditional-update semantics: a
// claim succeeds only when no attempt is recorded, or the last one is older than `lt`.
let mockAttemptAt = null;
const mockDb = {
  bottle: {
    findUnique: jest.fn(),
    updateMany: jest.fn(async ({ where, data }) => {
      const olderThan = where.OR?.find((c) => c.notesSynthesisedAt?.lt)?.notesSynthesisedAt.lt;
      const claimable = mockAttemptAt === null || (olderThan && mockAttemptAt < olderThan);
      if (!claimable) return { count: 0 };
      mockAttemptAt = data.notesSynthesisedAt;
      return { count: 1 };
    }),
  },
  tastingNote: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
};
jest.mock("../src/config/database", () => mockDb);

const mockCreateMessage = jest.fn();
jest.mock("../src/services/aiClient", () => ({ createMessage: (...args) => mockCreateMessage(...args) }));

const scanService = require("../src/services/scanService");

const note = (id, text, sourceTier) => ({ id, bottleId: "b1", note: text, genericNote: null, sourceTier });

const bottle = (tastingNotes) => ({
  id: "b1", name: "Grange", category: "WINE", subcategory: "Shiraz", region: "Barossa", tastingNotes,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAttemptAt = null;
  process.env.ANTHROPIC_API_KEY = "test-key";
  mockDb.tastingNote.findUnique.mockResolvedValue(null);
  mockDb.tastingNote.create.mockResolvedValue({});
});

test("players get note counts back, never the notes themselves", async () => {
  const notes = [note("n1", "Blackcurrant", "PRODUCER"), note("n2", "Cedar", "CRITIC"), note("n3", "Mocha", "PRODUCER")];
  mockDb.bottle.findUnique.mockResolvedValue(bottle(notes));
  mockDb.tastingNote.findMany.mockResolvedValue(notes);

  const result = await scanService.sourceTastingNotes("b1");

  expect(result).toEqual({
    bottleId: "b1",
    totalNotes: 3,
    byTier: { producer: 2, critic: 1, aiSynthesised: 0 },
  });
  expect(JSON.stringify(result)).not.toMatch(/Blackcurrant|Cedar|Mocha/);
});

test("a bottle with no notes gets AI-written notes once", async () => {
  mockDb.bottle.findUnique.mockResolvedValue(bottle([]));
  mockDb.tastingNote.findMany.mockResolvedValue([note("n1", "Plum", "AI_SYNTHESISED")]);
  mockCreateMessage.mockResolvedValue({ text: '[{"note":"Plum","genericNote":"Stone fruit"}]' });

  await scanService.sourceTastingNotes("b1");

  expect(mockCreateMessage).toHaveBeenCalledTimes(1);
  expect(mockCreateMessage.mock.calls[0][0]).toBe("synthesis");
});

test("a bottle that already has AI-written notes is not sent to the AI again, even with fewer than 3 notes", async () => {
  const notes = [note("n1", "Plum", "AI_SYNTHESISED"), note("n2", "Oak", "AI_SYNTHESISED")];
  mockDb.bottle.findUnique.mockResolvedValue(bottle(notes));
  mockDb.tastingNote.findMany.mockResolvedValue(notes);

  const result = await scanService.sourceTastingNotes("b1");

  expect(mockCreateMessage).not.toHaveBeenCalled();
  expect(result.totalNotes).toBe(2);
});

test("after a failed AI attempt, the next request doesn't pay for another one", async () => {
  mockDb.bottle.findUnique.mockResolvedValue(bottle([]));
  mockDb.tastingNote.findMany.mockResolvedValue([]);
  mockCreateMessage.mockRejectedValue(new Error("timeout"));

  await scanService.sourceTastingNotes("b1");
  await scanService.sourceTastingNotes("b1");

  expect(mockCreateMessage).toHaveBeenCalledTimes(1);
});

test("parallel requests for the same bottle make one AI call", async () => {
  mockDb.bottle.findUnique.mockResolvedValue(bottle([]));
  mockDb.tastingNote.findMany.mockResolvedValue([]);
  mockCreateMessage.mockResolvedValue({ text: "[]" });

  await Promise.all([1, 2, 3].map(() => scanService.sourceTastingNotes("b1")));

  expect(mockCreateMessage).toHaveBeenCalledTimes(1);
});

test("a bottle whose last AI attempt was over a day ago is tried again", async () => {
  mockAttemptAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  mockDb.bottle.findUnique.mockResolvedValue(bottle([]));
  mockDb.tastingNote.findMany.mockResolvedValue([]);
  mockCreateMessage.mockResolvedValue({ text: "[]" });

  await scanService.sourceTastingNotes("b1");

  expect(mockCreateMessage).toHaveBeenCalledTimes(1);
});
