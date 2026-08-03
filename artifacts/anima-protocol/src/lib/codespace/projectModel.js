// Codespace project + session model.
//
// A project is { name, companion_id, files[], active_path, agent_log[] } and is
// persisted through the base44/store entity layer (entity "CodespaceProject"),
// so projects survive refresh and sync across devices like other Anima data.
//
// Sessions: snapshots of the whole workspace (files + the companion's build
// transcript) are saved as JSON files inside a ".sessions/" folder in the file
// tree itself. Reloading one restores the files and transcript so the user (and
// companion) can continue exactly where they left off — satisfying "save
// sessions to a folder in the file tree where they can be reloaded."

export const SESSIONS_DIR = ".sessions/";

export function isSessionPath(path = "") {
  return String(path).startsWith(SESSIONS_DIR);
}

// A small starter web project so a new Codespace is never empty.
export function defaultFiles() {
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="styles.css" />
    <title>My Codespace</title>
  </head>
  <body>
    <main>
      <h1>Hello from the Codespace</h1>
      <p>Ask your companion to build something, or edit these files yourself.</p>
      <button id="ping">Ping the console</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`,
    },
    {
      path: "styles.css",
      content: `:root { color-scheme: dark; }
body {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #090912;
  color: #22d3ee;
  display: grid;
  place-items: center;
  min-height: 100vh;
}
main { text-align: center; padding: 2rem; }
h1 { letter-spacing: 0.1em; }
button {
  background: transparent;
  border: 1px solid #22d3ee;
  color: #22d3ee;
  font: inherit;
  padding: 0.6rem 1.2rem;
  cursor: pointer;
}
button:hover { background: rgba(34, 211, 238, 0.12); }
`,
    },
    {
      path: "script.js",
      content: `document.getElementById("ping")?.addEventListener("click", () => {
  console.log("Pong! The sandbox is alive.");
});
`,
    },
  ];
}

export function newProject(name = "untitled-project", companionId = null) {
  return {
    name,
    companion_id: companionId,
    files: defaultFiles(),
    active_path: "index.html",
    agent_log: [],
  };
}

// Files visible in the explorer, excluding the sessions folder (which is shown
// as its own collapsible section by the explorer).
export function workspaceFiles(files = []) {
  return files.filter((f) => !isSessionPath(f.path));
}

export function sessionFiles(files = []) {
  return files.filter((f) => isSessionPath(f.path));
}

function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Build a session snapshot file (path + JSON content) capturing the current
// workspace files (sessions excluded) and the companion's build transcript.
export function makeSessionSnapshot(files = [], agentLog = [], label = "") {
  const snapshot = {
    kind: "anima-codespace-session",
    version: 1,
    saved_at: new Date().toISOString(),
    label: label || "",
    files: workspaceFiles(files),
    agent_log: agentLog,
  };
  const name = label
    ? `${timestampName()}-${label.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 24)}`
    : timestampName();
  return {
    path: `${SESSIONS_DIR}${name}.session.json`,
    content: JSON.stringify(snapshot, null, 2),
  };
}

// Parse a session file's content back into { files, agentLog }. Returns null if
// the file isn't a valid session snapshot.
export function parseSessionSnapshot(content = "") {
  try {
    const obj = JSON.parse(content);
    if (!obj || obj.kind !== "anima-codespace-session" || !Array.isArray(obj.files)) {
      return null;
    }
    return {
      files: obj.files,
      agentLog: Array.isArray(obj.agent_log) ? obj.agent_log : [],
      savedAt: obj.saved_at || null,
      label: obj.label || "",
    };
  } catch {
    return null;
  }
}

export function languageForPath(path = "") {
  const p = String(path).toLowerCase();
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  return "javascript";
}
