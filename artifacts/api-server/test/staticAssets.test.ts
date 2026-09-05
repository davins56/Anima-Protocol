import { describe, expect, it } from "vitest";
import {
  fetchStaticModuleAsset,
  isHtmlContentType,
  isStaticModuleAssetPath,
  missingStaticAssetResponse,
  shouldRejectHtmlAssetFallback,
} from "../src/lib/staticAssets";

describe("static asset SPA-fallback guard", () => {
  it("treats hashed Vite modules under /assets as static files", () => {
    expect(isStaticModuleAssetPath("/assets/EchoKeys-DsgAf3_0.js")).toBe(true);
    expect(isStaticModuleAssetPath("/assets/index-Dqhepbdd.js")).toBe(true);
    expect(isStaticModuleAssetPath("/assets/index-C4wlRyYX.css")).toBe(true);
    expect(isStaticModuleAssetPath("/assets/vendor.wasm")).toBe(true);
  });

  it("does not treat HTML routes or traversal as static modules", () => {
    expect(isStaticModuleAssetPath("/profile")).toBe(false);
    expect(isStaticModuleAssetPath("/echo-keys")).toBe(false);
    expect(isStaticModuleAssetPath("/assets/../index.html")).toBe(false);
    expect(isStaticModuleAssetPath("/assets/EchoKeys-DsgAf3_0.js/")).toBe(false);
    expect(isStaticModuleAssetPath("/assets/EchoKeys-DsgAf3_0.js/?v=1")).toBe(
      false,
    );
    expect(isStaticModuleAssetPath("/assets/")).toBe(false);
    expect(isStaticModuleAssetPath("/api/store")).toBe(false);
  });

  it("rejects HTML content types for those modules", () => {
    expect(isHtmlContentType("text/html")).toBe(true);
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("text/javascript")).toBe(false);
    expect(isHtmlContentType("application/javascript")).toBe(false);
    expect(
      shouldRejectHtmlAssetFallback(
        "/assets/EchoKeys-DsgAf3_0.js",
        "text/html",
      ),
    ).toBe(true);
    expect(
      shouldRejectHtmlAssetFallback(
        "/assets/EchoKeys-07j-In6E.js",
        "text/javascript",
      ),
    ).toBe(false);
    expect(shouldRejectHtmlAssetFallback("/profile", "text/html")).toBe(false);
  });

  it("returns 404 text/plain with no-store for a missing hashed module", () => {
    const response = missingStaticAssetResponse("/assets/missing-xxxx.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    expect(response.headers.get("content-type")).not.toMatch(/html/);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("replaces an ASSETS HTML fallback with a non-HTML 404", async () => {
    const html = new Response("<!doctype html><title>Anima Protocol</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const response = await fetchStaticModuleAsset(
      new Request("https://anima-protocol.com/assets/EchoKeys-DsgAf3_0.js"),
      { fetch: async () => html },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    expect(response.headers.get("content-type")).not.toMatch(/html/);
    await expect(response.text()).resolves.toMatch(/Not [Ff]ound/);
  });

  it("passes through a real JavaScript module from ASSETS", async () => {
    const js = new Response("export default 1", {
      status: 200,
      headers: { "content-type": "text/javascript" },
    });
    const response = await fetchStaticModuleAsset(
      new Request("https://anima-protocol.com/assets/EchoKeys-07j-In6E.js"),
      { fetch: async () => js },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript");
    await expect(response.text()).resolves.toBe("export default 1");
  });
});
