/** Simple logger — no Sentry, just console */

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : true;

function noop(..._args: unknown[]) {}

function makeLogger(consoleFn: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    if (args.length >= 2 && typeof args[0] === "string" && typeof args[1] === "string") {
      consoleFn(`[${args[0]}]`, ...args.slice(1));
    } else {
      consoleFn(...args);
    }
  };
}

export const log = {
  debug: IS_DEV ? makeLogger(console.log) : noop,
  info: IS_DEV ? makeLogger(console.log) : noop,
  warn: makeLogger(console.warn),
  error: makeLogger(console.error),
};

export default log;
