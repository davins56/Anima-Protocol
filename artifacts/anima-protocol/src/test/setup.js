if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (callback) =>
    globalThis.setTimeout(() => callback(Date.now()), 16);
}

if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = (handle) => {
    globalThis.clearTimeout(handle);
  };
}
