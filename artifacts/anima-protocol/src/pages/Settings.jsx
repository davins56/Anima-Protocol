import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44, exportData } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { deleteAllWithUndo } from "@/lib/undoableDelete";
import {
  ArrowLeft, User, Bot, Sliders, LogOut, Shield, Save, Trash2, AlertTriangle, Loader, Volume2, HelpCircle, Scale, ExternalLink, Download, RotateCcw, CheckCircle
} from "lucide-react";
const resetTutorial = () => localStorage.removeItem("serenity_tutorial_seen_v1");
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { BACKGROUND_THEMES } from "@/components/chat/ChatBackground.jsx";
import { Upload, BookOpen } from "lucide-react";
import UserContextSettings from "@/components/anima/UserContextSettings";
import KnowledgeGraphViewer from "@/components/anima/KnowledgeGraphViewer";
import { entityLabel, parseBackup } from "@/lib/restoreBackup";
import { performRestoreFlow } from "@/lib/restoreHandlers";

const SECTION = { ACCOUNT: "account", BACKGROUND: "background", AI: "ai", INTERFACE: "interface", DATA: "data", LEGAL: "legal" };

const defaultPrefs = {
  ai_creativity: 0.7,
  ai_response_length: "medium",
  ai_language: "english",
  context_window: 10,
  show_timestamps: true,
  show_character_labels: true,
  compact_mode: false,
  sound_enabled: false,
  scanlines_enabled: true,
  display_name: "",
  chat_bg_theme: "default",
  chat_bg_image: "",
  adult_content_enabled: false,
  voice_input_enabled: true,
  auto_read_responses: false,
  theme_mode: "dark",
};

