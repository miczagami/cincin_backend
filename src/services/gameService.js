const crypto = require("crypto");
const prisma = require("../config/database");
const config = require("../config");
const {
  generateCode, calculatePoints, getNoteCountRange, AppError,
} = require("../utils/helpers");

// ═══════════════════════════════════════════
//  GAME CREATION (Section 3.5, 3.6)
// ═══════════════════════════════════════════

/**
 * Create a new game. The host scans a bottle, configures settings, and creates the game.
 * Phase 2: Supports guest players for pass-the-phone mode.
 */
async function createGame(hostId, {
  bottleId,
  multiplayerType = "PASS_THE_PHONE",
  mode = "PARALLEL",
  roundTimerSecs = 60,
  maxRounds = 20,
  optOutTiming = "START_OF_ROUND",
  scoreboardVisible = true,
  cellarClubId = null,
  guestPlayerNames = [], // Phase 2: names for non-account players in pass-the-phone
}) {
  const bottle = await prisma.bottle.findUnique({
    where: { id: bottleId },
    include: { tastingNotes: { select: { id: true } } },
  });
  if (!bottle) throw new AppError("Bottle not found", 404);

  // Enforce free-tier defaults (Appendix A — Free vs Pro)
  const user = await prisma.user.findUnique({
    where: { id: hostId },
    select: { subscriptionTier: true },
  });

  if (user.subscriptionTier === "FREE") {
    mode = "PARALLEL";
    roundTimerSecs = config.freeTier.roundTimerSecs;
    maxRounds = config.freeTier.maxRounds;
    optOutTiming = "START_OF_ROUND";
    scoreboardVisible = true;
  }

  // Generate unique game code
  let gameCode;
  let exists = true;
  while (exists) {
    gameCode = generateCode(config.game.gameCodeLength);
    exists = await prisma.game.findUnique({ where: { gameCode } });
  }

  // Generate share token for results sharing
  const shareToken = crypto.randomBytes(16).toString("hex");
  const lobbyExpiresAt = new Date(Date.now() + config.game.lobbyTimeoutMinutes * 60 * 1000);

  const game = await prisma.game.create({
    data: {
      hostId,
      bottleId,
      gameCode,
      multiplayerType,
      mode,
      roundTimerSecs,
      maxRounds,
      optOutTiming,
      scoreboardVisible,
      cellarClubId,
      clubApprovalStatus: cellarClubId ? "PENDING" : null,
      shareToken,
      lobbyExpiresAt,
      players: {
        create: {
          userId: hostId,
          playerOrder: 0,
        },
      },
      // Phase 2: Create guest players for pass-the-phone
      ...(multiplayerType === "PASS_THE_PHONE" && guestPlayerNames.length > 0
        ? {
            guestPlayers: {
              create: guestPlayerNames.map((name, i) => ({
                displayName: name,
                playerOrder: i + 1, // host is 0
              })),
            },
          }
        : {}),
    },
    include: {
      players: {
        include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      },
      guestPlayers: true,
      bottle: {
        select: {
          id: true, name: true, vintage: true, region: true,
          producer: true, category: true, subcategory: true, imageUrl: true,
        },
      },
    },
  });

  const noteCount = bottle.tastingNotes.length;
  const noteRange = getNoteCountRange(noteCount);

  return {
    ...game,
    noteRange,
    lobbyExpiresAt,
    totalPlayers: game.players.length + game.guestPlayers.length,
  };
}

// ═══════════════════════════════════════════
//  JOIN GAME (Section 3.1.2, 3.1.3)
// ═══════════════════════════════════════════

async function joinGame(userId, gameCode) {
  const game = await prisma.game.findUnique({
    where: { gameCode: gameCode.toUpperCase() },
    include: {
      players: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      guestPlayers: true,
    },
  });

  if (!game) throw new AppError("Game not found. Check the code and try again.", 404);
  if (game.status !== "LOBBY") throw new AppError("This game has already started.", 400);
  if (game.lobbyExpiresAt && game.lobbyExpiresAt < new Date()) {
    throw new AppError("This game lobby has expired.", 400);
  }

  const existing = game.players.find(p => p.userId === userId);
  if (existing) return game;

  const playerOrder = game.players.length + game.guestPlayers.length;

  await prisma.gamePlayer.create({
    data: { gameId: game.id, userId, playerOrder },
  });

  return prisma.game.findUnique({
    where: { id: game.id },
    include: {
      players: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      guestPlayers: true,
      bottle: {
        select: { id: true, name: true, vintage: true, region: true, producer: true, category: true },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  ADD / REMOVE GUEST PLAYERS (Phase 2)
// ═══════════════════════════════════════════

/**
 * Add a guest player to a pass-the-phone game.
 */
async function addGuestPlayer(gameId, hostId, displayName) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: true, guestPlayers: true },
  });

  if (!game) throw new AppError("Game not found", 404);
  if (game.hostId !== hostId) throw new AppError("Only the host can add players", 403);
  if (game.multiplayerType !== "PASS_THE_PHONE") {
    throw new AppError("Guest players are only for pass-the-phone mode", 400);
  }
  if (game.status !== "LOBBY") throw new AppError("Cannot add players after game has started", 400);

  const nextOrder = game.players.length + game.guestPlayers.length;

  const guest = await prisma.guestPlayer.create({
    data: {
      gameId,
      displayName,
      playerOrder: nextOrder,
    },
  });

  return guest;
}

/**
 * Remove a guest player from the lobby.
 */
async function removeGuestPlayer(gameId, hostId, guestPlayerId) {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new AppError("Game not found", 404);
  if (game.hostId !== hostId) throw new AppError("Only the host can remove players", 403);
  if (game.status !== "LOBBY") throw new AppError("Cannot remove players after game has started", 400);

  await prisma.guestPlayer.delete({ where: { id: guestPlayerId } });
  return { message: "Guest player removed" };
}

// ═══════════════════════════════════════════
//  START GAME (Section 3.5)
// ═══════════════════════════════════════════

async function startGame(gameId, hostId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: true, guestPlayers: true },
  });

  if (!game) throw new AppError("Game not found", 404);
  if (game.hostId !== hostId) throw new AppError("Only the host can start the game", 403);
  if (game.status !== "LOBBY") throw new AppError("Game already started", 400);

  const totalPlayers = game.players.length + game.guestPlayers.length;
  if (totalPlayers < 2) throw new AppError("Need at least 2 players to start", 400);

  // Determine first player for pass-the-phone
  const firstPlayerOrder = 0; // host goes first
  const firstPlayer = game.players.find(p => p.playerOrder === 0);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.round.create({
      data: { gameId: game.id, roundNumber: 1 },
    });

    return tx.game.update({
      where: { id: game.id },
      data: {
        status: "IN_PROGRESS",
        currentRound: 1,
        startedAt: new Date(),
        // Phase 2: track whose turn it is in pass-the-phone
        currentTurnPlayerId: firstPlayer?.id || null,
        currentTurnOrder: firstPlayerOrder,
      },
      include: {
        players: {
          include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
          orderBy: { playerOrder: "asc" },
        },
        guestPlayers: { orderBy: { playerOrder: "asc" } },
        rounds: { where: { roundNumber: 1 } },
        bottle: {
          select: {
            id: true, name: true, vintage: true, region: true,
            producer: true, category: true, subcategory: true, imageUrl: true,
          },
        },
      },
    });
  });

  return updated;
}

