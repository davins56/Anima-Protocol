import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Brain, MessageCircle, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { track } from "@/lib/analytics";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";
import { useStoreSync } from "@/lib/useStoreSync";
import {
  THERAPY_CRISIS_RESOURCES,
  THERAPY_DISCLAIMER,
  localizedTherapyResource,
} from "@/lib/therapyManuals";
import {
  PENDING_THERAPY_TOPIC_MS,
  createTherapyTopic,
  mergePreservedTherapyTopics,
  therapyTopicSaveErrorMessage,
} from "@/lib/createTherapyTopic";
import { pickDefaultAnima, startTherapySession } from "@/lib/startTherapySession";
import { normalizeTherapyTopic } from "@/lib/therapyTopics";

export default function Therapy() {
  usePageMeta(ROUTE_META["/therapy"]);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [anima, setAnima] = useState(null);
  const [animaCount, setAnimaCount] = useState(0);
  const [topics, setTopics] = useState([]);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingTopic, setSavingTopic] = useState(false);
  const [startingId, setStartingId] = useState(null);
  const pendingTopicIdsRef = useRef(new Set());

  const loadTopics = async () => {
    const rows = await base44.entities.TherapyTopic.list("-created_date", 100);
    const listed = (rows || []).filter((t) => t.is_active !== false);
    setTopics((prev) =>
      mergePreservedTherapyTopics(listed, prev, pendingTopicIdsRef.current),
    );
  };

  const refresh = async ({ withSpinner = false } = {}) => {
    if (withSpinner) setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);
      const [animas] = await Promise.all([
        base44.entities.Anima.list("-created_date", 20),
        loadTopics(),
      ]);
      setAnimaCount(animas?.length || 0);
      setAnima(pickDefaultAnima(animas, me?.email));
    } catch (err) {
      console.error(err);
    } finally {
      if (withSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    refresh({ withSpinner: true });
  }, []);

  useStoreSync(() => refresh());

  const localResource = localizedTherapyResource(user?.settings?.user_profile?.country);

  const handleAddTopic = async () => {
    const { title, notes } = normalizeTherapyTopic({ title: newTitle, notes: newNotes });
    // Topics persist on the account store — an Anima is only required to start a session.
    if (!title || savingTopic) return;
    setSavingTopic(true);
    try {
      const created = await createTherapyTopic({
        title,
        notes,
        is_active: true,
      });
      if (created?.id) {
        pendingTopicIdsRef.current.add(created.id);
        window.setTimeout(() => {
          pendingTopicIdsRef.current.delete(created.id);
        }, PENDING_THERAPY_TOPIC_MS);
      }
      setTopics((prev) => {
        const rest = created?.id ? prev.filter((t) => t.id !== created.id) : prev;
        return [created, ...rest];
      });
      setNewTitle("");
      setNewNotes("");
      setShowAddForm(false);
    } catch (err) {
      console.error(err);
      toast.error(therapyTopicSaveErrorMessage(err));
    } finally {
      setSavingTopic(false);
    }
  };

  const handleRemoveTopic = async (id) => {
    try {
      await base44.entities.TherapyTopic.update(id, { is_active: false });
      pendingTopicIdsRef.current.delete(id);
      setTopics((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Could not remove that topic.");
    }
  };

  const beginConversation = async (topic) => {
    if (!anima?.id) {
      toast.error("Create or assign your Anima first.");
      return;
    }
    const startKey = topic?.id || "open";
    if (startingId) return;
    setStartingId(startKey);
    try {
      const session = await startTherapySession({
        anima,
        userName: user?.full_name,
        topic: topic?.title,
        topicId: topic?.id,
        topicNotes: topic?.notes,
      });
      if (topic?.id) {
        try {
          await base44.entities.TherapyTopic.update(topic.id, {
            last_explored_date: new Date().toISOString(),
          });
        } catch {
          /* session already created — exploration stamp is optional */
        }
      }
      track("therapy_session_started", {
        source: "therapy_page",
        is_anima: true,
        has_topic: Boolean(topic?.title),
        has_multiple_animas: animaCount > 1,
      });
      navigate(`/chat/${session.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Could not start the conversation.");
      setStartingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-background">
        <p className="font-mono text-[10px] tracking-[0.4em] uppercase text-violet-300/50 animate-pulse">
          Opening the care room...
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      <div className="border-b border-violet-400/20 bg-black/60 backdrop-blur-md px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-violet-300/40 hover:text-violet-200 transition-colors p-1">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-mono text-violet-100 glow-text tracking-[0.2em] uppercase text-lg">
              Therapy Mode
            </h1>
            <p className="font-mono text-[10px] text-violet-200/40 tracking-widest uppercase mt-0.5">
              Sit with {anima?.name || "your Anima"} · compiled care manuals
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-24 space-y-8">
        <div className="border border-violet-400/20 bg-violet-950/20 px-4 py-3 space-y-2">
          <p className="font-mono text-[10px] sm:text-[11px] leading-relaxed text-violet-100/70">
            {THERAPY_DISCLAIMER}
          </p>
          <p className="font-mono text-[10px] text-violet-200/45">
            {localResource
              ? `${localResource.name}: ${localResource.contact}. `
              : ""}
            Worldwide:{" "}
            <a
              href={THERAPY_CRISIS_RESOURCES.intl.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-violet-200/70"
            >
              {THERAPY_CRISIS_RESOURCES.intl.url.replace("https://", "")}
            </a>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => beginConversation(null)}
            disabled={!anima?.id || Boolean(startingId)}
            className="text-left border border-violet-400/30 hover:border-violet-300/60 bg-violet-950/15 hover:bg-violet-950/25 p-4 transition-colors disabled:opacity-40"
          >
            <div className="flex items-start gap-3">
              <MessageCircle className="w-5 h-5 text-violet-300 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="font-mono text-sm text-violet-100 tracking-[0.12em] uppercase">
                  Sit with {anima?.name || "your Anima"}
                </p>
                <p className="font-mono text-[11px] text-violet-100/50 leading-relaxed">
                  {startingId === "open"
                    ? "Opening the room..."
                    : "Open a care session and name what is present."}
                </p>
              </div>
            </div>
          </button>
          <Link
            to="/meditation"
            className="text-left border border-primary/20 hover:border-primary/40 bg-black/30 p-4 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary/70 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 space-y-1">
                <p className="font-mono text-sm text-primary/80 tracking-[0.12em] uppercase">
                  Sacred Space
                </p>
                <p className="font-mono text-[11px] text-primary/45 leading-relaxed">
                  Affirmations, ritual, and chakra work.
                </p>
              </div>
            </div>
          </Link>
        </div>

        {!anima?.id && (
          <p className="font-mono text-[11px] text-violet-200/50">
            Create your Anima first, then come back to sit in therapy mode.{" "}
            <Link to="/customise-anima?tab=look" className="underline text-violet-200/80">
              Customise Anima
            </Link>
          </p>
        )}

        <section className="space-y-4">
          <div className="flex items-start gap-3">
            <Brain className="w-4 h-4 text-violet-300/80 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <h2 className="font-mono text-xs tracking-[0.2em] uppercase text-violet-100">
                Topics
              </h2>
              <p className="font-mono text-[11px] text-violet-100/50 leading-relaxed">
                Add a subject you want to explore. {anima?.name || "Your Anima"} will stay with
                it and go deeper — what it is, how it shows up, and what might help.
              </p>
            </div>
          </div>

          {topics.length === 0 && !showAddForm && (
            <p className="font-mono text-[11px] text-violet-200/35 px-1">
              No topics yet. Name one when you are ready.
            </p>
          )}

          <div className="space-y-2">
            {topics.map((topic) => (
              <div
                key={topic.id}
                className="border border-violet-400/15 bg-violet-950/10 px-4 py-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-mono text-sm text-violet-50">{topic.title}</p>
                    {topic.notes ? (
                      <p className="font-mono text-[11px] text-violet-100/45 leading-relaxed">
                        {topic.notes}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveTopic(topic.id)}
                    className="font-mono text-[8px] tracking-widest uppercase text-red-300/40 hover:text-red-300 flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => beginConversation(topic)}
                  disabled={!anima?.id || Boolean(startingId)}
                  className="w-full sm:w-auto px-3 py-2 border border-violet-400/40 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20 font-mono text-[10px] tracking-widest uppercase transition-colors disabled:opacity-40"
                >
                  {startingId === topic.id
                    ? "Opening..."
                    : `Go deeper with ${anima?.name || "your Anima"}`}
                </button>
              </div>
            ))}
          </div>

          {showAddForm ? (
            <div className="space-y-3 p-4 border border-violet-400/25 bg-violet-950/15">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Subject — e.g. work burnout, grief after moving"
                className="w-full bg-black/50 border border-violet-400/25 text-violet-50 placeholder-violet-200/25 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-violet-300/50"
              />
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional notes — what you want to go deeper on"
                rows={3}
                className="w-full bg-black/50 border border-violet-400/25 text-violet-50 placeholder-violet-200/25 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-violet-300/50 resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddTopic}
                  disabled={!normalizeTherapyTopic({ title: newTitle }).title || savingTopic}
                  className="px-4 py-2 border border-violet-400/50 bg-violet-500/15 text-violet-100 font-mono text-[9px] tracking-widest uppercase disabled:opacity-30"
                >
                  {savingTopic ? "Saving..." : "Add topic"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-white/10 text-white/40 font-mono text-[9px] tracking-widest uppercase"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 border border-violet-400/20 text-violet-200/60 hover:text-violet-100 hover:border-violet-300/40 font-mono text-[9px] tracking-widest uppercase transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add a topic
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
