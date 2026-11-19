import { afterEach, describe, expect, it, vi } from "vitest";
import markup from "./register.html?raw";
import { mountRegister } from "./register";

function openRegister(userId) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = markup;
  const dispose = mountRegister(root, userId);
  return {
    root,
    close() {
      dispose();
      host.remove();
    },
  };
}

async function importRecords(root, records, replace = false) {
  const input = root.getElementById("import");
  root.getElementById("notice").textContent = "";
  root.getElementById("replace-matching").checked = replace;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([JSON.stringify(records)], "backup.json")],
  });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(root.getElementById("notice").textContent).toMatch(
      /records imported/,
    ),
  );
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("memory security register integration", () => {
  it("restores edited starter records without sharing them between accounts", async () => {
    const steward = openRegister("steward-a");
    const edited = {
      id: "sec001",
      title: "Restored private review",
      kind: "Regression scenario",
      status: "In review",
      tags: ["character"],
    };
    await importRecords(steward.root, [edited]);
    expect(steward.root.textContent).toContain("SEC-001");
    expect(steward.root.textContent).not.toContain(edited.title);
    await importRecords(steward.root, [edited], true);
    steward.close();

    const other = openRegister("steward-b");
    expect(other.root.textContent).not.toContain(edited.title);
    other.close();

    const reopened = openRegister("steward-a");
    reopened.root.querySelector('nav a[href="#character"]').click();
    expect(reopened.root.textContent).toContain(edited.title);
    expect(reopened.root.textContent).not.toContain("PoisonedRAG");
    expect(window.location.hash).toBe("");
    reopened.close();
  });
});
