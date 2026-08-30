import { act } from "react";

/** Drain FileReader + Image microtasks used by persistPortraitWithInlineFallback. */
export async function flushPortraitUpload() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}
