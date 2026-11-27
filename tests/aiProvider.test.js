/**
 * CinCin runs AI on Anthropic only. A stale provider setting (say, openai from
 * an old environment) stops the API at startup, naming the variable, instead
 * of silently changing what the AI does.
 */
jest.mock("dotenv", () => ({ config: jest.fn() })); // a local .env must not leak in

const SETTINGS = ["AI_VISION_PROVIDER", "AI_LLM_PROVIDER"];

/** Load config with the given provider settings (all others unset). */
function loadConfig(env) {
  const saved = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));
  SETTINGS.forEach((name) => delete process.env[name]);
  Object.assign(process.env, env);
  try {
    let config;
    jest.isolateModules(() => { config = require("../src/config"); });
    return config;
  } finally {
    SETTINGS.forEach((name) => (saved[name] === undefined ? delete process.env[name] : (process.env[name] = saved[name])));
  }
}

test("an unsupported vision provider stops startup, naming the variable", () => {
  expect(() => loadConfig({ AI_VISION_PROVIDER: "openai" })).toThrow(/AI_VISION_PROVIDER/);
});

test("an unsupported language-model provider stops startup, naming the variable", () => {
  expect(() => loadConfig({ AI_LLM_PROVIDER: "openai" })).toThrow(/AI_LLM_PROVIDER/);
});

test("anthropic, or no provider setting at all, starts normally", () => {
  expect(() => loadConfig({})).not.toThrow();
  expect(() => loadConfig({ AI_VISION_PROVIDER: "anthropic", AI_LLM_PROVIDER: "anthropic" })).not.toThrow();
});
