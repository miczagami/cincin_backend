/**
 * Silence every console level and record each call as the console would print it
 * (util.format), so an address inside an object or error argument shows up too.
 */
const { format } = require("util");

const LEVELS = ["log", "info", "warn", "error"];

function captureConsole() {
  const lines = [];
  const spies = LEVELS.map((level) =>
    jest.spyOn(console, level).mockImplementation((...args) => lines.push(format(...args))));
  return {
    output: () => lines.join("\n"),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

module.exports = { captureConsole };