// ═══════════════════════════════════════════
//  GAME STATE — GET CURRENT (Phase 2)
// ═══════════════════════════════════════════

/**
 * Get current game state for the active player.
 * Returns different data based on multiplayer type and game phase.
 * Reveal-proof: never exposes tasting notes.
 */
async function getGameState(gameId, userId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      bottle: {
        select: {
          id: true, name: true, vintage: true, region: true,
          producer: true, category: true, subcategory: true, imageUrl: true,
          tastingNotes: { select: { id: true } }, // count only, not content
        },
      },
      players: {
        include: {
          user: { select: { id: true, displayName: true, avatarUrl: true } },
          guesses: {
            select: { id: true, roundId: true, isCorrect: true, pointsAwarded: true, guessText: true, isSpecific: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { playerOrder: "asc" },
      },
      guestPlayers: {
        include: {
          guesses: {
            select: { id: true, roundId: true, isCorrect: true, pointsAwarded: true, guessText: true, isSpecific: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { playerOrder: "asc" },
      },
      rounds: { orderBy: { roundNumber: "asc" } },
    },
  });

  if (!game) throw new AppError("Game not found", 404);

  const isPlayer = game.players.some(p => p.userId === userId);
  if (!isPlayer) throw new AppError("You are not in this game", 403);

  const noteCount = game.bottle.tastingNotes.length;
  const noteRange = getNoteCountRange(noteCount);

  // Collect all claimed note IDs across all players (for competitive mode)
  const allGuesses = [
    ...game.players.flatMap(p => p.guesses),
    ...game.guestPlayers.flatMap(g => g.guesses),
  ];
  const claimedNoteIds = allGuesses.filter(g => g.isCorrect).map(g => g.roundId); // will fix below

  // Build the interstitial data (Section 3.1.1): notes claimed but not by whom
  const claimedNotesThisGame = await prisma.guess.findMany({
    where: { round: { gameId }, isCorrect: true },
    select: { guessText: true },
    distinct: ["guessText"],
  });

  const guestClaimedNotes = await prisma.guestGuess.findMany({
    where: { round: { gameId }, isCorrect: true },
    select: { guessText: true },
    distinct: ["guessText"],
  });

  const claimedNotes = [
    ...new Set([
      ...claimedNotesThisGame.map(g => g.guessText),
      ...guestClaimedNotes.map(g => g.guessText),
    ]),
  ];

  // Build player list with scores
  const allPlayersList = [
    ...game.players.map(p => ({
      id: p.id,
      type: "registered",
      userId: p.userId,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      playerOrder: p.playerOrder,
      totalScore: p.totalScore,
      status: p.status,
      guessCount: p.guesses.length,
    })),
    ...game.guestPlayers.map(g => ({
      id: g.id,
      type: "guest",
      userId: null,
      displayName: g.displayName,
      avatarUrl: null,
      playerOrder: g.playerOrder,
      totalScore: g.totalScore,
      status: g.status,
      guessCount: g.guesses.length,
    })),
  ].sort((a, b) => a.playerOrder - b.playerOrder);

  // Determine current turn info for pass-the-phone
  let currentTurn = null;
  if (game.multiplayerType === "PASS_THE_PHONE") {
    const currentPlayer = allPlayersList.find(p => p.playerOrder === game.currentTurnOrder);
    currentTurn = {
      playerOrder: game.currentTurnOrder,
      playerId: currentPlayer?.id,
      displayName: currentPlayer?.displayName,
      type: currentPlayer?.type,
    };
  }

  return {
    game: {
      id: game.id,
      gameCode: game.gameCode,
      status: game.status,
      mode: game.mode,
      multiplayerType: game.multiplayerType,
      currentRound: game.currentRound,
      maxRounds: game.maxRounds,
      roundTimerSecs: game.roundTimerSecs,
      optOutTiming: game.optOutTiming,
      scoreboardVisible: game.scoreboardVisible,
      hostId: game.hostId,
    },
    bottle: {
      id: game.bottle.id,
      name: game.bottle.name,
      vintage: game.bottle.vintage,
      region: game.bottle.region,
      producer: game.bottle.producer,
      category: game.bottle.category,
      subcategory: game.bottle.subcategory,
      imageUrl: game.bottle.imageUrl,
    },
    noteRange,
    currentTurn,
    claimedNotes, // what's been guessed (no attribution) — Section 3.1.1
    players: allPlayersList,
    scoreboard: game.scoreboardVisible
      ? allPlayersList.sort((a, b) => b.totalScore - a.totalScore).map((p, i) => ({
          rank: i + 1,
          displayName: p.displayName,
          totalScore: p.totalScore,
          status: p.status,
        }))
      : null,
    roundCount: game.rounds.length,
  };
}

// ═══════════════════════════════════════════
//  SUBMIT GUESS (Section 4.2, 4.3)
// ═══════════════════════════════════════════

/**
 * Submit a guess for the current round.
 * Handles both registered and guest players.
 * Phase 2: Enhanced with AI guess evaluation for free-text.
 */
async function submitGuess(gameId, userId, guessText, { isGuest = false, guestPlayerId = null } = {}) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      bottle: { include: { tastingNotes: true } },
      rounds: { orderBy: { roundNumber: "desc" }, take: 1 },
      players: true,
      guestPlayers: true,
    },
  });

  if (!game) throw new AppError("Game not found", 404);
  if (game.status !== "IN_PROGRESS") throw new AppError("Game is not in progress", 400);

  const currentRound = game.rounds[0];
  if (!currentRound) throw new AppError("No active round", 400);
  if (currentRound.endedAt) throw new AppError("Round has ended", 400);

  // Resolve the player (registered or guest)
  let player;
  if (isGuest && guestPlayerId) {
    player = game.guestPlayers.find(g => g.id === guestPlayerId);
    if (!player) throw new AppError("Guest player not found", 404);
  } else {
    player = game.players.find(p => p.userId === userId);
    if (!player) throw new AppError("You are not in this game", 403);
  }

  if (player.status === "OPTED_OUT") throw new AppError("You have opted out", 400);

  // Check if player already guessed this round
  const existingGuess = isGuest
    ? await prisma.guestGuess.findFirst({
        where: { roundId: currentRound.id, guestPlayerId: player.id },
      })
    : await prisma.guess.findFirst({
        where: { roundId: currentRound.id, gamePlayerId: player.id },
      });

  if (existingGuess) throw new AppError("Already guessed this round", 400);

  // Validate pass-the-phone turn order
  if (game.multiplayerType === "PASS_THE_PHONE") {
    if (player.playerOrder !== game.currentTurnOrder) {
      throw new AppError("It's not your turn", 400);
    }
  }

  // --- GUESS EVALUATION ---
  const { matchedNote, matchType, isSpecific, aiEvaluation } = await evaluateGuess(
    guessText,
    game.bottle.tastingNotes,
    game
  );

  const isCorrect = !!matchedNote;
  const points = isCorrect
    ? calculatePoints({ isCorrect, isSpecific, sourceTier: matchedNote.sourceTier })
    : -1;

  // Create guess and update score
  if (isGuest) {
    const [guess] = await prisma.$transaction([
      prisma.guestGuess.create({
        data: {
          roundId: currentRound.id,
          guestPlayerId: player.id,
          tastingNoteId: matchedNote?.id || null,
          guessText,
          isCorrect,
          isSpecific,
          pointsAwarded: points,
          matchedVia: matchType,
        },
      }),
      prisma.guestPlayer.update({
        where: { id: player.id },
        data: { totalScore: { increment: points } },
      }),
    ]);

    return {
      guessId: guess.id,
      guessText,
      isCorrect,
      isSpecific,
      pointsAwarded: points,
      matchedNote: matchedNote ? { note: matchedNote.note, sourceTier: matchedNote.sourceTier } : null,
    };
  }

  const [guess] = await prisma.$transaction([
    prisma.guess.create({
      data: {
        roundId: currentRound.id,
        gamePlayerId: player.id,
        tastingNoteId: matchedNote?.id || null,
        guessText,
        isCorrect,
        isSpecific,
        pointsAwarded: points,
        matchedVia: matchType,
        aiEvaluation: aiEvaluation || undefined,
      },
    }),
    prisma.gamePlayer.update({
      where: { id: player.id },
      data: { totalScore: { increment: points } },
    }),
  ]);

  return {
    guessId: guess.id,
    guessText,
    isCorrect,
    isSpecific,
    pointsAwarded: points,
    matchedNote: matchedNote ? { note: matchedNote.note, sourceTier: matchedNote.sourceTier } : null,
  };
}

