const crypto = require("crypto");
const config = require("../config");

/**
 * Generate a 6-character alphanumeric code (for game codes and club invite codes).
 * Uses uppercase letters + digits, excluding ambiguous chars (0/O, 1/I/L).
 */
function generateCode(length = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Calculate points for a guess (Section 4.3 / Appendix B).
 *
 * | Guess type           | Producer note | Critic/AI note |
 * |----------------------|---------------|----------------|
 * | Generic correct      | +2            | +1             |
 * | Specific correct     | +3            | +2             |
 * | Wrong                | −1            | −1             |
 * | Auto-skip            | 0             | 0              |
 */
function calculatePoints({ isCorrect, isSpecific, sourceTier }) {
  if (!isCorrect) return -1;

  const isProducer = sourceTier === "PRODUCER";

  if (isSpecific) {
    return isProducer ? 3 : 2;
  }
  return isProducer ? 2 : 1;
}

/**
 * Calculate the tasting note count range shown to players (Section 2.5).
 * Shows ±2 from actual, with a floor of 3.
 */
function getNoteCountRange(actualCount) {
  const range = config.scan.noteCountRange;
  const floor = config.scan.noteCountFloor;
  const low = Math.max(floor, actualCount - range);
  const high = actualCount + range;
  return { low, high };
}

/**
 * Check if a free-tier user has scans remaining this month (Section 8.1).
 * Also handles monthly reset logic.
 */
function checkScanLimit(user) {
  const now = new Date();
  const resetDate = new Date(user.scanResetDate);

  if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    return { allowed: true, remaining: config.freeTier.monthlyScans, needsReset: true };
  }

  const remaining = config.freeTier.monthlyScans - user.monthlyScansUsed;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining), needsReset: false };
}

/**
 * Determine confidence level label from a score (Section 2.2).
 */
function getConfidenceLevel(confidence) {
  if (confidence >= config.scan.highConfidence) return "HIGH";
  if (confidence >= config.scan.mediumConfidence) return "MEDIUM";
  if (confidence > 0) return "LOW";
  return "NONE";
}

/**
 * Phase 2: Generate a share token for game results.
 */
function generateShareToken() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Phase 2: Calculate game statistics for results screen (Section 4.10).
 */
function calculateGameStats(players, guestPlayers = []) {
  const allPlayers = [
    ...players.map(p => ({
      displayName: p.user?.displayName || p.displayName,
      totalScore: p.totalScore,
      guessCount: p.guesses?.length || 0,
      correctCount: p.guesses?.filter(g => g.isCorrect).length || 0,
      specificCount: p.guesses?.filter(g => g.isSpecific).length || 0,
    })),
    ...guestPlayers.map(g => ({
      displayName: g.displayName,
      totalScore: g.totalScore,
      guessCount: g.guesses?.length || 0,
      correctCount: g.guesses?.filter(gg => gg.isCorrect).length || 0,
      specificCount: g.guesses?.filter(gg => gg.isSpecific).length || 0,
    })),
  ];

  const totalGuesses = allPlayers.reduce((s, p) => s + p.guessCount, 0);
  const totalCorrect = allPlayers.reduce((s, p) => s + p.correctCount, 0);

  return {
    totalPlayers: allPlayers.length,
    totalGuesses,
    totalCorrect,
    overallAccuracy: totalGuesses > 0 ? (totalCorrect / totalGuesses * 100).toFixed(1) : 0,
    highestScore: Math.max(...allPlayers.map(p => p.totalScore)),
    lowestScore: Math.min(...allPlayers.map(p => p.totalScore)),
    mvp: allPlayers.sort((a, b) => b.totalScore - a.totalScore)[0]?.displayName || null,
    mostPrecise: allPlayers.sort((a, b) => b.specificCount - a.specificCount)[0]?.displayName || null,
  };
}

/**
 * App error constructor for consistent error throwing.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = {
  generateCode,
  calculatePoints,
  getNoteCountRange,
  checkScanLimit,
  getConfidenceLevel,
  generateShareToken,
  calculateGameStats,
  AppError,
};
