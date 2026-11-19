/**
 * Tasting-note sourcing, as called by players when they confirm a scanned bottle.
 * The notes are the game's answers, so players only ever get counts back, and the
 * paid AI note-writing runs at most once per bottle.
 */
const mockDb = {
  bottle: { findUnique: jest.fn() },
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
