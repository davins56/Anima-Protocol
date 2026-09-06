export async function fetchIntimacyProfile(characterId) {
  if (!characterId) return null;
  try {
    const res = await fetch(`/api/intimacy/${characterId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile || null;
  } catch (err) {
    console.error("fetchIntimacyProfile error:", err);
    return null;
  }
}

export async function patchIntimacyProfile(characterId, patch) {
  if (!characterId) return null;
  try {
    const res = await fetch(`/api/intimacy/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile || null;
  } catch (err) {
    console.error("patchIntimacyProfile error:", err);
    return null;
  }
}

export async function fetchIntimacyScene(characterId, conversationId) {
  if (!characterId || !conversationId) return null;
  try {
    const res = await fetch(`/api/intimacy/${characterId}/scene/${conversationId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.scene || null;
  } catch (err) {
    console.error("fetchIntimacyScene error:", err);
    return null;
  }
}
