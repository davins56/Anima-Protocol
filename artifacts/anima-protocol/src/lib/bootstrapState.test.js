import { describe, it, expect, beforeEach } from "vitest";
import {
  beginBootstrap,
  endBootstrap,
  ensureBootstrapComplete,
  isBootstrapSettled,
  resetBootstrapState,
} from "@/lib/bootstrapState";

describe("bootstrapState", () => {
  beforeEach(() => {
    resetBootstrapState();
  });

  it("marks settled after endBootstrap", async () => {
    let resolveBootstrap;
    const promise = new Promise((resolve) => {
      resolveBootstrap = resolve;
    });
    beginBootstrap(promise);
    expect(isBootstrapSettled()).toBe(false);

    const waiting = ensureBootstrapComplete(5000);
    resolveBootstrap();
    await waiting;
    endBootstrap();

    expect(isBootstrapSettled()).toBe(true);
    await ensureBootstrapComplete();
  });

  it("resolves waiters when bootstrap completes", async () => {
    let resolveBootstrap;
    const promise = new Promise((resolve) => {
      resolveBootstrap = resolve;
    });
    beginBootstrap(promise);

    const waiter = ensureBootstrapComplete(5000);
    resolveBootstrap();
    await promise;
    endBootstrap();
    await waiter;

    expect(isBootstrapSettled()).toBe(true);
  });
});