export default function Settings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [section, setSection] = useState(SECTION.ACCOUNT);
  const [user, setUser] = useState(null);
  const [prefs, setPrefs] = useState(defaultPrefs);
  const [saved, setSaved] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [clearingData, setClearingData] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [showAdultGate, setShowAdultGate] = useState(false);
  const [assigningVoices, setAssigningVoices] = useState(false);
  const [voicesAssigned, setVoicesAssigned] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedAt, setExportedAt] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  useEffect(() => {
    loadUser();
    loadStats();
  }, []);

  const loadUser = async () => {
    const me = await base44.auth.me();
    setUser(me);
    if (me?.settings) setPrefs({ ...defaultPrefs, ...me.settings });
    else if (me?.display_name) setPrefs((p) => ({ ...p, display_name: me.display_name || "" }));
  };

  const loadStats = async () => {
    const [sessions, chars] = await Promise.all([
      // Stats only needs the row count — skip hydrating every session's full
      // message history so this loads instantly for users with lots of chats.
      base44.entities.ChatSession.list("-created_date", 200, { withMessages: false }),
      base44.entities.Character.list("-created_date", 200),
    ]);
    setSessionCount(sessions.length);
    setCharCount(chars.length);
  };

  const handleSave = async () => {
    await base44.auth.updateMe({ settings: prefs, display_name: prefs.display_name });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearSessions = async () => {
    setClearingData("sessions");
    try {
      const sessions = await base44.entities.ChatSession.list("-created_date", 200);
      await deleteAllWithUndo({
        entity: "ChatSession",
        items: sessions,
        label: "chat sessions",
        onChange: loadStats,
      });
    } finally {
      setClearingData(null);
    }
  };

  const handleClearCustomChars = async () => {
    setClearingData("chars");
    try {
      const chars = await base44.entities.Character.filter({ is_default: false });
      await deleteAllWithUndo({
        entity: "Character",
        items: chars,
        label: "characters",
        onChange: loadStats,
      });
    } finally {
      setClearingData(null);
    }
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      // Fetch all linked entities in parallel
      const [sessions, chars, memories, vectorMemories, inventory, checkIns, lore, quests] = await Promise.all([
        // Deleting only needs each session's id — skip message hydration.
        base44.entities.ChatSession.list("-created_date", 500, { withMessages: false }),
        base44.entities.Character.filter({ is_default: false }),
        base44.entities.CharacterMemory.list("-created_date", 500).catch(() => []),
        base44.entities.VectorMemory.list("-created_date", 500).catch(() => []),
        base44.entities.Inventory.list("-created_date", 500).catch(() => []),
        base44.entities.CheckIn.list("-created_date", 500).catch(() => []),
        base44.entities.WorldState.list("-created_date", 500).catch(() => []),
        base44.entities.Quest.list("-created_date", 500).catch(() => []),
      ]);
      // Delete all linked entities in parallel
      await Promise.all([
        ...sessions.map((s) => base44.entities.ChatSession.delete(s.id)),
        ...chars.map((c) => base44.entities.Character.delete(c.id)),
        ...memories.map((m) => base44.entities.CharacterMemory.delete(m.id)),
        ...vectorMemories.map((m) => base44.entities.VectorMemory.delete(m.id)),
        ...inventory.map((i) => base44.entities.Inventory.delete(i.id)),
        ...checkIns.map((c) => base44.entities.CheckIn.delete(c.id)),
        ...lore.map((l) => base44.entities.WorldState.delete(l.id)),
        ...quests.map((q) => base44.entities.Quest.delete(q.id)),
      ]);
      // Clear local storage and sign out via Clerk
      localStorage.clear();
      await logout();
    } catch (err) {
      console.error("Error deleting account:", err);
      setDeletingAccount(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleFactoryReset = async () => {
    setResetting(true);
    try {
      // Fetch all deletable entity lists in parallel
      const [sessions, chars, animas, quests, lore, memories, worldStates, checkIns, crystals, resonance, userContexts, graphs] = await Promise.all([
        // Deleting only needs each session's id — skip message hydration.
        base44.entities.ChatSession.list("-created_date", 500, { withMessages: false }),
        base44.entities.Character.filter({ is_default: false }),
        base44.entities.Anima.list("-created_date", 500),
        base44.entities.Quest.list("-created_date", 500),
        base44.entities.WorldState.list("-created_date", 500),
        base44.entities.CharacterMemory.list("-created_date", 500).catch(() => []),
        base44.entities.VectorMemory.list("-created_date", 500).catch(() => []),
        base44.entities.CheckIn.list("-created_date", 500).catch(() => []),
        base44.entities.MemoryCrystal.list("-created_date", 500).catch(() => []),
        base44.entities.ResonanceProfile.list("-created_date", 500).catch(() => []),
        base44.entities.UserContext.list("-created_date", 500).catch(() => []),
        base44.entities.KnowledgeGraph.list("-created_date", 500).catch(() => []),
      ]);

      // Delete everything in parallel batches
      await Promise.all([
        ...sessions.map(s => base44.entities.ChatSession.delete(s.id)),
        ...chars.map(c => base44.entities.Character.delete(c.id)),
        ...animas.map(a => base44.entities.Anima.delete(a.id)),
        ...quests.map(q => base44.entities.Quest.delete(q.id)),
        ...lore.map(l => base44.entities.WorldState.delete(l.id)),
        ...memories.map(m => base44.entities.CharacterMemory.delete(m.id)),
        ...worldStates.map(w => base44.entities.VectorMemory.delete(w.id)),
        ...checkIns.map(c => base44.entities.CheckIn.delete(c.id)),
        ...crystals.map(c => base44.entities.MemoryCrystal.delete(c.id)),
        ...resonance.map(r => base44.entities.ResonanceProfile.delete(r.id)),
        ...userContexts.map(u => base44.entities.UserContext.delete(u.id)),
        ...graphs.map(g => base44.entities.KnowledgeGraph.delete(g.id)),
      ]);

      // Reset user settings to defaults
      await base44.auth.updateMe({ settings: defaultPrefs, display_name: "" });

      // Clear all localStorage (tutorial flags, age verification, etc.)
      localStorage.clear();

      // Redirect to onboarding
      window.location.href = "/onboarding";
    } catch (err) {
      console.error("Factory reset error:", err);
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const data = await exportData();
      const payload = JSON.stringify(data, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `anima-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportedAt(new Date());
      return true;
    } catch (err) {
      console.error("Export failed:", err);
      setExportError(err?.message || "Export failed");
      return false;
    } finally {
      setExporting(false);
    }
  };

  const handleRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreResult(null);
    try {
      const text = await file.text();
      // Validate + summarize before staging; throws (friendly message) for a
      // malformed file so nothing is staged and no network call is made.
      const staged = parseBackup(text);
      // Defer the actual write until the user picks merge vs replace.
      setPendingRestore(staged);
      setConfirmReplace(false);
    } catch (err) {
      console.error("Restore failed:", err);
      setRestoreResult({ ok: false, message: err?.message || "Restore failed" });
    }
  };

  const performRestore = (mode) =>
    performRestoreFlow(mode, {
      pendingRestore,
      setRestoring,
      setRestoreResult,
      setPendingRestore,
      setConfirmReplace,
      loadStats,
      loadUser,
    });

  const cancelRestore = () => {
    setPendingRestore(null);
    setConfirmReplace(false);
  };

  const handleLogout = () => logout();
  const setPref = (key, val) => setPrefs((p) => ({ ...p, [key]: val }));

  const handleAssignVoices = async () => {
    setAssigningVoices(true);
    try {
      const result = await base44.functions.invoke("assignCharacterVoices", {});
      if (result?.data?.assigned > 0) {
        setVoicesAssigned(true);
        setTimeout(() => setVoicesAssigned(false), 3000);
      }
    } catch (err) {
      console.error("Failed to assign voices:", err);
    } finally {
      setAssigningVoices(false);
    }
  };

  const navItems = [
    { id: SECTION.ACCOUNT, label: "Account", icon: User },
    { id: SECTION.BACKGROUND, label: "Background", icon: BookOpen },
    { id: SECTION.AI, label: "AI Behavior", icon: Bot },
    { id: SECTION.INTERFACE, label: "Interface", icon: Sliders },
    { id: SECTION.DATA, label: "Data & Privacy", icon: Shield },
    { id: SECTION.LEGAL, label: "Legal", icon: Scale },
  ];

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-4 sm:px-6 py-4 flex-shrink-0 relative z-40">
        <div className="max-w-4xl mx-auto flex items-center gap-3 sm:gap-4">
          <button onClick={() => navigate(-1)} className="text-primary/40 hover:text-primary transition-colors flex-shrink-0">
            <ArrowLeft className="w-4 sm:w-5 h-4 sm:h-5" />
          </button>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">// Settings</h1>
            <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">System configuration</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 pb-24 lg:pb-6 min-h-0">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row gap-4 sm:gap-6">
        {/* Nav */}
        <nav className="sm:w-48 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible flex-shrink-0 -mx-3 sm:mx-0 px-3 sm:px-0">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-3 px-4 py-2.5 font-mono text-xs tracking-[0.15em] uppercase transition-all text-left whitespace-nowrap sm:whitespace-normal ${
                section === id
                  ? "bg-primary/10 border border-primary/30 text-primary"
                  : "text-primary/40 hover:text-primary/70 border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 space-y-4">

          {/* ── ACCOUNT ── */}
          {section === SECTION.ACCOUNT && (
            <div className="space-y-4">
              <SectionTitle>Account Info</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-4">
                <InfoRow label="Email" value={user?.email || "—"} />
                <InfoRow label="Display Name" value={user?.full_name || "—"} />
                <InfoRow label="Role" value={user?.role || "user"} />
              </div>

              <SectionTitle>Display Name</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5">
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Name shown in chat
                </label>
                <input
                  value={prefs.display_name}
                  onChange={(e) => setPref("display_name", e.target.value)}
                  placeholder="Enter your display name..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-5 py-2 border border-destructive/30 text-destructive/60 hover:text-destructive hover:border-destructive/60 font-mono text-xs tracking-widest uppercase transition-all"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Logout
                </button>
                <SaveButton onSave={handleSave} saved={saved} />
              </div>
            </div>
          )}

          {/* ── BACKGROUND CONTEXT ── */}
          {section === SECTION.BACKGROUND && (
            <div className="space-y-4">
              <UserContextSettings />
              <SectionTitle>Knowledge Graph</SectionTitle>
              <KnowledgeGraphViewer />
            </div>
          )}

          {/* ── AI BEHAVIOR ── */}
          {section === SECTION.AI && (
            <div className="space-y-4">
              <SectionTitle>AI Behavior</SectionTitle>

              <div className="border border-primary/15 bg-black/40 p-5 space-y-5">
                {/* Creativity */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
                      Creativity / Temperature
                    </label>
                    <span className="font-mono text-xs text-primary">{prefs.ai_creativity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range" min="0" max="1" step="0.1"
                    value={prefs.ai_creativity}
                    onChange={(e) => setPref("ai_creativity", parseFloat(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] font-mono text-primary/20 mt-1">
                    <span>Precise</span><span>Balanced</span><span>Creative</span>
                  </div>
                </div>

                {/* Response Length */}
                <SelectPref
                  label="Default Response Length"
                  value={prefs.ai_response_length}
                  onChange={(v) => setPref("ai_response_length", v)}
                  options={[
                    { value: "short", label: "Short (1-2 sentences)" },
                    { value: "medium", label: "Medium (1-2 paragraphs)" },
                    { value: "long", label: "Long (detailed responses)" },
                  ]}
                />

                {/* Language */}
                <SelectPref
                  label="Response Language"
                  value={prefs.ai_language}
                  onChange={(v) => setPref("ai_language", v)}
                  options={[
                    { value: "english", label: "English" },
                    { value: "spanish", label: "Spanish" },
                    { value: "french", label: "French" },
                    { value: "german", label: "German" },
                    { value: "japanese", label: "Japanese" },
                    { value: "portuguese", label: "Portuguese" },
                  ]}
                />

                {/* Context Window */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">
                      Conversation Memory (messages)
                    </label>
                    <span className="font-mono text-xs text-primary">{prefs.context_window}</span>
                  </div>
                  <input
                    type="range" min="4" max="30" step="2"
                    value={prefs.context_window}
                    onChange={(e) => setPref("context_window", parseInt(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] font-mono text-primary/20 mt-1">
                    <span>4 msgs</span><span>30 msgs</span>
                    </div>
                    </div>

                    <SectionTitle>Voice Profiles</SectionTitle>
                    <div className="border border-primary/15 bg-black/40 p-5">
                    <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
                        <Volume2 className="w-3.5 h-3.5" />
                        Auto-Assign ElevenLabs Voices
                      </p>
                      <p className="text-[9px] font-mono text-primary/30 mt-0.5">
                        Automatically assign unique voice profiles to all characters for text-to-speech
                      </p>
                    </div>
                    <button
                      onClick={handleAssignVoices}
                      disabled={assigningVoices}
                      className={`flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border font-mono text-[10px] tracking-widest uppercase transition-all ${
                        voicesAssigned
                          ? "bg-green-900/20 border-green-500/40 text-green-400"
                          : "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30"
                      }`}
                    >
                      {assigningVoices ? (
                        <>
                          <Loader className="w-3 h-3 animate-spin" />
                          Assigning...
                        </>
                      ) : voicesAssigned ? (
                        <>
                          <Volume2 className="w-3 h-3" />
                          Assigned!
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3 h-3" />
                          Assign Voices
                        </>
                      )}
                    </button>
                    </div>
                    </div>
                    </div>

              {/* 18+ Adult Content */}
              <SectionTitle>Content Rating</SectionTitle>
              <div className={`border p-5 space-y-3 ${prefs.adult_content_enabled ? "border-rose-500/30 bg-rose-950/20" : "border-primary/15 bg-black/40"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs tracking-widest uppercase px-1.5 py-0.5 border border-rose-500/50 text-rose-400 bg-rose-500/10 text-[9px]">18+</span>
                      <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">Adult Content Mode</p>
                    </div>
                    <p className="text-[9px] font-mono text-primary/30 leading-relaxed">
                      Enables explicit, lewd, and sexual roleplay content. By enabling this you confirm you are 18 years of age or older.
                    </p>
                    {prefs.adult_content_enabled && (
                      <p className="text-[9px] font-mono text-rose-400/70 mt-1.5">● Adult mode active — explicit content permitted</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!prefs.adult_content_enabled) {
                        setShowAdultGate(true);
                      } else {
                        setPref("adult_content_enabled", false);
                      }
                    }}
                    className={`relative w-10 h-5 border transition-all flex-shrink-0 ${
                      prefs.adult_content_enabled ? "bg-rose-500/20 border-rose-500/50" : "bg-black/60 border-primary/15"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 transition-all ${
                        prefs.adult_content_enabled ? "left-5 bg-rose-400" : "left-0.5 bg-primary/20"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <SaveButton onSave={handleSave} saved={saved} />
              </div>
            </div>
          )}

          {/* ── INTERFACE ── */}
          {section === SECTION.INTERFACE && (
            <div className="space-y-4">
              <SectionTitle>Interface Preferences</SectionTitle>

              <div className="border border-primary/15 bg-black/40 p-5 space-y-0 divide-y divide-primary/10">
                <TogglePref
                  label="Show Timestamps"
                  description="Display message timestamps in chat"
                  value={prefs.show_timestamps}
                  onChange={(v) => setPref("show_timestamps", v)}
                />
                <TogglePref
                  label="Show Character Labels"
                  description="Display character name above each response"
                  value={prefs.show_character_labels}
                  onChange={(v) => setPref("show_character_labels", v)}
                />
                <TogglePref
                  label="Compact Mode"
                  description="Reduce spacing between messages"
                  value={prefs.compact_mode}
                  onChange={(v) => setPref("compact_mode", v)}
                />
                <TogglePref
                  label="CRT Scanlines"
                  description="Retro scanline overlay effect"
                  value={prefs.scanlines_enabled}
                  onChange={(v) => setPref("scanlines_enabled", v)}
                />
                <TogglePref
                  label="Sound Effects"
                  description="UI sounds and notification tones"
                  value={prefs.sound_enabled}
                  onChange={(v) => setPref("sound_enabled", v)}
                />
                <TogglePref
                  label="Voice Input"
                  description="Enable speech-to-text voice input during chat"
                  value={prefs.voice_input_enabled}
                  onChange={(v) => setPref("voice_input_enabled", v)}
                />
                <TogglePref
                   label="Auto-Read Responses"
                   description="Automatically read character responses aloud"
                   value={prefs.auto_read_responses}
                   onChange={(v) => setPref("auto_read_responses", v)}
                 />
                </div>

                <SectionTitle>Theme</SectionTitle>
                <div className="border border-primary/15 bg-black/40 p-5">
                 <div className="flex items-center justify-between gap-4">
                   <div>
                     <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">Color Theme</p>
                     <p className="text-[9px] font-mono text-primary/30 mt-0.5">Toggle between dark and light interface</p>
                   </div>
                   <div className="flex gap-2 flex-shrink-0">
                     <button
                       onClick={() => setPref("theme_mode", "dark")}
                       className={`px-4 py-1.5 border font-mono text-[10px] tracking-widest uppercase transition-all ${
                         prefs.theme_mode === "dark"
                           ? "bg-primary/20 border-primary/50 text-primary"
                           : "border-primary/15 text-primary/40 hover:text-primary/70"
                       }`}
                     >
                       Dark
                     </button>
                     <button
                       onClick={() => setPref("theme_mode", "light")}
                       className={`px-4 py-1.5 border font-mono text-[10px] tracking-widest uppercase transition-all ${
                         prefs.theme_mode === "light"
                           ? "bg-primary/20 border-primary/50 text-primary"
                           : "border-primary/15 text-primary/40 hover:text-primary/70"
                       }`}
                     >
                       Light
                     </button>
                   </div>
                 </div>
                </div>

                <SectionTitle>Chat Background</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {BACKGROUND_THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setPref("chat_bg_theme", t.id)}
                      className={`relative flex flex-col items-center justify-center gap-1.5 p-3 border transition-all ${
                        prefs.chat_bg_theme === t.id
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-primary/15 bg-black/40 text-primary/40 hover:border-primary/30"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded ${t.preview} border border-white/10`} />
                      <span className="font-mono text-[9px] tracking-widest uppercase">{t.label}</span>
                    </button>
                  ))}
                </div>

                {prefs.chat_bg_theme === "custom" && (
                  <div className="space-y-2 pt-2 border-t border-primary/10">
                    <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase">Custom Background Image</label>
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          setUploadingBg(true);
                          const { file_url } = await base44.integrations.Core.UploadFile({ file });
                          setPref("chat_bg_image", file_url);
                          setUploadingBg(false);
                        }}
                      />
                      <span className="flex items-center gap-2 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-widest uppercase transition-all">
                        <Upload className="w-3 h-3" />
                        {uploadingBg ? "Uploading..." : "Upload Image"}
                      </span>
                    </label>
                    {prefs.chat_bg_image && (
                      <div className="relative w-full h-24 border border-primary/20 overflow-hidden">
                        <img src={prefs.chat_bg_image} alt="bg preview" className="w-full h-full object-cover" />
                        <button
                          onClick={() => setPref("chat_bg_image", "")}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/80 border border-primary/30 text-primary/50 hover:text-primary flex items-center justify-center font-mono text-xs"
                        >×</button>
                      </div>
                    )}
                    <input
                      value={prefs.chat_bg_image}
                      onChange={(e) => setPref("chat_bg_image", e.target.value)}
                      placeholder="Or paste image URL..."
                      className="w-full bg-black/60 border border-primary/15 text-primary/70 placeholder-primary/15 font-mono text-[10px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <SaveButton onSave={handleSave} saved={saved} />
              </div>
            </div>
          )}

          {/* ── LEGAL ── */}
          {section === SECTION.LEGAL && (
            <div className="space-y-4">
              <SectionTitle>Legal Documents</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-0 divide-y divide-primary/10">
                <LegalLink href="/terms" label="Terms of Service" description="Usage rules and service agreements for Anima Protocol" />
                <LegalLink href="/privacy-policy" label="Privacy Policy" description="How we collect, use, and protect your data" />
                <LegalLink href="/disclaimer" label="Disclaimer" description="Important disclaimers regarding AI-generated content" />
              </div>

              <SectionTitle>About</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-2">
                <InfoRow label="Operated By" value="Echoes of Eden Inc." />
                <InfoRow label="Platform" value="Anima Protocol" />
                <InfoRow label="Version" value="v4.3.0" />
              </div>
            </div>
          )}

          {/* ── DATA & PRIVACY ── */}
          {section === SECTION.DATA && (
            <div className="space-y-4">
              <SectionTitle>Storage</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 grid grid-cols-2 gap-4">
                <StatBox label="Chat Sessions" value={sessionCount} />
                <StatBox label="Custom Characters" value={charCount} />
              </div>

              <SectionTitle>Backup &amp; Restore</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
                      <Download className="w-3.5 h-3.5" />
                      Export My Data
                    </p>
                    <p className="text-[9px] font-mono text-primary/30 mt-0.5 leading-relaxed">
                      Download a JSON backup of everything — chat sessions, characters, memories, quests, lore, inventory &amp; more. Keep it safe before wiping your data.
                    </p>
                    {exportedAt && (
                      <p className="text-[9px] font-mono text-green-400/70 mt-1.5 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Backup downloaded {exportedAt.toLocaleTimeString()}
                      </p>
                    )}
                    {exportError && (
                      <p className="text-[9px] font-mono text-destructive/70 mt-1.5">{exportError}</p>
                    )}
                  </div>
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 font-mono text-[10px] tracking-widest uppercase transition-all"
                  >
                    {exporting ? <Loader className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    {exporting ? "Exporting..." : "Export"}
                  </button>
                </div>

                <div className="flex items-start justify-between gap-4 pt-4 border-t border-primary/10">
                  <div>
                    <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore From Backup
                    </p>
                    <p className="text-[9px] font-mono text-primary/30 mt-0.5 leading-relaxed">
                      Import a previously exported backup file. You'll choose whether to merge it into your current data or replace everything.
                    </p>
                    {restoreResult && (
                      <p className={`text-[9px] font-mono mt-1.5 leading-relaxed ${restoreResult.ok ? "text-green-400/70" : "text-orange-400/70"}`}>
                        {restoreResult.ok
                          ? `${restoreResult.mode === "replace" ? "Replaced everything with" : "Merged in"} ${restoreResult.count} record${restoreResult.count === 1 ? "" : "s"}.`
                          : restoreResult.message}
                      </p>
                    )}
                  </div>
                  <label className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border border-primary/30 text-primary/70 hover:text-primary hover:border-primary/50 font-mono text-[10px] tracking-widest uppercase transition-all cursor-pointer">
                    {restoring ? <Loader className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    {restoring ? "Restoring..." : "Restore"}
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      disabled={restoring}
                      onChange={handleRestoreFile}
                    />
                  </label>
                </div>
              </div>

              <SectionTitle>Clear Data</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-3">
                <DangerAction
                  label="Clear All Chat Sessions"
                  description="Permanently deletes all conversation history"
                  buttonLabel={clearingData === "sessions" ? "Clearing..." : "Clear Sessions"}
                  disabled={clearingData !== null}
                  onClick={handleClearSessions}
                />
                <DangerAction
                  label="Clear Custom Characters"
                  description="Removes all user-created characters (default characters remain)"
                  buttonLabel={clearingData === "chars" ? "Clearing..." : "Clear Characters"}
                  disabled={clearingData !== null}
                  onClick={handleClearCustomChars}
                />
              </div>

              <SectionTitle>Factory Reset</SectionTitle>
              <div className="border border-orange-500/30 bg-orange-950/10 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-orange-400/80 tracking-wider uppercase">Reset Everything</p>
                    <p className="text-[9px] font-mono text-primary/30 mt-0.5">
                      Wipes all sessions, characters, memories, quests, lore, animas, and settings. Starts fresh from onboarding. Cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 hover:border-orange-400 font-mono text-[10px] tracking-widest uppercase transition-all"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Reset
                  </button>
                </div>
              </div>

              <SectionTitle>Danger Zone</SectionTitle>
              <div className="border border-destructive/40 bg-destructive/5 p-5 space-y-4">
                <div className="flex items-start gap-3 pb-4 border-b border-destructive/20">
                  <AlertTriangle className="w-4 h-4 text-destructive/70 flex-shrink-0 mt-0.5" />
                  <p className="font-mono text-[9px] text-destructive/60 leading-relaxed">
                    Actions in this section are <span className="text-destructive font-bold">permanent and irreversible</span>. All memories, character relationships, chat history, lore, and personal data will be permanently erased.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-destructive/80 tracking-wider uppercase">Delete Account</p>
                    <p className="text-[9px] font-mono text-primary/40 mt-1 leading-relaxed">
                      Permanently erases your account including all memories, character relationships, chat history, lore entries, quests, and personal data. You will be logged out immediately.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border border-destructive/60 bg-destructive/15 text-destructive hover:bg-destructive/25 hover:border-destructive font-mono text-[10px] tracking-widest uppercase transition-all min-h-[44px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Account
                  </button>
                </div>
              </div>

              <SectionTitle>Help</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-primary/70 tracking-wider uppercase flex items-center gap-2">
                      <HelpCircle className="w-3.5 h-3.5" />
                      Feature Tutorial
                    </p>
                    <p className="text-[9px] font-mono text-primary/30 mt-0.5">
                      Replay the guided tour of all app features
                    </p>
                  </div>
                  <button
                    onClick={() => { resetTutorial(); window.location.href = "/"; }}
                    className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 border border-primary/30 bg-primary/5 text-primary/70 hover:text-primary hover:border-primary/50 font-mono text-[10px] tracking-widest uppercase transition-all"
                  >
                    <HelpCircle className="w-3 h-3" />
                    Replay
                  </button>
                </div>
              </div>

              <SectionTitle>About</SectionTitle>
              <div className="border border-primary/15 bg-black/40 p-5 space-y-2">
                <InfoRow label="Version" value="v4.3.0-RESONANCE" />
                <InfoRow label="AI Engine" value="Core LLM" />
                <InfoRow label="Platform" value="Base44" />
              </div>
            </div>
          )}

        </div>
      </div>

      {/* 18+ Age Gate */}
      {showAdultGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-background border border-rose-500/40 hud-corner p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <h2 className="font-mono text-rose-400 tracking-[0.2em] uppercase text-sm">Age Verification</h2>
            </div>
            <div className="border border-rose-500/20 bg-rose-950/30 px-4 py-3">
              <p className="font-mono text-[10px] text-rose-300/80 tracking-wider leading-relaxed">
                This feature enables explicit adult content including sexual and lewd roleplay. It is intended for adults only.
              </p>
            </div>
            <p className="font-mono text-xs text-primary/60 leading-relaxed">
              By continuing, you confirm that you are <span className="text-rose-400 font-bold">18 years of age or older</span> and consent to viewing adult content.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowAdultGate(false)}
                className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setPref("adult_content_enabled", true);
                  setShowAdultGate(false);
                }}
                className="flex-1 px-4 py-2 bg-rose-900/30 border border-rose-500/60 text-rose-400 hover:bg-rose-900/50 font-mono text-xs tracking-widest uppercase transition-all"
              >
                I Am 18+ — Enable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore From Backup Dialog */}
      {pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-background border border-primary/40 hud-corner p-6 space-y-4">
            <div className="flex items-center gap-3">
              <RotateCcw className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="font-mono text-primary tracking-[0.2em] uppercase text-sm">Restore Backup</h2>
            </div>
            <div className="space-y-2">
              <p className="font-mono text-[10px] text-primary/50 tracking-wider leading-relaxed">
                This backup contains <span className="text-primary font-bold">{pendingRestore.recordCount}</span> record{pendingRestore.recordCount === 1 ? "" : "s"}
                {pendingRestore.exportedLabel ? <> · exported {pendingRestore.exportedLabel}</> : null}.
              </p>
              {pendingRestore.breakdown.length > 0 && (
                <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-40 overflow-y-auto border-t border-primary/10 pt-2">
                  {pendingRestore.breakdown.map((item) => (
                    <li
                      key={item.name}
                      className="font-mono text-[9px] text-primary/40 tracking-wider flex justify-between gap-2"
                    >
                      <span className="truncate capitalize">{entityLabel(item.name, item.count)}</span>
                      <span className="text-primary/70 font-bold flex-shrink-0">{item.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!confirmReplace ? (
              <>
                <div className="space-y-3">
                  <button
                    onClick={() => performRestore("merge")}
                    disabled={restoring}
                    className="w-full text-left border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 disabled:opacity-40 p-4 transition-all"
                  >
                    <p className="font-mono text-xs text-primary tracking-wider uppercase flex items-center gap-2">
                      {restoring ? <Loader className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Merge Into Current Data
                    </p>
                    <p className="text-[9px] font-mono text-primary/40 mt-1 leading-relaxed">
                      Adds and updates records from the backup, keeping anything not in the backup. Nothing is deleted.
                    </p>
                  </button>
                  <button
                    onClick={() => setConfirmReplace(true)}
                    disabled={restoring}
                    className="w-full text-left border border-orange-500/40 bg-orange-950/10 hover:bg-orange-900/20 hover:border-orange-400 disabled:opacity-40 p-4 transition-all"
                  >
                    <p className="font-mono text-xs text-orange-400 tracking-wider uppercase flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3" />
                      Replace Everything
                    </p>
                    <p className="text-[9px] font-mono text-orange-300/50 mt-1 leading-relaxed">
                      Wipes all current data first, then restores the backup. Cannot be undone.
                    </p>
                  </button>
                </div>
                <button
                  onClick={cancelRestore}
                  disabled={restoring}
                  className="w-full px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-30"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <div className="border border-orange-500/20 bg-orange-950/30 px-4 py-3 space-y-1">
                  <p className="font-mono text-[10px] text-orange-300/80 tracking-wider leading-relaxed">
                    Replacing everything will <span className="text-destructive font-bold">permanently delete</span> all of your current data — chat sessions, characters, memories, quests, lore &amp; more — before restoring the backup.
                  </p>
                </div>
                <p className="font-mono text-xs text-primary/60 leading-relaxed">
                  This <span className="text-destructive">cannot be undone</span>. Continue?
                </p>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setConfirmReplace(false)}
                    disabled={restoring}
                    className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-30"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => performRestore("replace")}
                    disabled={restoring}
                    className="flex-1 px-4 py-2 bg-orange-900/30 border border-orange-500/60 text-orange-400 hover:bg-orange-900/50 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                  >
                    {restoring ? (
                      <><Loader className="w-3 h-3 animate-spin" /> Restoring...</>
                    ) : (
                      "Replace Everything"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Factory Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-background border border-orange-500/40 hud-corner p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0" />
              <h2 className="font-mono text-orange-400 tracking-[0.2em] uppercase text-sm">Factory Reset</h2>
            </div>
            <div className="border border-orange-500/20 bg-orange-950/30 px-4 py-3 space-y-1">
              <p className="font-mono text-[10px] text-orange-300/80 tracking-wider leading-relaxed">
                This will permanently erase:
              </p>
              <ul className="font-mono text-[9px] text-orange-300/60 space-y-0.5 ml-3">
                <li>• All chat sessions &amp; conversation history</li>
                <li>• All characters, animas &amp; companions</li>
                <li>• All memories, lore, quests &amp; check-ins</li>
                <li>• All settings &amp; preferences</li>
              </ul>
            </div>
            <p className="font-mono text-xs text-primary/60 leading-relaxed">
              You will be taken back to <span className="text-orange-400 font-bold">onboarding</span> to start fresh. This <span className="text-destructive">cannot be undone</span>.
            </p>
            <button
              onClick={handleExport}
              disabled={resetting || exporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 font-mono text-[10px] tracking-widest uppercase transition-all"
            >
              {exporting ? <Loader className="w-3 h-3 animate-spin" /> : exportedAt ? <CheckCircle className="w-3 h-3" /> : <Download className="w-3 h-3" />}
              {exporting ? "Exporting..." : exportedAt ? "Backup Downloaded — Export Again" : "Export My Data First"}
            </button>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                onClick={handleFactoryReset}
                disabled={resetting}
                className="flex-1 px-4 py-2 bg-orange-900/30 border border-orange-500/60 text-orange-400 hover:bg-orange-900/50 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
              >
                {resetting ? (
                  <><Loader className="w-3 h-3 animate-spin" /> Resetting...</>
                ) : (
                  "Confirm Reset"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-background border border-destructive/40 hud-corner p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-destructive flex-shrink-0" />
              <h2 className="font-mono text-destructive tracking-[0.2em] uppercase text-sm">Delete Account</h2>
            </div>
            <div className="border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-1">
              <p className="font-mono text-[10px] text-destructive/70 tracking-wider">The following will be permanently erased:</p>
              <ul className="font-mono text-[9px] text-primary/50 space-y-0.5 ml-3 mt-1">
                <li>• All chat sessions &amp; conversation history</li>
                <li>• All character memories &amp; relationships</li>
                <li>• All lore, quests, world state &amp; check-ins</li>
                <li>• Your account profile &amp; preferences</li>
              </ul>
            </div>
            <p className="font-mono text-xs text-primary/60 leading-relaxed">
              This action <span className="text-destructive font-bold">cannot be undone</span>. You will be logged out immediately.
            </p>
            <button
              onClick={handleExport}
              disabled={deletingAccount || exporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 font-mono text-[10px] tracking-widest uppercase transition-all min-h-[44px]"
            >
              {exporting ? <Loader className="w-3 h-3 animate-spin" /> : exportedAt ? <CheckCircle className="w-3 h-3" /> : <Download className="w-3 h-3" />}
              {exporting ? "Exporting..." : exportedAt ? "Backup Downloaded — Export Again" : "Export My Data First"}
            </button>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingAccount}
                className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-30 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                className="flex-1 px-4 py-2 bg-destructive/20 border border-destructive/60 text-destructive hover:bg-destructive/30 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all min-h-[44px]"
              >
                {deletingAccount ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
      );
      }

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <h3 className="text-[9px] font-mono text-primary/40 tracking-[0.3em] uppercase">{children}</h3>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-primary/40 tracking-widest uppercase">{label}</span>
      <span className="font-mono text-xs text-primary/70">{value}</span>
    </div>
  );
}

function SelectPref({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/80 font-mono text-sm min-h-[44px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-background border-primary/30">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="font-mono text-primary/80">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TogglePref({ label, description, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">{label}</p>
        <p className="text-[9px] font-mono text-primary/30 mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 border transition-all flex-shrink-0 ${
          value ? "bg-primary/20 border-primary/50" : "bg-black/60 border-primary/15"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 transition-all ${
            value ? "left-5 bg-primary" : "left-0.5 bg-primary/20"
          }`}
        />
      </button>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="text-center p-4 border border-primary/10 bg-primary/5">
      <p className="font-mono text-2xl text-primary glow-text">{value}</p>
      <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase mt-1">{label}</p>
    </div>
  );
}

function DangerAction({ label, description, buttonLabel, disabled, onClick }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">{label}</p>
        <p className="text-[9px] font-mono text-primary/30 mt-0.5">{description}</p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex-shrink-0 px-4 py-1.5 border border-destructive/30 text-destructive/60 hover:text-destructive hover:border-destructive/60 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[10px] tracking-widest uppercase transition-all"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function LegalLink({ href, label, description }) {
  const handleOpen = (e) => {
    e.preventDefault();
    window.open(href, "_blank");
  };

  return (
    <button
      onClick={handleOpen}
      className="flex items-center justify-between py-3 group w-full text-left"
    >
      <div>
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase group-hover:text-primary transition-colors">{label}</p>
        <p className="text-[9px] font-mono text-primary/30 mt-0.5">{description}</p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-primary/30 group-hover:text-primary transition-colors flex-shrink-0" />
    </button>
  );
}

function SaveButton({ onSave, saved }) {
  return (
    <button
      onClick={onSave}
      className={`flex items-center gap-2 px-6 py-2 border font-mono text-xs tracking-widest uppercase transition-all hud-corner ${
        saved
          ? "bg-green-900/20 border-green-500/40 text-green-400"
          : "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 glow-border"
      }`}
    >
      <Save className="w-3.5 h-3.5" />
      {saved ? "Saved!" : "Save Changes"}
    </button>
  );
}