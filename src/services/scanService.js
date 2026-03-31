const prisma = require("../config/database");
const config = require("../config");
const { checkScanLimit, getConfidenceLevel, getNoteCountRange, AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  AI PIPELINE v1 — Label Recognition & Tasting Note Sourcing
//  Timeline ref: Phase 1, Weeks 1–4
//  Spec ref: Sections 2.1–2.6
// ═══════════════════════════════════════════════════════════════

/**
 * Process a camera label scan (Section 2.1.1).
 * Sends image to cloud vision API, identifies bottle, returns
 * confidence scoring and matched bottle data.
 */
async function scanLabel(userId, { imageBase64, mimeType = "image/jpeg" }) {
  // 1. Enforce scan limits for free-tier users (Section 8.1)
  await enforceScanLimit(userId);

  // 2. Send to vision AI for label recognition (Section 2.2)
  const visionResult = await callVisionAPI(imageBase64, mimeType);

  // 3. Match against bottle database
  const matchResult = await matchBottle(visionResult);

  // 4. Record the scan
  const scan = await prisma.bottleScan.create({
    data: {
      userId,
      bottleId: matchResult.bottle?.id || null,
      confidence: matchResult.confidence,
      inputMethod: "CAMERA",
      rawImageUrl: null, // TODO: upload to S3 in production
      aiResponse: visionResult,
    },
  });

  // 5. Increment scan counter for free users
  await incrementScanCount(userId);

  // 6. If matched, fetch tasting notes
  let tastingNotes = [];
  let noteRange = null;
  if (matchResult.bottle) {
    tastingNotes = await getTastingNotes(matchResult.bottle.id);
    noteRange = getNoteCountRange(tastingNotes.length);
  }

  return {
    scanId: scan.id,
    confidence: matchResult.confidence,
    confidenceLevel: getConfidenceLevel(matchResult.confidence),
    bottle: matchResult.bottle,
    alternatives: matchResult.alternatives,
    noteRange, // ±2 range, never exact count (Section 2.5)
    // NEVER include tasting note content — reveal-proof (Section 2.6)
  };
}

/**
 * Process a barcode scan (Section 2.1.2).
 */
async function scanBarcode(userId, { barcode }) {
  await enforceScanLimit(userId);

  const bottle = await prisma.bottle.findUnique({
    where: { barcode },
    select: bottleSelectFields(),
  });

  const confidence = bottle ? 1.0 : 0.0;

  const scan = await prisma.bottleScan.create({
    data: {
      userId,
      bottleId: bottle?.id || null,
      confidence,
      inputMethod: "BARCODE",
      aiResponse: { barcode, matched: !!bottle },
    },
  });

  await incrementScanCount(userId);

  let noteRange = null;
  if (bottle) {
    const noteCount = await prisma.tastingNote.count({ where: { bottleId: bottle.id } });
    noteRange = getNoteCountRange(noteCount);
  }

  return {
    scanId: scan.id,
    confidence,
    confidenceLevel: bottle ? "HIGH" : "NONE",
    bottle,
    alternatives: [],
    noteRange,
  };
}

/**
 * Manual text search with autocomplete (Section 2.1.3).
 * This is the fallback when camera/barcode fails.
 */
async function searchBottles(query, { limit = 10, category = null } = {}) {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const where = {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { producer: { contains: query, mode: "insensitive" } },
      { region: { contains: query, mode: "insensitive" } },
    ],
  };

  if (category) {
    where.category = category;
  }

  const bottles = await prisma.bottle.findMany({
    where,
    select: bottleSelectFields(),
    take: limit,
    orderBy: { name: "asc" },
  });

  return bottles;
}

/**
 * Confirm a bottle selection from scan or search (Section 2.6).
 * Returns the confirmation screen data without exposing tasting notes.
 */
async function confirmBottle(userId, bottleId) {
  const bottle = await prisma.bottle.findUnique({
    where: { id: bottleId },
    select: {
      ...bottleSelectFields(),
      description: true,
    },
  });

  if (!bottle) throw new AppError("Bottle not found", 404);

  const noteCount = await prisma.tastingNote.count({ where: { bottleId } });
  const noteRange = getNoteCountRange(noteCount);

  return {
    bottle,
    noteRange,
    // Tasting notes are SEALED — never sent to client until game ends
  };
}

