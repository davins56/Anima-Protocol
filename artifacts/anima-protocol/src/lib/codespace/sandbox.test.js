import { describe, it, expect } from "vitest";
import { hardenGlobalScope } from "./sandbox.js";

function makeFakeScope() {
  return {
    fetch: () => "real fetch",
    XMLHttpRequest: function () {},
    WebSocket: function () {},
    EventSource: function () {},
    importScripts: () => "real importScripts",
    Request: function () {},
    navigator: { sendBeacon: () => true },
  };
}

describe("hardenGlobalScope removes network primitives", () => {
  it("makes fetch throw instead of reaching the network", () => {
    const scope = makeFakeScope();
    hardenGlobalScope(scope);
    expect(() => scope.fetch("/api/store")).toThrow(/disabled/i);
  });

  it("blocks XHR, WebSocket, EventSource, importScripts, Request", () => {
    const scope = makeFakeScope();
    hardenGlobalScope(scope);
    for (const name of [
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "importScripts",
      "Request",
    ]) {
      const fn = scope[name];
      expect(() => fn()).toThrow(/disabled/i);
    }
  });

  it("blocks navigator.sendBeacon", () => {
    const scope = makeFakeScope();
    hardenGlobalScope(scope);
    expect(() => scope.navigator.sendBeacon("/api", "data")).toThrow(/disabled/i);
  });

  it("cannot be re-assigned to restore network access", () => {
    const scope = makeFakeScope();
    hardenGlobalScope(scope);
    // Attempting to overwrite the locked getter must not restore a callable.
    try {
      scope.fetch = () => "restored";
    } catch {
      /* strict-mode assignment to a getter-only prop may throw; that's fine */
    }
    expect(() => scope.fetch("/api/store")).toThrow(/disabled/i);
  });

  it("survives a scope whose navigator is read-only", () => {
    const scope = makeFakeScope();
    Object.defineProperty(scope, "navigator", {
      value: Object.freeze({ sendBeacon: () => true }),
      configurable: false,
    });
    expect(() => hardenGlobalScope(scope)).not.toThrow();
  });
});
