import { describe, expect, it, vi } from "vitest";
import {
  fetchAssetsRejectingSpaHtml,
  isHtmlContentType,
  isStaticAssetPath,
  rejectSpaFallbackForStaticAsset,
} from "../src/lib/spaAssetFallback";

const SPA_HTML = `<!doctype html>
<html><head><title>Anima Protocol</title></head>
<body><div id="root"></div>
<script type="module" src="/assets/index-Dqhepbdd.js"></script>
</body></html>`;

function htmlResponse(body = SPA_HTML, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}

function jsResponse(body = "export default 1;\n"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/javascript" },
  });
}

describe("isStaticAssetPath", () => {
  it("treats hashed files under /assets/ as static", () => {
    expect(isStaticAssetPath("/assets/NetBattle-CPeldP0I.js")).toBe(true);
    expect(isStaticAssetPath("/assets/index-Dqhepbdd.js")).toBe(true);
    expect(isStaticAssetPath("/assets/index-Dqhepbdd.css")).toBe(true);
    expect(isStaticAssetPath("/assets/index-Dqhepbdd.js.map")).toBe(true);
    expect(isStaticAssetPath("/assets/inter.woff2")).toBe(true);
  });

  it("treats any static file extension as static", () => {
    expect(isStaticAssetPath("/sw.js")).toBe(true);
    expect(isStaticAssetPath("/manifest.json")).toBe(true);
    expect(isStaticAssetPath("/emblem.png")).toBe(true);
  });

  it("leaves extensionless client routes as SPA candidates", () => {
    expect(isStaticAssetPath("/net-battle")).toBe(false);
    expect(isStaticAssetPath("/meditation")).toBe(false);
    expect(isStaticAssetPath("/")).toBe(false);
    expect(isStaticAssetPath("/chat/abc")).toBe(false);
  });
});

describe("isHtmlContentType", () => {
  it("detects HTML MIME types", () => {
    expect(isHtmlContentType("text/html")).toBe(true);
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("text/javascript")).toBe(false);
    expect(isHtmlContentType("application/javascript")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });
});

describe("rejectSpaFallbackForStaticAsset", () => {
  it("turns an ASSETS SPA-fallback of a missing /assets/*.js into a non-HTML 404", async () => {
    const result = rejectSpaFallbackForStaticAsset(
      "/assets/NetBattle-CPeldP0I.js",
      htmlResponse(),
    );

    expect(result.status).toBe(404);
    expect(result.headers.get("content-type")).toMatch(/text\/plain/);
    expect(result.headers.get("content-type")).not.toMatch(/html/i);
    const body = await result.text();
    expect(body).toMatch(/Not Found/);
    expect(body).not.toMatch(/<!doctype html>/i);
  });

  it("passes through a real JavaScript chunk", async () => {
    const result = rejectSpaFallbackForStaticAsset(
      "/assets/NetBattle-DDZ_dntd.js",
      jsResponse(),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toMatch(/javascript/);
    expect(await result.text()).toBe("export default 1;\n");
  });

  it("keeps SPA HTML for client routes", async () => {
    const result = rejectSpaFallbackForStaticAsset(
      "/net-battle",
      htmlResponse(),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toMatch(/text\/html/);
    expect(await result.text()).toContain("<!doctype html>");
  });
});

describe("fetchAssetsRejectingSpaHtml", () => {
  it("ASSETS would SPA-fallback a missing /assets/*.js → 404 not HTML", async () => {
    const assets = {
      fetch: vi.fn(async () => htmlResponse()),
    };

    const response = await fetchAssetsRejectingSpaHtml(
      new Request("https://anima-protocol.com/assets/NetBattle-CPeldP0I.js"),
      assets,
    );

    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toMatch(/html/i);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(body).toContain("/assets/NetBattle-CPeldP0I.js");
    expect(body).not.toContain("<!doctype html>");
  });

  it("SPA routes still fall back to index.html", async () => {
    const assets = {
      fetch: vi.fn(async () => htmlResponse()),
    };

    const response = await fetchAssetsRejectingSpaHtml(
      new Request("https://anima-protocol.com/net-battle"),
      assets,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain('src="/assets/index-Dqhepbdd.js"');
  });

  it("does not rewrite a present hashed chunk", async () => {
    const assets = {
      fetch: vi.fn(async () => jsResponse("export const current = true;")),
    };

    const response = await fetchAssetsRejectingSpaHtml(
      new Request("https://anima-protocol.com/assets/NetBattle-DDZ_dntd.js"),
      assets,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(await response.text()).toBe("export const current = true;");
  });

  it("404s missing CSS, source maps, and fonts the same way", async () => {
    const assets = { fetch: vi.fn(async () => htmlResponse()) };

    for (const path of [
      "/assets/index-oldhash.css",
      "/assets/index-oldhash.js.map",
      "/assets/display-oldhash.woff2",
    ]) {
      const response = await fetchAssetsRejectingSpaHtml(
        new Request(`https://anima-protocol.com${path}`),
        assets,
      );
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type"), path).not.toMatch(/html/i);
    }
  });

  it("keeps SPA HTML for /meditation", async () => {
    const response = await fetchAssetsRejectingSpaHtml(
      new Request("https://anima-protocol.com/meditation"),
      { fetch: async () => htmlResponse() },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<!doctype html>");
  });
});