// ═══════════════════════════════════════════════════════════════
//  TASTING NOTE SOURCING ENGINE
//  Spec ref: Section 2.3
//  Priority: Producer > Critic > AI-Synthesised
// ═══════════════════════════════════════════════════════════════

/**
 * Get tasting notes for a bottle, ordered by source tier priority.
 * Used internally by the game engine — never exposed to players mid-game.
 */
async function getTastingNotes(bottleId) {
  return prisma.tastingNote.findMany({
    where: { bottleId },
    orderBy: [
      // Priority: PRODUCER first, then CRITIC, then AI_SYNTHESISED
      { sourceTier: "asc" },
      { note: "asc" },
    ],
  });
}

/**
 * Source tasting notes for a bottle from all tiers.
 * This is the ingestion pipeline that populates notes from external sources.
 *
 * In production, this would:
 * 1. Check for existing producer notes in our database
 * 2. Query critic APIs/databases (Halliday, Wine Spectator, RateBeer)
 * 3. Use LLM to synthesise notes from aggregated web sources
 * 4. Deduplicate and merge, keeping highest-tier source tag
 *
 * For Phase 1 v1, this handles:
 * - Looking up existing notes in our database
 * - Calling the LLM for AI-synthesised notes if coverage is thin
 * - Deduplication with highest-tier retention
 */
async function sourceTastingNotes(bottleId) {
  const bottle = await prisma.bottle.findUnique({
    where: { id: bottleId },
    include: { tastingNotes: true },
  });

  if (!bottle) throw new AppError("Bottle not found", 404);

  // Check existing coverage
  const existingNotes = bottle.tastingNotes;
  const producerCount = existingNotes.filter(n => n.sourceTier === "PRODUCER").length;
  const criticCount = existingNotes.filter(n => n.sourceTier === "CRITIC").length;
  const aiCount = existingNotes.filter(n => n.sourceTier === "AI_SYNTHESISED").length;

  // If we have fewer than 3 notes total, try to synthesise more
  if (existingNotes.length < 3) {
    const synthesised = await synthesiseNotes(bottle);
    if (synthesised.length > 0) {
      await upsertNotes(bottleId, synthesised, "AI_SYNTHESISED");
    }
  }

  // Return all notes after sourcing
  const allNotes = await prisma.tastingNote.findMany({
    where: { bottleId },
    orderBy: { sourceTier: "asc" },
  });

  return {
    bottleId,
    totalNotes: allNotes.length,
    byTier: {
      producer: allNotes.filter(n => n.sourceTier === "PRODUCER").length,
      critic: allNotes.filter(n => n.sourceTier === "CRITIC").length,
      aiSynthesised: allNotes.filter(n => n.sourceTier === "AI_SYNTHESISED").length,
    },
    notes: allNotes,
  };
}

/**
 * AI-synthesise tasting notes for a bottle using an LLM.
 * Uses the bottle's metadata to generate plausible notes.
 *
 * In production, this calls an LLM (Claude/GPT) with the bottle's
 * category, subcategory, region, and producer to generate typical
 * tasting notes. These are tagged as AI_SYNTHESISED.
 */
async function synthesiseNotes(bottle) {
  try {
    const prompt = buildSynthesisPrompt(bottle);
    const response = await callLLM(prompt);
    return parseSynthesisResponse(response, bottle);
  } catch (err) {
    console.error(`[AI] Failed to synthesise notes for ${bottle.name}:`, err.message);
    return [];
  }
}

/**
 * Build the LLM prompt for tasting note synthesis (Section 2.3).
 */