// ═══════════════════════════════════════════
//  GUESS EVALUATION ENGINE (Section 4.2)
// ═══════════════════════════════════════════

/**
 * Evaluate a guess against the tasting notes for the bottle.
 * Three-pass evaluation:
 *   1. Exact match (case-insensitive)
 *   2. Generic category match (via taxonomy)
 *   3. AI evaluation for synonyms, alternate spellings, regional terms
 */
async function evaluateGuess(guessText, tastingNotes, game) {
  const normalised = guessText.trim().toLowerCase();

  // In competitive mode, filter out already-claimed notes
  let availableNotes = tastingNotes;
  if (game.mode === "COMPETITIVE") {
    const claimedIds = new Set();

    const claimed = await prisma.guess.findMany({
      where: { round: { gameId: game.id }, isCorrect: true },
      select: { tastingNoteId: true },
    });
    const guestClaimed = await prisma.guestGuess.findMany({
      where: { round: { gameId: game.id }, isCorrect: true },
      select: { tastingNoteId: true },
    });

    claimed.forEach(g => g.tastingNoteId && claimedIds.add(g.tastingNoteId));
    guestClaimed.forEach(g => g.tastingNoteId && claimedIds.add(g.tastingNoteId));

    availableNotes = tastingNotes.filter(n => !claimedIds.has(n.id));
  }

  if (availableNotes.length === 0) {
    return { matchedNote: null, matchType: "EXACT", isSpecific: false, aiEvaluation: null };
  }

  // Pass 1: Exact match on specific note
  const exactMatch = availableNotes.find(
    n => n.note.toLowerCase() === normalised
  );
  if (exactMatch) {
    return {
      matchedNote: exactMatch,
      matchType: "EXACT",
      isSpecific: true,
      aiEvaluation: null,
    };
  }

  // Pass 2: Generic category match
  // If the guess matches the genericNote field of any tasting note
  const genericMatch = availableNotes.find(
    n => n.genericNote && n.genericNote.toLowerCase() === normalised
  );
  if (genericMatch) {
    return {
      matchedNote: genericMatch,
      matchType: "GENERIC_MATCH",
      isSpecific: false,
      aiEvaluation: null,
    };
  }

  // Pass 2b: Check flavour taxonomy for parent-child relationships
  const taxonomyMatch = await matchViaTaxonomy(normalised, availableNotes);
  if (taxonomyMatch) {
    return taxonomyMatch;
  }

  // Pass 3: AI evaluation for synonyms, alt spellings, regional terms (Section 4.2)
  const aiResult = await evaluateGuessWithAI(normalised, availableNotes);
  if (aiResult && aiResult.matchedNote) {
    return {
      matchedNote: aiResult.matchedNote,
      matchType: "AI_EVALUATED",
      isSpecific: aiResult.isSpecific,
      aiEvaluation: aiResult.reasoning,
    };
  }

  // No match
  return { matchedNote: null, matchType: "EXACT", isSpecific: false, aiEvaluation: null };
}

