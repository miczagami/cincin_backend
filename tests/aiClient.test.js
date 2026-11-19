/**
 * Shared Claude client: model choice per role, the per-model thinking switch,
 * reading the reply from text blocks, and the fallback model.
 * The SDK's messages.create is mocked; nothing calls the API.
 */
const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  const Actual = jest.requireActual("@anthropic-ai/sdk");
  class MockAnthropic extends Actual {
    constructor(opts) {
      super(opts);
      this.messages = { create: mockCreate };
    }
  }
  return MockAnthropic;
});

const Anthropic = require("@anthropic-ai/sdk");
const config = require("../src/config");
const aiClient = require("../src/services/aiClient");

const reply = (model, content, stop_reason = "end_turn", extra = {}) =>
  ({ model, content, stop_reason, stop_details: null, ...extra });

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
  config.ai.inferenceGeo = null;
});

test("vision uses Sonnet 5.5 with between_tools, low effort and no sampling params", async () => {
  mockCreate.mockResolvedValue(reply("claude-sonnet-5-5", [{ type: "text", text: '{"confidence":0.9}' }]));

  const result = await aiClient.createMessage("vision", { content: "label" });

  const [params, options] = mockCreate.mock.calls[0];
  expect(params.model).toBe("claude-sonnet-5-5");
  expect(params.thinking).toEqual({ type: "between_tools" });
  expect(params.output_config).toEqual({ effort: "low" });
  expect(params).not.toHaveProperty("temperature");
  expect(params).not.toHaveProperty("inference_geo");
  expect(options).toEqual({ timeout: 15000, maxRetries: 1 });
  expect(result).toEqual({ text: '{"confidence":0.9}', model: "claude-sonnet-5-5", stopReason: "end_turn", usedFallback: false });
});

test("guess uses Haiku 5.5 with thinking disabled, a 4 s timeout and no retries", async () => {
  mockCreate.mockResolvedValue(reply("claude-haiku-5-5", [{ type: "text", text: "{}" }]));

  await aiClient.createMessage("guess", { system: "s", content: "g" });

  const [params, options] = mockCreate.mock.calls[0];
  expect(params.model).toBe("claude-haiku-5-5");
  expect(params.thinking).toEqual({ type: "disabled" });
  expect(params.system).toBe("s");
  expect(options).toEqual({ timeout: 4000, maxRetries: 0 });
});

test("synthesis leaves thinking on (no thinking field) at medium effort", async () => {
  mockCreate.mockResolvedValue(reply("claude-sonnet-5-5", [{ type: "text", text: "notes" }]));

  await aiClient.createMessage("synthesis", { system: "s", content: "u" });

  const [params] = mockCreate.mock.calls[0];
  expect(params).not.toHaveProperty("thinking");
  expect(params.output_config).toEqual({ effort: "medium" });
});

test("a model without a known off switch gets no thinking field", () => {
  const params = aiClient.buildParams("claude-opus-5-5", { content: "x", maxTokens: 10, effort: "low", thinking: "off" });
  expect(params).not.toHaveProperty("thinking");
});

test("the reply is read from text blocks, skipping a leading thinking block", async () => {
  mockCreate.mockResolvedValue(reply("claude-sonnet-5-5", [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: '{"brand":"Penfolds",' },
    { type: "text", text: '"confidence":0.8}' },
  ]));

  const result = await aiClient.createMessage("vision", { content: "label" });
  expect(result.text).toBe('{"brand":"Penfolds","confidence":0.8}');
});

test("a refusal on the primary model falls back to the fallback model", async () => {
  mockCreate
    .mockResolvedValueOnce(reply("claude-sonnet-5-5", [], "refusal", { stop_details: { type: "refusal", category: "general_harms" } }))
    .mockResolvedValueOnce(reply("claude-haiku-5-5", [{ type: "text", text: "{}" }]));

  const result = await aiClient.createMessage("vision", { content: "label" });

  expect(mockCreate.mock.calls[1][0].model).toBe("claude-haiku-5-5");
  // The fallback request uses Haiku's own off switch, not Sonnet's between_tools
  expect(mockCreate.mock.calls[1][0].thinking).toEqual({ type: "disabled" });
  expect(result).toMatchObject({ model: "claude-haiku-5-5", usedFallback: true });
});

test("hitting max_tokens with no text falls back instead of returning an empty reply", async () => {
  mockCreate
    .mockResolvedValueOnce(reply("claude-sonnet-5-5", [{ type: "thinking", thinking: "", signature: "s" }], "max_tokens"))
    .mockResolvedValueOnce(reply("claude-haiku-5-5", [{ type: "text", text: "ok" }]));

  const result = await aiClient.createMessage("vision", { content: "label" });
  expect(result).toMatchObject({ text: "ok", usedFallback: true });
});

test("an API error on the primary model falls back", async () => {
  mockCreate
    .mockRejectedValueOnce(new Anthropic.InternalServerError(500, { type: "error", error: { type: "api_error", message: "boom" } }, "boom", new Headers()))
    .mockResolvedValueOnce(reply("claude-haiku-5-5", [{ type: "text", text: "ok" }]));

  const result = await aiClient.createMessage("vision", { content: "label" });
  expect(result.usedFallback).toBe(true);
});

test("a spend-limit 429 is not retried on the fallback model", async () => {
  const spendLimit = new Anthropic.RateLimitError(429, {
    type: "error",
    error: { type: "rate_limit_error", message: "limit", details: { error_code: "enforced_spend_limit_reached" } },
  }, "limit", new Headers());
  mockCreate.mockRejectedValueOnce(spendLimit);

  await expect(aiClient.createMessage("vision", { content: "label" })).rejects.toBe(spendLimit);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test("an invalid API key is not retried on the fallback model", async () => {
  const authError = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers());
  mockCreate.mockRejectedValueOnce(authError);

  await expect(aiClient.createMessage("guess", { content: "g" })).rejects.toBe(authError);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test("no API key fails fast with a 503 and no request", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_SERVICE_API_KEY;

  await expect(aiClient.createMessage("vision", { content: "label" })).rejects.toMatchObject({ statusCode: 503 });
  expect(mockCreate).not.toHaveBeenCalled();
});

test("AI_INFERENCE_GEO is sent as inference_geo", async () => {
  config.ai.inferenceGeo = "us";
  mockCreate.mockResolvedValue(reply("claude-haiku-5-5", [{ type: "text", text: "{}" }]));

  await aiClient.createMessage("guess", { content: "g" });
  expect(mockCreate.mock.calls[0][0].inference_geo).toBe("us");
});
