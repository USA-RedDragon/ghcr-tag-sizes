import type { ExtApi } from "./types.ts";

declare global {
  // eslint-disable-next-line no-var
  var browser: ExtApi | undefined; // Firefox
  // eslint-disable-next-line no-var
  var chrome: ExtApi | undefined; // Chrome
}

export {};