/**
 * Check the flavour taxonomy for parent-child relationships.
 * E.g. guess "cherry" matches note "Rainier cherry" at generic level.
 */
async function matchViaTaxonomy(normalised, availableNotes) {
  // Look up the guess in the taxonomy
  const guessNode = await prisma.flavourNode.findFirst({
    where: { name: { equals: normalised, mode: "insensitive" } },
    include: { children: true, parent: true },
  });

  if (!guessNode) return null;

  // If the guess is a generic category, check if any note matches a child
  if (guessNode.isGeneric && guessNode.children.length > 0) {
    const childNames = new Set(guessNode.children.map(c => c.name.toLowerCase()));
    // Also add the generic name itself
    childNames.add(guessNode.name.toLowerCase());

    for (const note of availableNotes) {
      const noteName = note.note.toLowerCase();
      const genericName = (note.genericNote || "").toLowerCase();

      if (childNames.has(noteName) || genericName === guessNode.name.toLowerCase()) {
        return {
          matchedNote: note,
          matchType: "GENERIC_MATCH",
          isSpecific: false,
          aiEvaluation: null,
        };
      }
    }
  }

  // If the guess is specific, check if it matches a note directly or via parent
  if (!guessNode.isGeneric && guessNode.parent) {
    const match = availableNotes.find(
      n => n.note.toLowerCase() === guessNode.name.toLowerCase()
    );
    if (match) {
      return {
        matchedNote: match,
        matchType: "EXACT",
        isSpecific: true,
        aiEvaluation: null,
      };
    }
  }

  return null;
}

/**
 * AI evaluation for free-text guesses that don't match taxonomy.
 * Uses LLM to determine synonyms, alternate spellings, regional terms.
 */
