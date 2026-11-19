const views = {
  all: [
    "Research register",
    "Research, regressions, and open questions in one register.",
  ],
  regression: [
    "Regression scenarios",
    "Track defensive checks and their verification evidence.",
  ],
  questions: ["Open questions", "Resolve security and architecture decisions."],
  user: [
    "Per-user isolation",
    "Authorization and tenant boundaries across memory access.",
  ],
  character: [
    "Per-character isolation",
    "Speaker attribution and ownership within a user account.",
  ],
  visibility: [
    "Shared vs. private",
    "Explicit visibility and authorized promotion between scopes.",
  ],
  lifetime: [
    "Durable vs. temporary",
    "Session expiry, durable promotion, and deletion.",
  ],
  retrieval: [
    "Embeddings and retrieval",
    "Scope enforcement before ranking and prompt assembly.",
  ],
  messages: [
    "Inter-agent messages",
    "Origin, recipients, and visibility across group turns.",
  ],
  tools: [
    "Tool arguments",
    "Destination authorization and minimum data disclosure.",
  ],
  provenance: [
    "Memory CRUD provenance",
    "Audit who created, changed, read, or deleted a record.",
  ],
};
const types = [
  "Peer-reviewed journal",
  "Peer-reviewed conference",
  "Conference paper",
  "Preprint",
  "Regression scenario",
  "Open question",
];
const states = [
  "Proposed",
  "In review",
  "In progress",
  "Implemented",
  "Verified",
  "Blocked",
];
const path = "artifacts/api-server/src/routes/chat.ts";
const published = (
  id,
  title,
  date,
  venue,
  url,
  kind,
  tags,
  model,
  mitigation,
  limitations,
  implications,
  files = "",
) => ({
  id,
  title,
  date,
  venue,
  url,
  kind,
  tags,
  model,
  mitigation,
  limitations,
  implications,
  files,
  status: "Proposed",
});
const seed = [
  published(
    "poisonedrag",
    "PoisonedRAG",
    "2025-08",
    "USENIX Security 2025",
    "https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag",
    types[1],
    ["retrieval", "provenance", "lifetime"],
    "Studies retrieval integrity when untrusted text can enter the indexed corpus.",
    "Gate durable promotion and preserve source and trust labels through indexing.",
    "Benchmarks RAG corpora. Anima’s conversation memory and consent model need their own evaluation.",
    "Test that unreviewed content cannot acquire trusted memory status through retrieval or summarization.",
    path,
  ),
  published(
    "camel",
    "Defeating Prompt Injections by Design",
    "2025-03-24",
    "arXiv v1",
    "https://arxiv.org/abs/2503.18813",
    types[3],
    ["tools", "visibility", "messages"],
    "Examines how untrusted inputs can affect an agent that can access private data and call tools.",
    "Enforce permitted destinations outside the model. Carry visibility and provenance into the tool dispatcher.",
    "Evaluation depends on the benchmark and the capabilities modeled by the policy.",
    "Check that shared tool calls receive only arguments authorized for the destination.",
  ),
  published(
    "memgpt",
    "MemGPT: Towards LLMs as Operating Systems",
    "2023-10-12",
    "arXiv v1",
    "https://arxiv.org/abs/2310.08560",
    types[3],
    ["lifetime", "retrieval"],
    "Architectural reference for tiered memory and context paging.",
    "Keep ownership and visibility metadata when moving between active context and archival storage.",
    "Focuses on memory management. Tenant and character isolation require independent verification.",
    "Exercise promotion, expiry, and deletion across both memory tiers.",
  ),
  {
    id: "sec001",
    title: "SEC-001 · Missing speaker fails closed",
    kind: types[4],
    tags: ["character", "visibility", "retrieval"],
    status: "Implemented",
    files: "promptBuilder.ts (reported filename; confirm current path)",
    tests: "Assert against the final model prompt using synthetic fixtures.",
    expected:
      "A missing speaker ID yields no character-private memories. A resolved speaker receives only memories authorized for that speaker.",
    review:
      "Reported fixed in commit #638. Verify the current branch and runner before marking Verified.",
  },
  {
    id: "sec005",
    title: "SEC-005b · Group-turn persistence",
    kind: types[4],
    tags: ["character", "messages", "visibility", "retrieval"],
    status: "In review",
    files: path,
    tests:
      "Check final persisted mood, synchro, fact, and embedding ownership using synthetic participants.",
    expected:
      "Mood and synchro writes target the resolved speaker only. Missing speaker means no speaker state writes. Any shared fact follows the approved audience and attribution policy.",
    review:
      "Commit #639 reportedly confined mood and synchro to the speaker. Recheck shared fact and embedding behavior before sign-off.",
  },
  {
    id: "tool-policy",
    title: "Private memory stays out of unauthorized tool arguments",
    kind: types[4],
    tags: ["tools", "visibility", "provenance"],
    status: "Proposed",
    tests:
      "Use an in-memory mock tool and synthetic private and shared fields. Assert on the arguments received by the mock.",
    expected:
      "Only approved fields reach the permitted destination. A denied call produces a policy decision in the audit record without recording private content.",
  },
  {
    id: "tenant",
    title: "Tenant scope survives retrieval and prompt assembly",
    kind: types[4],
    tags: ["user", "retrieval", "visibility"],
    status: "Proposed",
    tests:
      "Use distinct synthetic markers for two tenants. Check authorized candidates, final prompt, and resulting audit metadata.",
    expected:
      "The active tenant retains its authorized result. Other-tenant material is absent at every inspected boundary.",
  },
  {
    id: "crud",
    title: "Deletion propagation and provenance retention",
    kind: types[5],
    tags: ["provenance", "lifetime", "retrieval", "user"],
    status: "Proposed",
    implications:
      "Define what audit metadata survives deletion, when derived embeddings and caches are invalidated, and who can read the audit trail.",
    review:
      "Confirm policy for actor, owner, character, visibility, source record, and operation metadata.",
  },
  {
    id: "sharing",
    title: "Which group-turn facts qualify as shared?",
    kind: types[5],
    tags: ["messages", "visibility", "character"],
    status: "In review",
    files: path,
    implications:
      "Decide which audience may retrieve a shared fact, how the speaker is attributed, and whether consent persists after a participant leaves.",
    review:
      "Resolve before assigning verification criteria for shared embeddings.",
  },
];
const fields = [
  ["title", "Record title"],
  ["kind", "Record type"],
  ["status", "Implementation status"],
  ["date", "Publication date (YYYY-MM or YYYY-MM-DD)"],
  ["venue", "Venue or source"],
  ["url", "Source URL"],
  ["tags", "Memory paths"],
  ["model", "Finding or threat model", true],
  ["mitigation", "Architectural mitigation", true],
  ["limitations", "Limitations", true],
  ["implications", "Implications for Anima Protocol", true],
  ["files", "Affected files", true],
  ["tests", "Tests and fixtures", true],
  ["commands", "Verification commands", true],
  ["expected", "Expected result and evidence", true],
  ["review", "Follow-up review", true],
];
function element(tag, value, cls) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}
function option(value, label = value) {
  const node = element("option", label);
  node.value = value;
  return node;
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
// The existing Site register runs inside its own DOM and uses the active Clerk account's storage key.
export function mountRegister(root, userId) {
  const storageKey = "anima-memory-lab-v1:" + userId;
  const q = (id) => root.getElementById(id);
  let editing = null,
    timer,
    disposed = false,
    currentView = "all";
  const viewName = () => currentView;
  let records = seed;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) records = validate(JSON.parse(stored));
  } catch {
    announce(
      "Saved records could not be loaded. Starter records are displayed.",
    );
  }
  function announce(message) {
    clearTimeout(timer);
    q("notice").textContent = message;
    timer = setTimeout(() => (q("notice").textContent = ""), 4500);
  }
  function validate(input) {
    if (!Array.isArray(input)) throw Error("Expected a record array.");
    const ids = new Set();
    return input.map((record) => {
      if (
        !record ||
        typeof record.id !== "string" ||
        !record.id ||
        ids.has(record.id) ||
        typeof record.title !== "string" ||
        !record.title.trim() ||
        !types.includes(record.kind) ||
        !states.includes(record.status) ||
        !Array.isArray(record.tags) ||
        record.tags.some(
          (tag) =>
            !Object.hasOwn(views, tag) ||
            ["all", "regression", "questions"].includes(tag),
        )
      ) {
        throw Error("A record has invalid fields or a duplicate ID.");
      }
      ids.add(record.id);
      const clean = { id: record.id, tags: [...new Set(record.tags)] };
      for (const [key] of fields)
        if (key !== "tags" && typeof record[key] === "string")
          clean[key] = record[key];
      return clean;
    });
  }
  function save(next, message) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      announce(
        "Browser storage is unavailable. The change could not be saved.",
      );
      return false;
    }
    records = next;
    render();
    announce(message);
    return true;
  }

  function viewRecords(name) {
    if (name === "all") return records;
    if (name === "regression")
      return records.filter((r) => r.kind === types[4]);
    if (name === "questions") return records.filter((r) => r.kind === types[5]);
    return records.filter((r) => r.tags.includes(name));
  }
  function link(name, label, cls) {
    const node = element("a", label, cls);
    node.href = "#" + name;
    node.addEventListener("click", (event) => {
      event.preventDefault();
      currentView = name;
      render();
    });
    return node;
  }
  function render() {
    const name = viewName();
    for (const node of q("nav").querySelectorAll("a")) {
      node.removeAttribute("aria-current");
      if (node.getAttribute("href") === "#" + name)
        node.setAttribute("aria-current", "page");
    }
    q("view").textContent = views[name][0];
    q("description").textContent = views[name][1];
    q("stats").replaceChildren();
    const counts = [
      [
        "all",
        "Research records",
        records.filter((r) => types.indexOf(r.kind) < 4).length,
        types.slice(0, 4).join("|"),
      ],
      [
        "regression",
        "Regression scenarios",
        viewRecords("regression").length,
        "",
      ],
      ["questions", "Open questions", viewRecords("questions").length, ""],
      [
        "all",
        "Verified",
        records.filter((r) => r.status === "Verified").length,
        "",
        "Verified",
      ],
    ];
    for (const [target, label, count, kind, status] of counts) {
      const card = link(target, label, "stat");
      card.prepend(element("strong", String(count)));
      card.addEventListener("click", () => {
        q("search").value = "";
        q("kind").value = kind;
        q("status").value = status ?? "";
        render();
      });
      q("stats").append(card);
    }
    const query = q("search").value.trim().toLowerCase();
    const kind = q("kind").value;
    const status = q("status").value;
    const visible = viewRecords(name).filter(
      (r) =>
        (!kind || kind.split("|").includes(r.kind)) &&
        (!status || r.status === status) &&
        (!query ||
          [...Object.values(r), ...r.tags.map((tag) => views[tag][0])]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
    q("items").replaceChildren();
    if (!visible.length)
      q("items").append(
        element("p", "No records match this view and its filters.", "record"),
      );
    for (const r of visible) {
      const card = element("article", null, "record");
      const head = element("div", null, "sectionhead");
      const info = element("div");
      info.append(
        element("span", r.kind, "tag"),
        element("span", r.status, "tag state"),
        element("h3", r.title),
      );
      const meta = [r.venue, r.date].filter(Boolean).join(" · ");
      if (meta) info.append(element("div", meta, "meta"));
      const open = element("button", "Open record", "secondary");
      open.setAttribute("aria-label", "Open " + r.title);
      open.addEventListener("click", () => show(r.id));
      head.append(info, open);
      card.append(head);
      if (r.model || r.implications || r.expected)
        card.append(element("p", r.model || r.implications || r.expected));
      for (const tag of r.tags) card.append(link(tag, views[tag][0], "tag"));
      q("items").append(card);
    }
  }
  function show(id) {
    const record = records.find((r) => r.id === id);
    if (!record) return;
    q("detail-title").textContent = record.title;
    const body = q("detail-body");
    const list = element("dl");
    for (const [key, label] of fields.slice(1)) {
      const value = record[key];
      if (!value?.length) continue;
      const dd = element("dd");
      if (key === "tags") {
        for (const tag of value) {
          const node = link(tag, views[tag][0], "tag");
          node.addEventListener("click", () => q("detail").close());
          dd.append(node);
        }
      } else if (key === "url" && safeUrl(value)) {
        const source = element("a", "Open publication");
        source.href = safeUrl(value);
        source.target = "_blank";
        source.rel = "noopener noreferrer";
        dd.append(source);
      } else dd.textContent = value;
      list.append(element("dt", label), dd);
    }
    const edit = element("button", "Edit record");
    edit.addEventListener("click", () => {
      q("detail").close();
      openEditor(record);
    });
    body.replaceChildren(list, edit);
    const related = records.filter(
      (item) =>
        item.id !== id && item.tags.some((tag) => record.tags.includes(tag)),
    );
    if (related.length) {
      const links = element("ul");
      for (const item of related) {
        const row = element("li");
        const button = element("button", item.title, "secondary");
        button.addEventListener("click", () => {
          q("detail").close();
          show(item.id);
        });
        row.append(button);
        links.append(row);
      }
      body.append(element("h3", "Records on the same memory paths"), links);
    }
    q("detail").showModal();
  }
  function openEditor(record) {
    editing = record?.id ?? null;
    q("editor-title").textContent = record ? "Edit record" : "New record";
    q("fields").replaceChildren();
    for (const [key, label, wide] of fields) {
      const wrapper = element(
        "label",
        label,
        wide || key === "tags" ? "wide" : "",
      );
      let input;
      if (["kind", "status", "tags"].includes(key)) {
        input = element("select");
        if (key === "tags") {
          input.multiple = true;
          input.size = 4;
          for (const [id, [title]] of Object.entries(views).slice(3)) {
            const item = option(id, title);
            item.selected = record?.tags.includes(id) ?? viewName() === id;
            input.append(item);
          }
        } else {
          for (const value of key === "kind" ? types : states)
            input.append(option(value));
          input.value =
            record?.[key] ??
            (key === "status"
              ? "Proposed"
              : viewName() === "regression"
                ? types[4]
                : viewName() === "questions"
                  ? types[5]
                  : types[3]);
        }
      } else {
        input = element(wide ? "textarea" : "input");
        if (key === "url") input.type = "url";
        if (key === "title") input.required = true;
        input.value = record?.[key] ?? "";
      }
      input.name = key;
      wrapper.append(input);
      q("fields").append(wrapper);
    }
    q("editor").showModal();
  }
  for (const [index, [key, [title]]] of Object.entries(views).entries()) {
    if (index === 0 || index === 3)
      q("nav").append(
        element("div", index === 0 ? "WORKSPACE" : "MEMORY PATHS", "navlabel"),
      );
    const node = link(key, title, "navlink");
    node.addEventListener("click", () => {
      q("search").value = "";
      q("kind").value = "";
      q("status").value = "";
      render();
    });
    q("nav").append(node);
  }
  q("kind").append(
    option(types.slice(0, 4).join("|"), "All research"),
    ...types.map((type) => option(type)),
  );
  q("status").append(...states.map((state) => option(state)));
  q("search").addEventListener("input", render);
  for (const id of ["status", "kind"]) q(id).addEventListener("change", render);
  q("add").addEventListener("click", () => openEditor());
  q("close").addEventListener("click", () => q("detail").close());
  q("cancel").addEventListener("click", () => q("editor").close());
  q("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const record = { id: editing ?? crypto.randomUUID() };
    for (const [key] of fields)
      record[key] = key === "tags" ? form.getAll(key) : form.get(key).trim();
    if (!record.title) {
      announce("Enter a record title.");
      return;
    }
    if (record.url && !safeUrl(record.url)) {
      announce("Use an HTTP or HTTPS source URL.");
      return;
    }
    const next = editing
      ? records.map((r) => (r.id === editing ? record : r))
      : [record, ...records];
    if (save(next, "Record saved.")) {
      q("editor").close();
      q("search").value = "";
      q("kind").value = "";
      q("status").value = "";
      render();
      show(record.id);
    }
  });
  q("export").addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(records, null, 2)], {
        type: "application/json",
      }),
    );
    const node = element("a");
    node.href = url;
    node.download = "anima-memory-security-register.json";
    node.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  q("import").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5_000_000)
        throw Error("The backup must be smaller than 5 MB.");
      const imported = validate(JSON.parse(await file.text()));
      if (disposed) return;
      const next = new Map(records.map((record) => [record.id, record]));
      const replace = q("replace-matching").checked;
      let changed = 0;
      for (const record of imported) {
        if (!replace && next.has(record.id)) continue;
        next.set(record.id, record);
        changed++;
      }
      save([...next.values()], changed + " records imported.");
    } catch (error) {
      announce("Import failed. " + error.message);
    }
  });
  render();
  return () => {
    disposed = true;
    clearTimeout(timer);
    root.replaceChildren();
  };
}
