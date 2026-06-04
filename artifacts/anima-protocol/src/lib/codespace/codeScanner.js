// Codespace code-safety scanner.
//
// Scans a file's source for dangerous / malicious patterns BEFORE it runs in
// the in-browser sandbox. This is the engine behind the Battle Network
// "NetNavi vs. virus" experience: each match is a "virus" with a severity, a
// plain-language explanation of the risk, and a themed codename. The Codespace
// run gate uses the highest severity to decide whether to block execution and
// surface the virus-battle moment.
//
// This is a static pattern scan of the workspace's own code, not endpoint
// antivirus — it cannot and does not inspect the user's real device.

const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3 };

// language detection from a file path / explicit language.
function detectLanguage(path = "", language = "") {
  if (language) return language;
  const p = String(path).toLowerCase();
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".css")) return "css";
  return "javascript";
}

// Shared web/JS patterns (also apply inside <script> in HTML).
const JS_RULES = [
  {
    re: /\beval\s*\(/,
    severity: "high",
    codename: "EvalWorm",
    label: "Dynamic eval()",
    explanation:
      "Runs arbitrary text as live code, the classic way malware hides its real payload.",
  },
  {
    re: /new\s+Function\s*\(|\bFunction\s*\(\s*["'`]/,
    severity: "high",
    codename: "FuncForge",
    label: "Function() constructor",
    explanation:
      "Builds executable code from strings at runtime — another way to smuggle in hidden behaviour.",
  },
  {
    re: /\bdocument\s*\.\s*cookie\b/,
    severity: "high",
    codename: "CookieLeech",
    label: "Cookie access",
    explanation: "Reads or writes cookies, often used to steal session tokens.",
  },
  {
    re: /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|navigator\s*\.\s*sendBeacon/,
    severity: "high",
    codename: "DataSiphon",
    label: "Network call",
    explanation:
      "Sends or pulls data over the network — could exfiltrate data to an outside server.",
  },
  {
    re: /window\s*\.\s*(parent|top)\b|(^|[^.\w])(parent|top)\s*\.\s*(postMessage|location|document)/,
    severity: "high",
    codename: "FrameBreaker",
    label: "Sandbox-escape attempt",
    explanation:
      "Tries to reach the page that hosts the sandbox — a classic attempt to break out of isolation.",
  },
  {
    re: /\b(process|require|child_process|__dirname|globalThis\s*\.\s*process)\b/,
    severity: "high",
    codename: "ShellCrawler",
    label: "Server/Node API",
    explanation:
      "References server-side runtime APIs that should never appear in sandboxed browser code.",
  },
  {
    re: /constructor\s*\.\s*constructor|__proto__|Object\s*\.\s*setPrototypeOf/,
    severity: "high",
    codename: "ProtoVirus",
    label: "Prototype tampering",
    explanation:
      "Manipulates JavaScript internals — used to poison shared objects or escape a sandbox.",
  },
  {
    re: /\b(coinhive|cryptonight|CoinImp|webminerpool|miner\.start)\b/i,
    severity: "high",
    codename: "CryptoLeech",
    label: "Crypto-miner",
    explanation: "Signature of browser crypto-mining that hijacks the device's CPU.",
  },
  {
    re: /\b(localStorage|sessionStorage|indexedDB)\b/,
    severity: "medium",
    codename: "VaultPeeker",
    label: "Browser storage",
    explanation:
      "Touches persistent browser storage. Harmless in the sandbox, but worth a look.",
  },
  {
    re: /\bimport\s*\(/,
    severity: "high",
    codename: "ModuleGhost",
    label: "Dynamic import()",
    explanation:
      "Loads code from another location at runtime — can pull in remote scripts that bypass this scan.",
  },
  {
    re: /\b(while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))/,
    severity: "medium",
    codename: "LoopLocker",
    label: "Infinite loop",
    explanation:
      "An unbounded loop can freeze the sandbox (a denial-of-service against itself).",
  },
  {
    re: /navigator\s*\.\s*(geolocation|mediaDevices|clipboard)/,
    severity: "medium",
    codename: "SensorSpy",
    label: "Device sensor / clipboard",
    explanation: "Requests access to location, camera/mic, or clipboard.",
  },
  {
    re: /(window\s*\.\s*location|document\s*\.\s*location)\s*=|location\s*\.\s*(href|replace|assign)\s*[=(]/,
    severity: "medium",
    codename: "Redirector",
    label: "Page redirect",
    explanation: "Forces navigation to another URL.",
  },
  {
    re: /\.innerHTML\s*=|document\s*\.\s*write\s*\(/,
    severity: "low",
    codename: "MarkupMite",
    label: "Raw HTML injection",
    explanation:
      "Writes unescaped HTML, which can introduce cross-site-scripting bugs.",
  },
];

// Python-specific patterns (Pyodide runtime).
const PY_RULES = [
  {
    re: /\bimport\s+(os|subprocess|sys|shutil|socket|ctypes|pty)\b|\bfrom\s+(os|subprocess|socket)\b/,
    severity: "high",
    codename: "SysCrawler",
    label: "System module import",
    explanation:
      "Imports modules that talk to the operating system, files, or network.",
  },
  {
    re: /\b(os\.system|subprocess\.|os\.popen|os\.exec)/,
    severity: "high",
    codename: "ShellCrawler",
    label: "Shell execution",
    explanation: "Tries to run operating-system shell commands.",
  },
  {
    re: /\b(eval|exec|compile)\s*\(|__import__\s*\(/,
    severity: "high",
    codename: "EvalWorm",
    label: "Dynamic eval/exec",
    explanation: "Runs arbitrary text as live Python code.",
  },
  {
    re: /\b(requests\.|urllib|http\.client|httpx\.|aiohttp|pyfetch|socket\.)\b/,
    severity: "high",
    codename: "DataSiphon",
    label: "Network access",
    explanation:
      "Reaches out over the network — could exfiltrate data to an outside server.",
  },
  {
    re: /\bopen\s*\(/,
    severity: "low",
    codename: "FileMite",
    label: "File access",
    explanation:
      "Opens a file. The runtime only sees an in-memory filesystem, so this is advisory.",
  },
  {
    re: /\bwhile\s+True\s*:/,
    severity: "medium",
    codename: "LoopLocker",
    label: "Infinite loop",
    explanation: "An unbounded loop can freeze the runtime.",
  },
];

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

// Scan a single file. Returns { findings, maxSeverity, safe }.
export function scanCode(content = "", path = "", language = "") {
  const source = String(content || "");
  const lang = detectLanguage(path, language);
  const rules = lang === "python" ? PY_RULES : JS_RULES;

  const findings = [];
  for (const rule of rules) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    let m;
    let count = 0;
    while ((m = re.exec(source)) && count < 5) {
      findings.push({
        codename: rule.codename,
        label: rule.label,
        severity: rule.severity,
        explanation: rule.explanation,
        line: lineOf(source, m.index),
        snippet: source.slice(m.index, m.index + 60).split("\n")[0].trim(),
      });
      count += 1;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const maxSeverity = findings.reduce(
    (max, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    "none",
  );

  return {
    path,
    language: lang,
    findings,
    maxSeverity,
    // "high" findings block execution until resolved; lower ones are advisory.
    safe: SEVERITY_RANK[maxSeverity] < SEVERITY_RANK.high,
  };
}

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}
