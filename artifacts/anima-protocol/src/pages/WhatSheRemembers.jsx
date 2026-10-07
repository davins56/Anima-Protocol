import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Lock } from "lucide-react";
import { animaApi } from "@/api/animaApi";
import {
  memoryEmptyLine,
  memoryScreenTitle,
  presentMemoryReview,
  safeMemoryReturn,
} from "@/lib/whatSheRemembers";

const SECTIONS = [
  {
    key: "about_you",
    title: "About you",
    blurb: "Things she remembers about you. These stay separate from her own life.",
    testId: "memory-section-about-you",
  },
  {
    key: "companion",
    title: "Her memories",
    blurb: "Moments and facts that belong to her, not to you.",
    testId: "memory-section-companion",
  },
  {
    key: "core",
    title: "Protected proposals",
    blurb: "Ideas about who she is. They stay locked, unused in chat, and cannot be changed here.",
    testId: "memory-section-core",
  },
];

function sectionTitle(section, companionName) {
  if (section.key !== "companion") return section.title;
  const name = companionName.trim();
  return name ? `${name}'s memories` : section.title;
}

export default function WhatSheRemembers() {
  const { characterId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const companionName = searchParams.get("name")?.trim() || "";
  const returnTo = safeMemoryReturn(searchParams.get("from")) || "/chat";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [review, setReview] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setReview(null);
    setEditingId(null);
    setDraft("");
    setConfirmId(null);
    setBusyId(null);
    setLoading(true);
    setError("");
    animaApi.chat
      .companionMemory(characterId)
      .then((payload) => {
        if (cancelled) return;
        setReview(presentMemoryReview(payload?.review));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Her memories could not be opened.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const title = memoryScreenTitle(companionName);
  const shown = review || { about_you: [], companion: [], core: [] };
  const total = shown.about_you.length + shown.companion.length + shown.core.length;

  const applyReview = (payload) => {
    setReview(presentMemoryReview(payload?.review));
    setEditingId(null);
    setDraft("");
    setConfirmId(null);
    setError("");
  };

  const saveEdit = async (factId) => {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text || busyId) return;
    setBusyId(factId);
    setError("");
    try {
      const payload = await animaApi.chat.updateCompanionMemory(characterId, factId, text);
      applyReview(payload);
    } catch (err) {
      setError(err?.message || "That correction could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  const forget = async (factId) => {
    if (busyId) return;
    setBusyId(factId);
    setError("");
    try {
      const payload = await animaApi.chat.forgetCompanionMemory(characterId, factId);
      applyReview(payload);
    } catch (err) {
      setError(err?.message || "That memory could not be forgotten.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      data-testid="what-she-remembers"
      className="flex-1 min-h-0 overflow-y-auto mobile-page-padding bg-black text-cyan-50"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="max-w-xl mx-auto px-4 py-4 sm:py-8 space-y-6">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate(returnTo)}
            className="inline-flex items-center gap-1 min-h-11 px-3 -ml-3 text-base text-cyan-100/80 touch-manipulation"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            Back to chat
          </button>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-cyan-50">{title}</h1>
          <p className="text-base leading-relaxed text-cyan-100/70">
            {companionName
              ? `Notes ${companionName} kept. Correcting or forgetting one does not change who she is.`
              : "Notes she kept. Correcting or forgetting one does not change who she is."}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-base leading-relaxed text-rose-200">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-base text-cyan-100/60">Opening what she remembers…</p>
        ) : total === 0 && !error ? (
          <p data-testid="memory-empty" className="text-base leading-relaxed text-cyan-100/80">
            {memoryEmptyLine(companionName)}
          </p>
        ) : (
          <div className="space-y-8">
            {SECTIONS.map((section) => {
              const items = shown[section.key] || [];
              if (items.length === 0) return null;
              return (
                <section key={section.key} data-testid={section.testId} className="space-y-3">
                  <div className="space-y-1">
                    <h2 className="text-lg font-medium text-cyan-50">{sectionTitle(section, companionName)}</h2>
                    <p className="text-sm leading-relaxed text-cyan-100/60">{section.blurb}</p>
                  </div>
                  <ul className="space-y-3">
                    {items.map((item) => {
                      const editing = editingId === item.fact_id;
                      const confirming = confirmId === item.fact_id;
                      const busy = busyId === item.fact_id;
                      const canChange = item.editable === true && item.protected !== true && section.key !== "core";
                      return (
                        <li
                          key={item.fact_id}
                          className="rounded-xl border border-cyan-300/20 bg-cyan-950/40 p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-sm text-cyan-100/70">
                            <span>{item.kind_label}</span>
                            {item.protected && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/40 px-2 py-1 text-amber-100">
                                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                                Protected
                              </span>
                            )}
                          </div>
                          {editing ? (
                            <textarea
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              rows={3}
                              maxLength={500}
                              aria-label="Correct this memory"
                              className="w-full min-h-24 rounded-lg border border-cyan-300/30 bg-black/50 p-3 text-base leading-relaxed text-cyan-50"
                              style={{ fontSize: "16px" }}
                            />
                          ) : (
                            <p className="text-base leading-relaxed text-cyan-50">{item.text}</p>
                          )}
                          {item.importance_hint && !item.protected && (
                            <p className="text-sm text-cyan-100/55">{item.importance_hint}</p>
                          )}
                          {canChange && !confirming && (
                            <div className="flex flex-wrap gap-2">
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy || !draft.trim()}
                                    onClick={() => saveEdit(item.fact_id)}
                                    className="min-h-11 px-4 rounded-lg bg-cyan-200 text-base text-slate-950 touch-manipulation disabled:opacity-50"
                                  >
                                    {busy ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      setEditingId(null);
                                      setDraft("");
                                    }}
                                    className="min-h-11 px-4 rounded-lg border border-cyan-300/30 text-base text-cyan-50 touch-manipulation"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(item.fact_id);
                                      setDraft(item.text || "");
                                      setConfirmId(null);
                                    }}
                                    className="min-h-11 px-4 rounded-lg border border-cyan-300/40 text-base text-cyan-50 touch-manipulation"
                                  >
                                    Correct
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmId(item.fact_id);
                                      setEditingId(null);
                                    }}
                                    className="min-h-11 px-4 rounded-lg border border-rose-300/40 text-base text-rose-100 touch-manipulation"
                                  >
                                    Forget
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {canChange && confirming && (
                            <div className="space-y-3 rounded-lg border border-rose-300/30 p-3">
                              <p className="text-base leading-relaxed text-rose-50">
                                Forget this memory? It leaves what she remembers. It does not change her personality.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => forget(item.fact_id)}
                                  className="min-h-11 px-4 rounded-lg bg-rose-200 text-base text-slate-950 touch-manipulation disabled:opacity-50"
                                >
                                  {busy ? "Forgetting…" : "Forget it"}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmId(null)}
                                  className="min-h-11 px-4 rounded-lg border border-cyan-300/30 text-base text-cyan-50 touch-manipulation"
                                >
                                  Keep it
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