async function evaluateGuessWithAI(guessText, availableNotes) {
  // Only attempt AI evaluation if we have an API key
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const noteList = availableNotes.map(n => ({
    note: n.note,
    genericNote: n.genericNote,
    id: n.id,
    sourceTier: n.sourceTier,
  }));

  try {
    const provider = process.env.AI_LLM_PROVIDER || "anthropic";

    if (provider === "anthropic") {
      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: `You are a flavour evaluation engine for a tasting game. Your job is to determine if a player's guess matches any of the available tasting notes. Consider synonyms, alternate spellings, regional terminology, and close flavour descriptors. Respond ONLY with valid JSON.`,
        messages: [
          {
            role: "user",
            content: `Player guessed: "${guessText}"

Available tasting notes:
${JSON.stringify(noteList, null, 2)}

Does the guess match any note? Consider:
- Synonyms (e.g. "tobacco" = "cigar box")
- Regional terms (e.g. "capsicum" = "green pepper" = "bell pepper")
- Alternate spellings (e.g. "liquorice" = "licorice")
- Close flavour descriptors within the same family

Respond with JSON only:
{
  "matched": true/false,
  "matchedNoteId": "id or null",
  "isSpecific": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`,
          },
        ],
      });

      const text = response.content[0].text.trim();
      const parsed = JSON.parse(text.replace(/```json\s*|```/g, "").trim());

      if (parsed.matched && parsed.matchedNoteId && parsed.confidence >= 0.7) {
        const matchedNote = availableNotes.find(n => n.id === parsed.matchedNoteId);
        if (matchedNote) {
          return {
            matchedNote,
            isSpecific: parsed.isSpecific,
            reasoning: { provider: "anthropic", ...parsed },
          };
        }
      }
    }

    if (provider === "openai") {
      const OpenAI = require("openai");
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You evaluate tasting guesses against a list of notes. Consider synonyms, alternate spellings, and regional terminology. Respond with JSON: {"matched": bool, "matchedNoteId": "id/null", "isSpecific": bool, "confidence": 0-1, "reasoning": "brief"}`,
          },
          {
            role: "user",
            content: `Guess: "${guessText}"\nNotes: ${JSON.stringify(noteList)}`,
          },
        ],
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      if (parsed.matched && parsed.matchedNoteId && parsed.confidence >= 0.7) {
        const matchedNote = availableNotes.find(n => n.id === parsed.matchedNoteId);
        if (matchedNote) {
          return {
            matchedNote,
            isSpecific: parsed.isSpecific,
            reasoning: { provider: "openai", ...parsed },
          };
        }
      }
    }
  } catch (err) {
    console.error("[AI Guess Evaluation] Error:", err.message);
  }

  return null;
}

// ═══════════════════════════════════════════
//  OPT OUT (Section 4.5)
// ═══════════════════════════════════════════

async function optOut(gameId, userId, { isGuest = false, guestPlayerId = null } = {}) {
  let player;

  if (isGuest && guestPlayerId) {
    player = await prisma.guestPlayer.findFirst({
      where: { id: guestPlayerId, gameId },
    });
    if (!player) throw new AppError("Guest player not found", 404);
    if (player.status === "OPTED_OUT") throw new AppError("Already opted out", 400);

    await prisma.guestPlayer.update({
      where: { id: player.id },
      data: { status: "OPTED_OUT", optedOutAt: new Date() },
    });
  } else {
    player = await prisma.gamePlayer.findFirst({ where: { gameId, userId } });
    if (!player) throw new AppError("You are not in this game", 403);
    if (player.status === "OPTED_OUT") throw new AppError("Already opted out", 400);

    await prisma.gamePlayer.update({
      where: { id: player.id },
      data: { status: "OPTED_OUT", optedOutAt: new Date() },
    });
  }

  // Check if ALL players have opted out → end game (Section 4.8)
  const activeRegistered = await prisma.gamePlayer.count({
    where: { gameId, status: "ACTIVE" },
  });
  const activeGuests = await prisma.guestPlayer.count({
    where: { gameId, status: "ACTIVE" },
  });

  if (activeRegistered + activeGuests === 0) {
    await endGame(gameId, "ALL_OPTED_OUT");
  }

  return { message: "Score locked", finalScore: player.totalScore };
}

// ═══════════════════════════════════════════
//  ADVANCE ROUND / TURN (Phase 2)
// ═══════════════════════════════════════════

/**
 * Advance the game — either to next turn (pass-the-phone) or next round.
 * Pass-the-phone: each player in order takes one turn per round.
 * When all players have had a turn, the round ends and a new round starts.
 */
async function advanceRound(gameId, hostId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      bottle: { include: { tastingNotes: true } },
      players: {
        include: { user: { select: { displayName: true } } },
        orderBy: { playerOrder: "asc" },
      },
      guestPlayers: { orderBy: { playerOrder: "asc" } },
    },
  });

  if (!game) throw new AppError("Game not found", 404);
  if (game.hostId !== hostId) throw new AppError("Only host can advance", 403);
  if (game.status !== "IN_PROGRESS") throw new AppError("Game is not in progress", 400);

  // Build combined ordered player list
  const allPlayers = [
    ...game.players.map(p => ({ ...p, type: "registered" })),
    ...game.guestPlayers.map(g => ({ ...g, type: "guest" })),
  ].sort((a, b) => a.playerOrder - b.playerOrder);

  // Filter to active players only
  const activePlayers = allPlayers.filter(p => p.status === "ACTIVE");
  if (activePlayers.length === 0) {
    return endGame(gameId, "ALL_OPTED_OUT");
  }

  if (game.multiplayerType === "PASS_THE_PHONE") {
    // Find next active player after current turn
    const currentOrder = game.currentTurnOrder ?? -1;
    let nextPlayer = activePlayers.find(p => p.playerOrder > currentOrder);

    if (nextPlayer) {
      // Still more players in this round
      await prisma.game.update({
        where: { id: gameId },
        data: {
          currentTurnOrder: nextPlayer.playerOrder,
          currentTurnPlayerId: nextPlayer.id,
        },
      });

      return {
        action: "NEXT_TURN",
        currentTurnOrder: nextPlayer.playerOrder,
        displayName: nextPlayer.displayName || nextPlayer.user?.displayName,
        type: nextPlayer.type,
        round: game.currentRound,
      };
    }

    // All players have had a turn this round — advance to next round
    return advanceToNextRound(game, activePlayers);
  }

  // Multi-device / remote: all players submit simultaneously, then advance round
  return advanceToNextRound(game, activePlayers);
}

/**
 * Internal: advance to next round, checking end conditions.
 */
async function advanceToNextRound(game, activePlayers) {
  const nextRound = game.currentRound + 1;

  // Check max rounds (Section 4.8)
  if (nextRound > game.maxRounds) {
    return endGame(game.id, "MAX_ROUNDS_REACHED");
  }

  // Check all notes claimed in competitive mode (Section 4.8)
  if (game.mode === "COMPETITIVE") {
    const totalNotes = game.bottle.tastingNotes.length;
    const claimedRegular = await prisma.guess.count({
      where: { isCorrect: true, round: { gameId: game.id } },
    });
    const claimedGuest = await prisma.guestGuess.count({
      where: { isCorrect: true, round: { gameId: game.id } },
    });
    if (claimedRegular + claimedGuest >= totalNotes) {
      return endGame(game.id, "ALL_NOTES_CLAIMED");
    }
  }

  // Reset to first active player for pass-the-phone
  const firstActive = activePlayers[0];

  await prisma.$transaction([
    prisma.round.update({
      where: { gameId_roundNumber: { gameId: game.id, roundNumber: game.currentRound } },
      data: { endedAt: new Date() },
    }),
    prisma.round.create({
      data: { gameId: game.id, roundNumber: nextRound },
    }),
    prisma.game.update({
      where: { id: game.id },
      data: {
        currentRound: nextRound,
        currentTurnOrder: firstActive?.playerOrder ?? 0,
        currentTurnPlayerId: firstActive?.id ?? null,
      },
    }),
  ]);

  return {
    action: "NEXT_ROUND",
    round: nextRound,
    currentTurnOrder: firstActive?.playerOrder ?? 0,
    displayName: firstActive?.displayName || firstActive?.user?.displayName,
  };
}

// ═══════════════════════════════════════════
//  AUTO-SKIP (Section 4.4)
// ═══════════════════════════════════════════

/**
 * Auto-skip a player's turn when the round timer expires.
 * Awards 0 points (Section 4.4).
 */
async function autoSkipTurn(gameId, hostId, { isGuest = false, guestPlayerId = null, playerId = null } = {}) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { rounds: { orderBy: { roundNumber: "desc" }, take: 1 } },
  });

  if (!game) throw new AppError("Game not found", 404);
  if (game.hostId !== hostId) throw new AppError("Only host can auto-skip", 403);

  const currentRound = game.rounds[0];
  if (!currentRound) throw new AppError("No active round", 400);

  // Record a 0-point skip guess
  if (isGuest && guestPlayerId) {
    await prisma.guestGuess.create({
      data: {
        roundId: currentRound.id,
        guestPlayerId,
        guessText: "[auto-skip]",
        isCorrect: false,
        pointsAwarded: 0,
        matchedVia: "EXACT",
      },
    });
  } else if (playerId) {
    await prisma.guess.create({
      data: {
        roundId: currentRound.id,
        gamePlayerId: playerId,
        guessText: "[auto-skip]",
        isCorrect: false,
        pointsAwarded: 0,
        matchedVia: "EXACT",
      },
    });
  }

  return { message: "Turn auto-skipped", pointsAwarded: 0 };
}

// ═══════════════════════════════════════════
//  END GAME & RESULTS (Section 4.8, 4.10)
// ═══════════════════════════════════════════

async function endGame(gameId, reason) {
  const game = await prisma.game.update({
    where: { id: gameId },
    data: {
      status: "COMPLETED",
      endedAt: new Date(),
      endReason: reason,
    },
    include: {
      bottle: {
        include: { tastingNotes: true, affiliateLinks: true },
      },
      players: {
        include: {
          user: { select: { id: true, displayName: true, avatarUrl: true } },
          guesses: {
            include: { tastingNote: { select: { note: true, sourceTier: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { totalScore: "desc" },
      },
      guestPlayers: {
        include: {
          guesses: {
            include: { tastingNote: { select: { note: true, sourceTier: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { totalScore: "desc" },
      },
    },
  });

  // Phase 2: Update palate profile stats for registered players
  await updatePalateStats(game);

  return game;
}

async function hostEndGame(gameId, hostId) {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new AppError("Game not found", 404);
  if (game.hostId !== hostId) throw new AppError("Only the host can end the game", 403);
  if (game.status !== "IN_PROGRESS") throw new AppError("Game is not in progress", 400);

  return endGame(gameId, "HOST_ENDED");
}

/**
 * Get full game results (Section 4.10).
 * Includes tasting note reveal, per-player breakdown, and comparison overlay.
 */
async function getResults(gameId, userId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      bottle: {
        include: { tastingNotes: true, affiliateLinks: true },
      },
      players: {
        include: {
          user: { select: { id: true, displayName: true, avatarUrl: true } },
          guesses: {
            include: {
              tastingNote: { select: { id: true, note: true, sourceTier: true } },
              round: { select: { roundNumber: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { totalScore: "desc" },
      },
      guestPlayers: {
        include: {
          guesses: {
            include: {
              tastingNote: { select: { id: true, note: true, sourceTier: true } },
              round: { select: { roundNumber: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { totalScore: "desc" },
      },
    },
  });

  if (!game) throw new AppError("Game not found", 404);

  // Allow access for players, guests (via host), and via share token
  const isPlayer = game.players.some(p => p.userId === userId);
  const isHost = game.hostId === userId;
  if (!isPlayer && !isHost) throw new AppError("You are not in this game", 403);

  // Build note reveal
  const allGuesses = [
    ...game.players.flatMap(p => p.guesses),
    ...game.guestPlayers.flatMap(g => g.guesses),
  ];
  const claimedNoteIds = new Set(
    allGuesses.filter(g => g.isCorrect && g.tastingNote).map(g => g.tastingNote.id)
  );

  const noteReveal = game.bottle.tastingNotes.map(note => ({
    id: note.id,
    note: note.note,
    genericNote: note.genericNote,
    sourceTier: note.sourceTier,
    guessed: claimedNoteIds.has(note.id),
  }));

  // Build unified leaderboard (registered + guests)
  const allPlayerResults = [
    ...game.players.map(p => ({
      type: "registered",
      userId: p.userId,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      totalScore: p.totalScore,
      status: p.status,
      guessCount: p.guesses.length,
      correctCount: p.guesses.filter(g => g.isCorrect).length,
      guesses: p.guesses.map(g => ({
        roundNumber: g.round.roundNumber,
        guessText: g.guessText,
        isCorrect: g.isCorrect,
        isSpecific: g.isSpecific,
        pointsAwarded: g.pointsAwarded,
        matchedNote: g.tastingNote?.note || null,
      })),
    })),
    ...game.guestPlayers.map(g => ({
      type: "guest",
      userId: null,
      displayName: g.displayName,
      avatarUrl: null,
      totalScore: g.totalScore,
      status: g.status,
      guessCount: g.guesses.length,
      correctCount: g.guesses.filter(gg => gg.isCorrect).length,
      guesses: g.guesses.map(gg => ({
        roundNumber: gg.round.roundNumber,
        guessText: gg.guessText,
        isCorrect: gg.isCorrect,
        isSpecific: gg.isSpecific,
        pointsAwarded: gg.pointsAwarded,
        matchedNote: gg.tastingNote?.note || null,
      })),
    })),
  ].sort((a, b) => b.totalScore - a.totalScore);

  return {
    game: {
      id: game.id,
      status: game.status,
      endReason: game.endReason,
      mode: game.mode,
      multiplayerType: game.multiplayerType,
      currentRound: game.currentRound,
      shareToken: game.shareToken,
    },
    bottle: {
      id: game.bottle.id,
      name: game.bottle.name,
      vintage: game.bottle.vintage,
      region: game.bottle.region,
      producer: game.bottle.producer,
      category: game.bottle.category,
      subcategory: game.bottle.subcategory,
      imageUrl: game.bottle.imageUrl,
    },
    leaderboard: allPlayerResults.map((p, i) => ({
      rank: i + 1,
      ...p,
    })),
    noteReveal,
    affiliateLinks: game.bottle.affiliateLinks,
  };
}

/**
 * Get results by share token (public access, no auth required).
 */
async function getResultsByShareToken(shareToken) {
  const game = await prisma.game.findUnique({
    where: { shareToken },
  });

  if (!game) throw new AppError("Shared results not found", 404);
  if (game.status !== "COMPLETED") throw new AppError("Game is not yet completed", 400);

  // Use a simplified version of getResults that doesn't require auth
  // Fetch same data but return it without userId for privacy
  return getResults(game.id, game.hostId);
}

// ═══════════════════════════════════════════
//  GAME HISTORY (Phase 2)
// ═══════════════════════════════════════════

/**
 * Get game history for a user (Section 4.10, Appendix C — Pro only).
 */
async function getGameHistory(userId, { limit = 20, offset = 0 } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  });

  if (user.subscriptionTier === "FREE") {
    throw new AppError("Game history is a Pro feature. Upgrade to access your past games.", 403);
  }

  const games = await prisma.gamePlayer.findMany({
    where: { userId },
    include: {
      game: {
        include: {
          bottle: {
            select: { id: true, name: true, vintage: true, category: true, imageUrl: true },
          },
          players: {
            select: { totalScore: true, userId: true },
            orderBy: { totalScore: "desc" },
          },
          guestPlayers: {
            select: { totalScore: true, displayName: true },
            orderBy: { totalScore: "desc" },
          },
        },
      },
    },
    orderBy: { game: { createdAt: "desc" } },
    take: limit,
    skip: offset,
  });

  return games.map(gp => {
    const allScores = [
      ...gp.game.players.map(p => ({ userId: p.userId, score: p.totalScore })),
      ...gp.game.guestPlayers.map(g => ({ userId: null, score: g.totalScore })),
    ].sort((a, b) => b.score - a.score);

    const userRank = allScores.findIndex(s => s.userId === userId) + 1;

    return {
      gameId: gp.game.id,
      bottle: gp.game.bottle,
      yourScore: gp.totalScore,
      yourRank: userRank,
      totalPlayers: allScores.length,
      topScore: allScores[0]?.score || 0,
      status: gp.game.status,
      mode: gp.game.mode,
      playedAt: gp.game.startedAt || gp.game.createdAt,
    };
  });
}

// ═══════════════════════════════════════════
//  PALATE PROFILE UPDATE (Phase 2)
// ═══════════════════════════════════════════

/**
 * After a game ends, update each registered player's palate profile stats.
 * Categorises each guess by its generic flavour category and updates accuracy.
 */
async function updatePalateStats(game) {
  for (const player of game.players) {
    for (const guess of player.guesses) {
      if (guess.guessText === "[auto-skip]") continue;

      // Determine the flavour category for this guess
      let category = null;
      if (guess.tastingNote) {
        category = guess.tastingNote.note;
        // Try to get the generic category
        const note = game.bottle.tastingNotes.find(n => n.note === guess.tastingNote.note);
        if (note?.genericNote) category = note.genericNote;
      } else {
        // Wrong guess — try to categorise the guess text via taxonomy
        const node = await prisma.flavourNode.findFirst({
          where: { name: { equals: guess.guessText, mode: "insensitive" } },
          include: { parent: true },
        });
        if (node) {
          category = node.isGeneric ? node.name : (node.parent?.name || node.name);
        } else {
          category = guess.guessText.toLowerCase();
        }
      }

      if (!category) continue;

      await prisma.palateCategory.upsert({
        where: {
          // drinkType "" = all-drink-types row (matches palateProfileService)
          userId_category_drinkType: { userId: player.userId, category: category.toLowerCase(), drinkType: "" },
        },
        update: {
          totalGuesses: { increment: 1 },
          correctGuesses: { increment: guess.isCorrect ? 1 : 0 },
          accuracy: {
            // Will be recalculated below
            set: 0,
          },
          lastUpdated: new Date(),
        },
        create: {
          userId: player.userId,
          category: category.toLowerCase(),
          drinkType: "",
          totalGuesses: 1,
          correctGuesses: guess.isCorrect ? 1 : 0,
          accuracy: guess.isCorrect ? 1.0 : 0.0,
          lastUpdated: new Date(),
        },
      });

      // Recalculate accuracy
      const stat = await prisma.palateCategory.findUnique({
        where: { userId_category_drinkType: { userId: player.userId, category: category.toLowerCase(), drinkType: "" } },
      });
      if (stat && stat.totalGuesses > 0) {
        await prisma.palateCategory.update({
          where: { id: stat.id },
          data: { accuracy: stat.correctGuesses / stat.totalGuesses },
        });
      }
    }
  }
}

// ═══════════════════════════════════════════
//  OFFLINE SYNC (Phase 2)
// ═══════════════════════════════════════════

/**
 * Queue an offline game for processing (Section 9.2).
 * The client sends the full offline game state, and the server replays it.
 */
async function queueOfflineGame(userId, gamePayload) {
  const queued = await prisma.offlineSyncQueue.create({
    data: {
      userId,
      gamePayload,
      status: "PENDING",
    },
  });

  // Process immediately (could be deferred to a job queue in production)
  try {
    await processOfflineGame(queued.id);
  } catch (err) {
    console.error("[Offline Sync] Error processing:", err.message);
  }

  return { queueId: queued.id, status: "QUEUED" };
}

/**
 * Process an offline game by replaying its events.
 */
async function processOfflineGame(queueId) {
  const queued = await prisma.offlineSyncQueue.update({
    where: { id: queueId },
    data: { status: "PROCESSING" },
  });

  try {
    const payload = queued.gamePayload;

    // Create the game server-side
    const game = await createGame(queued.userId, {
      bottleId: payload.bottleId,
      multiplayerType: "PASS_THE_PHONE",
      mode: payload.mode || "PARALLEL",
      roundTimerSecs: payload.roundTimerSecs || 60,
      maxRounds: payload.maxRounds || 20,
      guestPlayerNames: payload.guestPlayerNames || [],
    });

    // Mark as offline-created
    await prisma.game.update({
      where: { id: game.id },
      data: { createdOffline: true, syncedAt: new Date() },
    });

    // Start the game
    await startGame(game.id, queued.userId);

    // Replay all rounds and guesses
    for (const round of payload.rounds || []) {
      for (const guess of round.guesses || []) {
        await submitGuess(game.id, queued.userId, guess.guessText, {
          isGuest: guess.isGuest,
          guestPlayerId: guess.guestPlayerId || null,
        });

        // Advance turn between each guess in pass-the-phone
        if (game.multiplayerType === "PASS_THE_PHONE") {
          await advanceRound(game.id, queued.userId);
        }
      }
    }

    // End the game
    await endGame(game.id, payload.endReason || "HOST_ENDED");

    await prisma.offlineSyncQueue.update({
      where: { id: queueId },
      data: { status: "COMPLETED", processedAt: new Date() },
    });

    return { gameId: game.id, status: "SYNCED" };
  } catch (err) {
    await prisma.offlineSyncQueue.update({
      where: { id: queueId },
      data: { status: "FAILED", error: err.message },
    });
    throw err;
  }
}

// ═══════════════════════════════════════════
//  BOTTLE CACHE DATA (Phase 2 — Offline)
// ═══════════════════════════════════════════

/**
 * Get bottle data optimised for offline caching.
 * Includes tasting notes (encrypted/sealed) for offline play.
 */
async function getBottleCacheData(bottleId, userId) {
  const bottle = await prisma.bottle.findUnique({
    where: { id: bottleId },
    include: {
      tastingNotes: true,
      affiliateLinks: true,
    },
  });

  if (!bottle) throw new AppError("Bottle not found", 404);

  const noteCount = bottle.tastingNotes.length;
  const noteRange = getNoteCountRange(noteCount);

  return {
    bottle: {
      id: bottle.id,
      name: bottle.name,
      vintage: bottle.vintage,
      region: bottle.region,
      producer: bottle.producer,
      category: bottle.category,
      subcategory: bottle.subcategory,
      imageUrl: bottle.imageUrl,
    },
    noteRange,
    // Notes are included for offline play but should be stored encrypted client-side
    // The client IndexedDB cache encrypts these before storage
    tastingNotes: bottle.tastingNotes.map(n => ({
      id: n.id,
      note: n.note,
      genericNote: n.genericNote,
      sourceTier: n.sourceTier,
    })),
    affiliateLinks: bottle.affiliateLinks,
    cachedAt: new Date().toISOString(),
  };
}

module.exports = {
  createGame,
  joinGame,
  addGuestPlayer,
  removeGuestPlayer,
  startGame,
  getGameState,
  submitGuess,
  optOut,
  advanceRound,
  autoSkipTurn,
  hostEndGame,
  endGame,
  getResults,
  getResultsByShareToken,
  getGameHistory,
  queueOfflineGame,
  getBottleCacheData,
};
