/**
 * Silence the console and record what each call would print, so an address
 * inside an object, an error or a deeply nested value shows up too.
 */
const { format, inspect } = require("util");

// What each console method prints, for every method that prints a caller's values
const RENDER = {
  log: format,
  info: format,
  warn: format,
  error: format,
  debug: format,
  group: format,
  groupCollapsed: format,
  dir: (value, options) => inspect(value, { ...options, colors: false }),
  assert: (condition, ...args) => (condition ? null : format(...args)),
};

function captureConsole() {
  const lines = [];
  const spies = Object.entries(RENDER).map(([method, render]) =>
    jest.spyOn(console, method).mockImplementation((...args) => {
      const line = render(...args);
      if (line !== null) lines.push(line);
    }));
  return {
    output: () => lines.join("\n"),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

module.exports = { captureConsole };