function buildSynthesisPrompt(bottle) {
  const categoryDesc = {
    WINE: `${bottle.subcategory || "wine"} from ${bottle.region || "unknown region"}`,
    BEER: `${bottle.subcategory || "beer"} style`,
    SPIRITS: `${bottle.subcategory || "spirit"}`,
    OTHER: `${bottle.subcategory || "beverage"}`,
  };

  return {
    system: `You are a professional sommelier and tasting expert. Generate tasting notes for beverages.
Always respond with ONLY a JSON array of objects with "note" (the specific tasting note) and "generic" (the parent category, or null if the note is already a top-level category).
Generate 5-8 notes that are characteristic of this style. Be specific where possible (e.g. "Morello cherry" not just "cherry").
Do not include any other text, markdown, or explanation.`,
    user: `Generate tasting notes for: ${bottle.name}${bottle.vintage ? ` (${bottle.vintage})` : ""}
Producer: ${bottle.producer || "Unknown"}
Category: ${categoryDesc[bottle.category] || bottle.category}
Country: ${bottle.country || "Unknown"}

Return a JSON array of tasting note objects.`,
  };
}

/**
 * Parse the LLM response into structured tasting notes.
 */
function parseSynthesisResponse(response, bottle) {
  try {
    // Strip any markdown code fences
    const clean = response.replace(/```json\s*|```\s*/g, "").trim();
    const notes = JSON.parse(clean);

    if (!Array.isArray(notes)) return [];

    return notes
      .filter(n => n && typeof n.note === "string" && n.note.length > 0)
      .map(n => ({
        note: n.note.trim(),
        genericNote: n.generic?.trim() || null,
      }));
  } catch (err) {
    console.error(`[AI] Failed to parse synthesis response for ${bottle.name}:`, err.message);
    return [];
  }
}

/**
 * Upsert notes into the database with deduplication (Section 2.3).
 * If a note already exists at a higher tier, it is NOT overwritten.
 */
async function upsertNotes(bottleId, notes, sourceTier) {
  const tierPriority = { PRODUCER: 0, CRITIC: 1, AI_SYNTHESISED: 2 };
  let added = 0;

  for (const n of notes) {
    const existing = await prisma.tastingNote.findUnique({
      where: { bottleId_note: { bottleId, note: n.note } },
    });

    if (existing) {
      // Only overwrite if new tier is higher priority
      if (tierPriority[sourceTier] < tierPriority[existing.sourceTier]) {
        await prisma.tastingNote.update({
          where: { id: existing.id },
          data: { sourceTier, genericNote: n.genericNote || existing.genericNote },
        });
        added++;
      }
      // Otherwise keep existing higher-tier tag
    } else {
      await prisma.tastingNote.create({
        data: {
          bottleId,
          note: n.note,
          genericNote: n.genericNote,
          sourceTier,
        },
      });
      added++;
    }
  }

  return added;
}

// ═══════════════════════════════════════════════════════════════
//  FLAVOUR TAXONOMY QUERIES
//  Spec ref: Section 2.4
// ═══════════════════════════════════════════════════════════════

/**
 * Get the full flavour taxonomy tree for a drink type.
 * Used by the guess input UI for category picker + autocomplete.
 */
