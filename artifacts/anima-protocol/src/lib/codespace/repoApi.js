// Client for /api/repo-codespace — live REPO_ROOT tree on Replit/dev, and
// the GitHub archive proxy used when the browser cannot fetch a zip (CORS).
// Never treats a failed filesystem write as success (Workers have no tree).

import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

async function repoRequest(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    credentials: "same-origin",
    ...options,
    headers: await authHeaders(options.headers),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function isFilesystemUnavailable(result) {
  if (!result) return true;
  if (result.data?.available === false) return true;
  if (result.data?.code === "filesystem_unavailable") return true;
  if (result.status === 503) return true;
  return false;
}

export async function probeRepoFilesystem() {
  try {
    const result = await repoRequest("/repo-codespace/status");
    if (result.ok && result.data?.available === true) {
      return { available: true };
    }
    return {
      available: false,
      status: result.status,
      code: result.data?.code || "filesystem_unavailable",
      error: result.data?.error || "Repository filesystem is not available on this host.",
    };
  } catch {
    return {
      available: false,
      code: "filesystem_unavailable",
      error: "Repository filesystem is not available on this host.",
    };
  }
}

export async function listRepoFiles() {
  const result = await repoRequest("/repo-codespace/files");
  if (!result.ok) {
    return {
      ok: false,
      available: !isFilesystemUnavailable(result),
      files: [],
      error: result.data?.error || `Could not list repo files (${result.status}).`,
    };
  }
  const files = Array.isArray(result.data?.files) ? result.data.files : [];
  return { ok: true, available: true, files };
}

export async function readRepoFile(relPath) {
  const result = await repoRequest("/repo-codespace/read-file", {
    method: "POST",
    body: JSON.stringify({ path: relPath }),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.data?.error || `Could not read ${relPath}.`,
    };
  }
  return { ok: true, content: result.data?.content ?? "" };
}

export async function writeRepoFile(relPath, content) {
  const result = await repoRequest("/repo-codespace/write-file", {
    method: "POST",
    body: JSON.stringify({ path: relPath, content: content ?? "" }),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.data?.error || `Live repo write failed for ${relPath}.`,
    };
  }
  return { ok: true };
}

export async function deleteRepoFile(relPath) {
  const result = await repoRequest("/repo-codespace/delete-file", {
    method: "POST",
    body: JSON.stringify({ path: relPath }),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.data?.error || `Could not delete ${relPath}.`,
    };
  }
  return { ok: true };
}

export async function pullGithubArchiveApi({ owner, repo, branch }) {
  const result = await repoRequest("/repo-codespace/github-archive", {
    method: "POST",
    body: JSON.stringify({ owner, repo, branch }),
  });
  if (!result.ok) {
    return {
      files: [],
      skipped: [],
      errors: [result.data?.error || `GitHub pull failed (${result.status}).`],
    };
  }
  return {
    files: Array.isArray(result.data?.files) ? result.data.files : [],
    skipped: Array.isArray(result.data?.skipped) ? result.data.skipped : [],
    errors: Array.isArray(result.data?.errors) ? result.data.errors : [],
  };
}
