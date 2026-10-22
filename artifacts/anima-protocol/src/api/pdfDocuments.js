import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "./authBridge";
import { pdfFileRejection } from "@/lib/pdfLimits";

/**
 * Send the file as raw `application/pdf` bytes. No base64 round-trip, so the
 * browser and the Worker each hold the file once (up to 20 MB).
 */
function postPdf(url, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(headers || {})) {
      if (value != null && key.toLowerCase() !== "content-type") xhr.setRequestHeader(key, String(value));
    }
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress({ phase: "uploading", ratio: event.loaded / event.total });
      }
    };
    xhr.upload.onload = () => {
      onProgress?.({ phase: "extracting", ratio: 1 });
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const error = new Error(
        data.error || (xhr.status === 413 ? "That PDF is too large." : "Could not upload that PDF."),
      );
      error.code = data.code;
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => reject(new Error("Could not upload that PDF. Check your connection and try again."));
    xhr.send(file);
  });
}

async function request(path, options = {}) {
  const headers = await authHeaders(options.headers);
  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Could not update that PDF.");
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function uploadPdfDocument({
  file,
  scope,
  sessionId,
  characterId,
  onProgress,
}) {
  const rejection = pdfFileRejection(file);
  if (rejection) throw new Error(rejection);
  const params = new URLSearchParams({ scope, filename: file.name || "document.pdf" });
  if (sessionId) params.set("session_id", sessionId);
  if (characterId) params.set("character_id", characterId);
  const headers = await authHeaders();
  const payload = await postPdf(apiUrl(`/pdfs?${params.toString()}`), headers, file, onProgress);
  onProgress?.({ phase: "ready", ratio: 1 });
  return payload.file;
}

export async function listPdfDocuments({ scope, sessionId, characterId }) {
  const params = new URLSearchParams({ scope });
  if (sessionId) params.set("session_id", sessionId);
  if (characterId) params.set("character_id", characterId);
  const data = await request(`/pdfs?${params.toString()}`);
  return data?.files || [];
}

export async function renamePdfDocument(id, filename) {
  const data = await request(`/pdfs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ filename }),
  });
  return data?.file;
}

export async function deletePdfDocument(id) {
  await request(`/pdfs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Open the stored PDF in a new tab. The request carries the signed-in session. */
export function openPdfDocument(id) {
  const popup = typeof window !== "undefined" ? window.open("", "_blank") : null;
  if (!popup) {
    return Promise.reject(new Error("Allow pop-ups to open this PDF."));
  }
  return (async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(apiUrl(`/pdfs/${encodeURIComponent(id)}/file`), {
        headers,
        credentials: "same-origin",
      });
      if (!res.ok) {
        let message = "Could not open that PDF.";
        try {
          const data = await res.json();
          if (data?.error) message = String(data.error);
        } catch {
          // Non-JSON error page.
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const pdf =
        blob.type === "application/pdf"
          ? blob
          : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdf);
      popup.location.href = url;
      try {
        popup.opener = null;
      } catch {
        // The new tab can already be detached from this page.
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      popup?.close();
      throw error;
    }
  })();
}

export function pdfProgressLabel(progress) {
  if (!progress) return "Reading PDF…";
  if (progress.phase === "reading_file") return "Reading file…";
  if (progress.phase === "uploading") {
    const pct = Math.round((progress.ratio || 0) * 100);
    return `Uploading ${pct}%`;
  }
  if (progress.phase === "extracting") return "Reading the PDF…";
  return "Reading PDF…";
}