async function getFlavourTaxonomy(drinkType = null) {
  const where = { parentId: null }; // top-level nodes
  if (drinkType) {
    where.drinkTypes = { has: drinkType };
  }

  const roots = await prisma.flavourNode.findMany({
    where,
    include: {
      children: {
        where: { approved: true },
        include: {
          children: {
            where: { approved: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return roots;
}

/**
 * Search the flavour taxonomy for autocomplete suggestions.
 */
async function searchFlavours(query, { limit = 10, drinkType = null } = {}) {
  if (!query || query.trim().length < 1) return [];

  const where = {
    name: { contains: query, mode: "insensitive" },
    approved: true,
  };

  if (drinkType) {
    where.drinkTypes = { has: drinkType };
  }

  return prisma.flavourNode.findMany({
    where,
    select: {
      id: true,
      name: true,
      isGeneric: true,
      parent: { select: { name: true } },
    },
    take: limit,
    orderBy: { name: "asc" },
  });
}

// ═══════════════════════════════════════════════════════════════
//  VISION AI & LLM INTEGRATION LAYER
//  These are the external API call wrappers.
//  Phase 1 uses configurable providers — swap implementations
//  without touching business logic.
// ═══════════════════════════════════════════════════════════════

/**
 * Call the cloud vision API to analyse a bottle label image.
 * Returns extracted text, product identification, and confidence.
 *
 * Provider options (configured via AI_VISION_PROVIDER env):
 * - google_vision: Google Cloud Vision API
 * - openai: OpenAI GPT-4 Vision
 * - anthropic: Claude Vision
 *
 * All providers are normalised to return the same shape.
 */
async function callVisionAPI(imageBase64, mimeType) {
  const provider = process.env.AI_VISION_PROVIDER || "anthropic";

  switch (provider) {
    case "google_vision":
      return callGoogleVision(imageBase64, mimeType);
    case "openai":
      return callOpenAIVision(imageBase64, mimeType);
    case "anthropic":
    default:
      return callAnthropicVision(imageBase64, mimeType);
  }
}

/**
 * Google Cloud Vision API integration.
 */
async function callGoogleVision(imageBase64, mimeType) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new AppError("Google Vision API key not configured", 503);

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: imageBase64 },
          features: [
            { type: "TEXT_DETECTION", maxResults: 10 },
            { type: "LOGO_DETECTION", maxResults: 5 },
            { type: "WEB_DETECTION", maxResults: 5 },
          ],
        }],
      }),
    }
  );

  if (!response.ok) {
    throw new AppError(`Vision API error: ${response.status}`, 502);
  }

  const data = await response.json();
  const result = data.responses?.[0];

  return {
    provider: "google_vision",
    textAnnotations: result?.textAnnotations || [],
    logoAnnotations: result?.logoAnnotations || [],
    webDetection: result?.webDetection || {},
    rawText: result?.textAnnotations?.[0]?.description || "",
  };
}

/**
 * OpenAI GPT-4 Vision integration.
 */
async function callOpenAIVision(imageBase64, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError("OpenAI API key not configured", 503);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          {
            type: "text",
            text: `Analyse this bottle label image. Return ONLY a JSON object with:
{
  "brand": "producer/brand name",
  "product": "full product name",
  "vintage": year or null,
  "region": "region of origin",
  "country": "country",
  "category": "WINE" or "BEER" or "SPIRITS" or "OTHER",
  "subcategory": "e.g. Shiraz, Pale Ale, Single Malt",
  "confidence": 0.0 to 1.0
}
If you cannot identify the bottle, set confidence to 0.`,
          },
        ],
      }],
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    throw new AppError(`OpenAI API error: ${response.status}`, 502);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  return {
    provider: "openai",
    rawResponse: content,
    ...parseVisionJSON(content),
  };
}

/**
 * Anthropic Claude Vision integration.
 */
async function callAnthropicVision(imageBase64, mimeType) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_SERVICE_API_KEY;
  if (!apiKey) throw new AppError("Anthropic API key not configured", 503);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: imageBase64 },
          },
          {
            type: "text",
            text: `Analyse this bottle label image. Return ONLY a JSON object with:
{
  "brand": "producer/brand name",
  "product": "full product name",
  "vintage": year or null,
  "region": "region of origin",
  "country": "country",
  "category": "WINE" or "BEER" or "SPIRITS" or "OTHER",
  "subcategory": "e.g. Shiraz, Pale Ale, Single Malt",
  "confidence": 0.0 to 1.0
}
If you cannot identify the bottle, set confidence to 0. Do not include markdown.`,
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    throw new AppError(`Anthropic API error: ${response.status}`, 502);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || "";

  return {
    provider: "anthropic",
    rawResponse: content,
    ...parseVisionJSON(content),
  };
}

/**
 * Call an LLM for tasting note synthesis.
 * Uses the same provider routing as vision.
 */
async function callLLM(prompt) {
  const provider = process.env.AI_LLM_PROVIDER || process.env.AI_VISION_PROVIDER || "anthropic";

  switch (provider) {
    case "openai":
      return callOpenAILLM(prompt);
    case "anthropic":
    default:
      return callAnthropicLLM(prompt);
  }
}

