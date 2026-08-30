import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSpaAssets,
  collectIndexJsRefs,
  findRequiredChunks,
  isJavaScriptBytes,
} from "./assertSpaAssets.js";

describe("assertSpaAssets", () => {
  it("requires EchoKeys and UserProfile hashed chunks", () => {
    const { missing, found } = findRequiredChunks([
      "index-aaaa.js",
      "EchoKeys-07j-In6E.js",
      "UserProfile-DeLmCUJW.js",
    ]);
    expect(missing).toEqual([]);
    expect(found["EchoKeys-"]).toBe("EchoKeys-07j-In6E.js");
    expect(found["UserProfile-"]).toBe("UserProfile-DeLmCUJW.js");
  });

  it("rejects HTML bytes pretending to be a JS chunk", () => {
    expect(isJavaScriptBytes(Buffer.from("export default 1"))).toBe(true);
    expect(
      isJavaScriptBytes(Buffer.from("<!doctype html><title>Anima Protocol</title>")),
    ).toBe(false);
  });

  it("collects /assets/*.js refs from index.html", () => {
    const refs = collectIndexJsRefs(
      `<script type="module" src="/assets/index-Dqhepbdd.js"></script>
       <link rel="modulepreload" href="/assets/rolldown-runtime-B0Z9INg1.js">`,
    );
    expect(refs).toEqual(
      expect.arrayContaining([
        "index-Dqhepbdd.js",
        "rolldown-runtime-B0Z9INg1.js",
      ]),
    );
  });

  it("passes a consistent dist and fails when EchoKeys is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "spa-assets-"));
    const assets = join(dir, "assets");
    mkdirSync(assets);
    writeFileSync(
      join(dir, "index.html"),
      `<script type="module" src="/assets/index-aaaa.js"></script>`,
    );
    writeFileSync(join(assets, "index-aaaa.js"), "console.log(1)");
    writeFileSync(join(assets, "UserProfile-bbbb.js"), "export default 1");

    expect(() => assertSpaAssets(dir)).toThrow(/EchoKeys-/);

    writeFileSync(join(assets, "EchoKeys-cccc.js"), "export default 2");
    expect(assertSpaAssets(dir).found["EchoKeys-"]).toBe("EchoKeys-cccc.js");
  });

  it("fails when index.html references a JS file that is not in assets/", () => {
    const dir = mkdtempSync(join(tmpdir(), "spa-stale-"));
    const assets = join(dir, "assets");
    mkdirSync(assets);
    writeFileSync(
      join(dir, "index.html"),
      `<script type="module" src="/assets/index-OLDHASH.js"></script>`,
    );
    writeFileSync(join(assets, "index-NEWHASH.js"), "console.log(1)");
    writeFileSync(join(assets, "EchoKeys-cccc.js"), "export default 2");
    writeFileSync(join(assets, "UserProfile-bbbb.js"), "export default 1");

    expect(() => assertSpaAssets(dir)).toThrow(/index-OLDHASH\.js/);
  });
});
