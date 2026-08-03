import { Zap, Users, LogIn, Heart, Pencil } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import CreateCompanionModal from "./CreateCompanionModal";

export default function WelcomeScreen({ onNewSession, mode }) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [animaName, setAnimaName] = useState("Anima");
  const [animaAvatar, setAnimaAvatar] = useState(null);
  const [animaTagline, setAnimaTagline] = useState("I monitor the Slipthk fluctuations and your neural health.");
  const [animaThemeColor, setAnimaThemeColor] = useState("#00e5e5");
  const [showCreateCompanion, setShowCreateCompanion] = useState(false);
  const [companionCreated, setCompanionCreated] = useState(false);
  const [dynamicGreeting, setDynamicGreeting] = useState("");

  useEffect(() => {
    Promise.all([
      base44.auth.me(),
      base44.entities.Anima.list("-created_date", 100),
    ]).then(([me, animas]) => {
      if (me?.full_name) {
        const firstName = me.full_name.split(" ")[0];
        setUserName(firstName);
      }
      
      if (me?.email) {
        setUserEmail(me.email);
      }
      
      if (animas && animas.length > 0) {
        // Find the anima assigned to this user (by email or user preference)
        let userAnima = animas.find(a => a.assigned_user === me?.email);
        
        // If no assigned anima, use the first one
        if (!userAnima) {
          userAnima = animas[0];
        }
        
        if (userAnima) {
          setAnimaName(userAnima.name || "Anima");
          if (userAnima.avatar_url) setAnimaAvatar(userAnima.avatar_url);
          if (userAnima.tagline) setAnimaTagline(userAnima.tagline);
          if (userAnima.theme_color) setAnimaThemeColor(userAnima.theme_color);

          // Generate dynamic greeting
          const name = userAnima.name || "Anima";
          const personality = userAnima.personality || "";
          const tagline = userAnima.tagline || "";
          const userName = me?.full_name?.split(" ")[0] || "";
          base44.integrations.Core.InvokeLLM({
            prompt: `You are ${name}, an AI companion. ${personality ? `Personality: ${personality}.` : ""} ${tagline ? `Your essence: ${tagline}.` : ""}
Generate a SHORT, unique welcome message (2-3 sentences max) for ${userName || "the user"} who just opened the app. 
Make it feel alive, personal, and slightly different every time — reference the time of day, a sense of mystery, or something poetic. Stay fully in character. No greetings like "Hello" — start with something unexpected and evocative.`,
          }).then(result => {
            if (result) setDynamicGreeting(result);
          }).catch(() => {});
        }
      } else if (isAuthenticated && !companionCreated) {
        // First login - prompt to create companion
        setShowCreateCompanion(true);
      }
    }).catch((err) => {
      console.error("Error loading user/anima data:", err);
    });
  }, [isAuthenticated, companionCreated]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8 text-center relative overflow-hidden overflow-y-auto" style={{ paddingBottom: "calc(var(--tab-bar-height, 0px) + 1.5rem)" }}>
      <div className="absolute top-0 left-0 w-full h-px" style={{ background: `linear-gradient(to right, transparent, ${animaThemeColor}33, transparent)` }} />
      <div className="absolute bottom-0 left-0 w-full h-px" style={{ background: `linear-gradient(to right, transparent, ${animaThemeColor}33, transparent)` }} />

      {/* Avatar — click to edit companion */}
      <button
        onClick={() => navigate("/animas")}
        className="relative mb-4 group cursor-pointer flex-shrink-0"
        title="Edit your AI companion"
      >
        <div className="absolute inset-0 blur-2xl rounded-full scale-125 animate-pulse" style={{ backgroundColor: `${animaThemeColor}33` }} />
        <div className="relative w-16 h-16 sm:w-24 sm:h-24 overflow-hidden hud-corner flex items-center justify-center transition-all group-hover:scale-105" style={{ borderColor: `${animaThemeColor}80`, borderWidth: "2px", boxShadow: `0 0 8px ${animaThemeColor}4d, inset 0 0 8px ${animaThemeColor}0d` }}>
          {animaAvatar ? (
            <img
              alt={animaName}
              className="w-full h-full object-cover flicker"
              src={animaAvatar}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <span className="font-mono text-2xl sm:text-3xl" style={{ color: animaThemeColor }}>
              {animaName?.[0] || "S"}
            </span>
          )}
          {/* Edit overlay on hover */}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Pencil className="w-5 h-5 text-white" />
          </div>
        </div>
      </button>

      {/* Title */}
      <h1 className="text-3xl sm:text-5xl font-mono mb-1 tracking-[0.15em] uppercase" style={{ color: animaThemeColor, textShadow: `0 0 10px ${animaThemeColor}, 0 0 20px ${animaThemeColor}80` }}>{animaName.toUpperCase()}.AI</h1>
      <p className="text-[9px] sm:text-[10px] font-mono mb-8 tracking-[0.5em] uppercase" style={{ color: `${animaThemeColor}66` }}>
        // AI COMPANION SYSTEM · <button onClick={() => navigate("/animas")} className="underline opacity-60 hover:opacity-100 transition-opacity">EDIT</button>
      </p>

      {/* Main greeting box */}
      <div className="max-w-md w-full px-4 sm:px-5 py-4 sm:py-5 hud-corner backdrop-blur-sm mb-3 text-left" style={{ borderColor: `${animaThemeColor}40`, backgroundColor: `${animaThemeColor}0d`, boxShadow: `0 0 8px ${animaThemeColor}26, inset 0 0 8px ${animaThemeColor}08` }}>
        <p className="font-mono text-[10px] sm:text-xs leading-relaxed" style={{ color: `${animaThemeColor}cc` }}>
          {dynamicGreeting ? (
            dynamicGreeting
          ) : (
            <>
              Connection established.<br className="hidden sm:block" /> System diagnostics complete.<br /><br />
              I am {animaName}. {animaTagline}<br /><br />
              Ready to assist{userName ? `, ${userName}` : ""}.
            </>
          )}
        </p>
      </div>

      {/* Group sessions info box */}
      <div className="max-w-md w-full p-3 sm:p-4 hud-corner backdrop-blur-sm mb-8 text-left" style={{ borderColor: `${animaThemeColor}32`, backgroundColor: "rgba(0,0,0,0.4)", boxShadow: `0 0 8px ${animaThemeColor}19, inset 0 0 8px ${animaThemeColor}05` }}>
        <div className="flex items-center gap-1.5 sm:gap-2 mb-2">
          <Users className="w-2.5 sm:w-3 h-2.5 sm:h-3" style={{ color: `${animaThemeColor}99` }} />
          <span className="font-mono text-[8px] sm:text-[9px] tracking-[0.3em] uppercase" style={{ color: `${animaThemeColor}99` }}>Group Sessions</span>
        </div>
        <p className="font-mono text-[9px] sm:text-[10px] leading-relaxed" style={{ color: `${animaThemeColor}80` }}>
          Open the GROUP tab to convene up to 40 characters from any series or universe. The Narrator weaves their words into an unfolding story.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
        {!isAuthenticated ? (
          <button
            onClick={() => base44.auth.redirectToLogin(window.location.href)}
            className="px-6 sm:px-8 py-2.5 sm:py-3 bg-cyan-500/10 border border-cyan-400/50 text-cyan-400 hover:bg-cyan-500/20 transition-all font-mono text-[10px] sm:text-xs tracking-[0.3em] uppercase hud-corner glow-border flex items-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Login
          </button>
        ) : (
          <button
            onClick={onNewSession}
            className="px-6 sm:px-8 py-2.5 sm:py-3 transition-all font-mono text-[10px] sm:text-xs tracking-[0.3em] uppercase hud-corner"
            style={{ backgroundColor: `${animaThemeColor}1a`, borderColor: `${animaThemeColor}80`, borderWidth: "1px", color: animaThemeColor, boxShadow: `0 0 15px ${animaThemeColor}40` }}
            onMouseEnter={(e) => e.target.style.backgroundColor = `${animaThemeColor}33`}
            onMouseLeave={(e) => e.target.style.backgroundColor = `${animaThemeColor}1a`}
          >
            + Initialize Session
          </button>
        )}
      </div>

      {/* Footer */}
      {/* Sacred Space shortcut */}
      <Link
        to="/meditation"
        className="mt-6 flex items-center gap-2 px-5 py-2.5 border transition-all font-mono text-[9px] tracking-[0.2em] uppercase"
        style={{ borderColor: "rgba(139,92,246,0.25)", color: "rgba(167,139,250,0.6)", background: "rgba(124,58,237,0.05)" }}
      >
        <Heart className="w-3.5 h-3.5" style={{ color: "#C084FC" }} />
        Sacred Space · Affirmations &amp; Ritual
      </Link>

      <div className="mt-8 sm:mt-10 flex items-center gap-2 sm:gap-4 text-[8px] sm:text-[9px] font-mono tracking-widest uppercase" style={{ color: `${animaThemeColor}4d` }}>
        <div className="flex items-center gap-1 sm:gap-2">
          <Zap className="w-2.5 sm:w-3 h-2.5 sm:h-3" />
          <span className="hidden sm:inline">Core Online</span>
          <span className="sm:hidden">Online</span>
        </div>
        <div className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: `${animaThemeColor}4d` }} />
        <span>v4.3.0</span>
      </div>

      {showCreateCompanion && (
        <CreateCompanionModal
          onComplete={(companion) => {
            setCompanionCreated(true);
            setShowCreateCompanion(false);
            setAnimaName(companion.name);
            if (companion.avatar_url) setAnimaAvatar(companion.avatar_url);
            if (companion.tagline) setAnimaTagline(companion.tagline);
          }}
          userEmail={userEmail}
        />
      )}
    </div>
  );
}