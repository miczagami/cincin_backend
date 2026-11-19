/**
 * Anthropic (Claude) client shared by every AI call site.
 *
 * - Model IDs come from config (env vars), never hard-coded at call sites,
 *   so a retired model is a config change, not a code change.
 * - Current models can return `thinking` blocks before the answer, so the
 *   reply is read from the `text` blocks, never from `content[0]`.
 * - Each role has a primary and a fallback model. The fallback runs when the
 *   primary errors, refuses, or returns no text.
 */
const Anthropic = require("@anthropic-ai/sdk");
const config = require("../config");
const { AppError } = require("../utils/helpers");

let client = null;
let clientKey = null;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_SERVICE_API_KEY;
  if (!apiKey) throw new AppError("Anthropic API key not configured", 503);
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

/**
 * How to switch thinking off differs per model, and the wrong form is a 400:
 * Sonnet 5.5 rejects `disabled` and takes `between_tools`; Haiku 5.5 takes
 * `disabled`. Both only at effort `high` or below. Any other model gets no
 * `thinking` field (its default), which every current model accepts.
 */
const THINKING_OFF = {
  "claude-sonnet-5-5": { type: "between_tools" },
  "claude-haiku-5-5": { type: "disabled" },
};

function buildParams(model, { system, content, maxTokens, effort, thinking }) {
  const params = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
    output_config: { effort },
  };
  if (system) params.system = system;
  if (thinking === "off" && THINKING_OFF[model]) params.thinking = THINKING_OFF[model];
  if (config.ai.inferenceGeo) params.inference_geo = config.ai.inferenceGeo;
  return params;
}

function textOf(response) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function isSpendLimit(err) {
  return err instanceof Anthropic.RateLimitError &&
    err.error?.error?.details?.error_code === "enforced_spend_limit_reached";
}

async function callModel(model, request) {
  const response = await getClient().messages.create(
    buildParams(model, request),
    { timeout: request.timeoutMs, maxRetries: request.maxRetries }
  );

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category || "unknown";
    throw new AppError(`Claude declined the request (${category})`, 502);
  }

  const text = textOf(response);
  if (!text) {
    throw new AppError(`Claude returned no text (stop_reason: ${response.stop_reason})`, 502);
  }
  return { text, model: response.model, stopReason: response.stop_reason };
}

/**
 * Send one request for a role ("vision", "guess" or "synthesis").
 * Returns `{ text, model, stopReason, usedFallback }` or throws.
 *
 * `content` is a string or an array of content blocks (image + text).
 * `thinking: "off"` turns thinking off where the model allows it.
 */
async function createMessage(role, { system, content, maxTokens, effort, thinking }) {
  const roleConfig = config.ai.roles[role];
  if (!roleConfig) throw new Error(`Unknown AI role: ${role}`);

  const request = {
    system,
    content,
    maxTokens: maxTokens ?? roleConfig.maxTokens,
    effort: effort ?? roleConfig.effort,
    thinking: thinking ?? roleConfig.thinking,
    timeoutMs: roleConfig.timeoutMs,
    maxRetries: roleConfig.maxRetries,
  };

  try {
    return { ...(await callModel(roleConfig.model, request)), usedFallback: false };
  } catch (err) {
    const fallback = roleConfig.fallbackModel;
    // A spend-limit 429 fails on every model until access resumes, and an
    // auth error is the same key on both - don't spend a second call.
    if (!fallback || fallback === roleConfig.model || isSpendLimit(err) ||
        err instanceof Anthropic.AuthenticationError || err.statusCode === 503) {
      throw err;
    }
    console.warn(`[AI:${role}] ${roleConfig.model} failed (${err.message}); trying ${fallback}`);
    return { ...(await callModel(fallback, request)), usedFallback: true };
  }
}

module.exports = { createMessage, textOf, buildParams };