async function callAnthropicLLM(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_SERVICE_API_KEY;
  if (!apiKey) throw new AppError("Anthropic API key not configured", 503);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    }),
  });

  if (!response.ok) throw new AppError(`Anthropic LLM error: ${response.status}`, 502);

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function callOpenAILLM(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError("OpenAI API key not configured", 503);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 600,
    }),
  });

  if (!response.ok) throw new AppError(`OpenAI LLM error: ${response.status}`, 502);

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ═══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Parse a JSON response from a vision model, handling markdown fences.
 */
function parseVisionJSON(content) {
  try {
    const clean = content.replace(/```json\s*|```\s*/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      brand: parsed.brand || null,
      product: parsed.product || null,
      vintage: parsed.vintage || null,
      region: parsed.region || null,
      country: parsed.country || null,
      category: parsed.category || null,
      subcategory: parsed.subcategory || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return {
      brand: null, product: null, vintage: null,
      region: null, country: null, category: null,
      subcategory: null, confidence: 0,
    };
  }
}

/**
 * Match vision AI output against our bottle database.
 * Returns the best match and alternatives.
 */
async function matchBottle(visionResult) {
  const { product, brand, vintage, category, confidence: aiConfidence } = visionResult;

  if (!product && !brand) {
    return { bottle: null, confidence: 0, alternatives: [] };
  }

  // Strategy 1: Try exact name match
  const searchTerms = [product, brand].filter(Boolean);
  let bottles = [];

  for (const term of searchTerms) {
    if (!term) continue;
    const found = await prisma.bottle.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { producer: { contains: term, mode: "insensitive" } },
        ],
      },
      select: bottleSelectFields(),
      take: 5,
    });
    bottles.push(...found);
  }

  // Deduplicate
  const seen = new Set();
  bottles = bottles.filter(b => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });

  if (bottles.length === 0) {
    return { bottle: null, confidence: 0, alternatives: [] };
  }

  // Score each match
  const scored = bottles.map(b => {
    let score = 0;

    // Name similarity
    if (product && b.name.toLowerCase().includes(product.toLowerCase())) score += 0.4;
    if (brand && b.producer?.toLowerCase().includes(brand.toLowerCase())) score += 0.2;
    if (vintage && b.vintage === vintage) score += 0.15;
    if (category && b.category === category) score += 0.1;

    // Blend with AI's own confidence
    const blended = (score + (aiConfidence || 0)) / 2;

    return { bottle: b, confidence: Math.min(blended, 1.0) };
  });

  scored.sort((a, b) => b.confidence - a.confidence);

  return {
    bottle: scored[0].bottle,
    confidence: scored[0].confidence,
    alternatives: scored.slice(1, 4).map(s => s.bottle),
  };
}

/**
 * Enforce free-tier scan limit (Section 8.1).
 */
async function enforceScanLimit(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      monthlyScansUsed: true,
      scanResetDate: true,
    },
  });

  if (user.subscriptionTier === "PRO") return; // unlimited

  const { allowed, remaining, needsReset } = checkScanLimit(user);

  if (needsReset) {
    await prisma.user.update({
      where: { id: userId },
      data: { monthlyScansUsed: 0, scanResetDate: new Date() },
    });
    return; // reset happened, they have full allowance
  }

  if (!allowed) {
    throw new AppError(
      `Monthly scan limit reached (${config.freeTier.monthlyScans} scans). Upgrade to Pro for unlimited scans.`,
      429
    );
  }
}

/**
 * Increment the monthly scan counter.
 */
async function incrementScanCount(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: { monthlyScansUsed: { increment: 1 } },
  });
}

/**
 * Standard select fields for bottle queries.
 */
function bottleSelectFields() {
  return {
    id: true,
    name: true,
    producer: true,
    vintage: true,
    region: true,
    country: true,
    category: true,
    subcategory: true,
    barcode: true,
    imageUrl: true,
  };
}

module.exports = {
  scanLabel,
  scanBarcode,
  searchBottles,
  confirmBottle,
  getTastingNotes,
  sourceTastingNotes,
  getFlavourTaxonomy,
  searchFlavours,
};
