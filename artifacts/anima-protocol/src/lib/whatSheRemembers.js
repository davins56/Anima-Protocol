/**
 * Paths and display grouping for the "What she remembers" screen.
 * Sections come from the server. This only keeps user facts from rendering
 * inside the companion's own list if a payload is ever mis-filed.
 */

export function safeMemoryReturn(from) {
  if (typeof from !== "string") return null;
  const value = from.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) return null;
  if (value.includes("\\")) return null;
  return value;
}

export function whatSheRemembersPath({ characterId, companionName, returnTo } = {}) {
  const id = String(characterId || "").trim();
  const params = new URLSearchParams();
  const name = typeof companionName === "string" ? companionName.trim() : "";
  const back = safeMemoryReturn(returnTo);
  if (name) params.set("name", name);
  if (back) params.set("from", back);
  const query = params.toString();
  return `/what-she-remembers/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

export function sessionMemoryTargets(session, characters) {
  if (!session) return [];
  const ids =
    session.mode === "group"
      ? [...new Set(session.group_character_ids || [])]
      : session.character_id
        ? [session.character_id]
        : [];
  const returnTo = session.id ? `/chat/${session.id}` : "/chat";
  return ids.filter(Boolean).map((id) => {
    const character = (characters || []).find((item) => item?.id === id);
    const name = typeof character?.name === "string" ? character.name.trim() : "";
    const label =
      session.mode === "group"
        ? name
          ? `What ${name} remembers`
          : "What they remember"
        : "What she remembers";
    return {
      id,
      name,
      label,
      to: whatSheRemembersPath({ characterId: id, companionName: name, returnTo }),
    };
  });
}

function asItems(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

/**
 * User sentences stay in About you. Companion sentences stay in her list.
 * Protected identity proposals stay in their own list and are never editable.
 */
export function presentMemoryReview(review) {
  const all = [
    ...asItems(review?.about_you),
    ...asItems(review?.companion),
    ...asItems(review?.core),
  ];
  const aboutYou = [];
  const companion = [];
  const core = [];
  const seen = new Set();
  for (const item of all) {
    const id = String(item.fact_id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (item.about === "user") {
      const locked = item.memory_class === "core" || item.protected === true;
      aboutYou.push(locked ? { ...item, editable: false, protected: true } : item);
      continue;
    }
    if (item.about !== "companion") continue;
    // The server section decides the list. A protected episodic memory stays
    // with her memories. Only a core section, or a core memory class, is a
    // locked identity proposal.
    if (item.section === "core" || item.memory_class === "core") {
      core.push({ ...item, editable: false, protected: true });
      continue;
    }
    companion.push(item);
  }
  return { about_you: aboutYou, companion, core };
}

export function memoryScreenTitle(companionName) {
  const name = typeof companionName === "string" ? companionName.trim() : "";
  return name ? `What ${name} remembers` : "What she remembers";
}

export function memoryEmptyLine(companionName) {
  const name = typeof companionName === "string" ? companionName.trim() : "";
  return name
    ? `${name} hasn't remembered anything yet.`
    : "She hasn't remembered anything yet.";
}
