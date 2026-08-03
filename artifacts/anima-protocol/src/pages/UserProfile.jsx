import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { ArrowLeft, UserCircle, Check, Loader2 } from "lucide-react";

const EMPTY_PROFILE = {
  preferred_name: "",
  pronouns: "",
  age: "",
  bio: "",
  interests: "",
  communication_preference: "",
  goals: "",
  boundaries: "",
};

const FIELDS = [
  {
    key: "preferred_name",
    label: "What should your Anima call you?",
    placeholder: "A name or nickname...",
    type: "input",
  },
  {
    key: "pronouns",
    label: "Pronouns",
    placeholder: "e.g. she/her, he/him, they/them...",
    type: "input",
  },
  {
    key: "age",
    label: "Age (optional)",
    placeholder: "e.g. 27",
    type: "input",
  },
  {
    key: "bio",
    label: "About you",
    placeholder: "Who you are, what your life looks like, what matters to you...",
    type: "textarea",
  },
  {
    key: "interests",
    label: "Interests & passions",
    placeholder: "Hobbies, music, work, the things you love to talk about...",
    type: "textarea",
  },
  {
    key: "communication_preference",
    label: "How you like to be spoken to",
    placeholder: "Warm and gentle? Direct and honest? Playful? Quiet and slow?",
    type: "textarea",
  },
  {
    key: "goals",
    label: "What you want from your Anima",
    placeholder: "Support, companionship, reflection, motivation, someone to listen...",
    type: "textarea",
  },
  {
    key: "boundaries",
    label: "Boundaries to respect",
    placeholder: "Topics to avoid, things that are sensitive for you...",
    type: "textarea",
  },
];

export default function UserProfile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    base44.auth
      .me()
      .then((me) => {
        if (!alive) return;
        setSettings(me?.settings || {});
        const existing = me?.settings?.user_profile;
        if (existing) setProfile({ ...EMPTY_PROFILE, ...existing });
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const setField = (key, value) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Re-fetch the latest settings so we never clobber other keys with a
      // stale (or failed) initial load before writing user_profile.
      const me = await base44.auth.me();
      const baseSettings = me?.settings || settings || {};
      const nextSettings = { ...baseSettings, user_profile: profile };
      await base44.auth.updateMe({ settings: nextSettings });
      setSettings(nextSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-black text-primary">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 border border-primary/15 hover:border-primary/40 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4 text-primary/70" />
          </button>
          <div className="flex items-center gap-2.5">
            <UserCircle className="w-5 h-5 text-primary/70" />
            <div>
              <h1 className="text-sm font-mono tracking-[0.25em] uppercase text-primary/90">
                Your Profile
              </h1>
              <p className="text-[9px] font-mono tracking-[0.2em] uppercase text-primary/30">
                Account default • seen by your Anima
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs font-mono leading-relaxed text-primary/40 border border-primary/10 bg-primary/[0.03] p-4">
          This is who you are. Anyone you talk to here — your Anima and any
          companion — can reference this profile to know you, remember what
          matters to you, and speak to you the way you prefer. It stays with your
          account.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-primary/40">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {FIELDS.map((f) => (
              <div key={f.key} className="border border-primary/15 bg-black/40 p-5">
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  {f.label}
                </label>
                {f.type === "textarea" ? (
                  <textarea
                    value={profile[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={3}
                    className="w-full resize-y bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                ) : (
                  <input
                    value={profile[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                )}
              </div>
            ))}

            <div className="flex justify-end pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="w-3.5 h-3.5" />
                ) : null}
                {saved ? "Saved" : "Save Profile"}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
