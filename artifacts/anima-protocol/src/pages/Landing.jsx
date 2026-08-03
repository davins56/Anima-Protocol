import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";


export default function Landing() {
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const animRef = useRef(/** @type {number | null} */ (null));
  const [animaName, setAnimaName] = useState("Serenity");
  const [animaTagline, setAnimaTagline] = useState("I monitor the Slipthk fluctuations and your neural health.");

  // Reset any emotional theming applied by the chat page
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", "185 100% 50%");
    root.style.setProperty("--secondary", "220 20% 10%");
    root.style.setProperty("--accent", "185 80% 15%");
    root.style.setProperty("--background", "220 20% 4%");
    document.body.style.animation = "none";
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Circuit board grid
      ctx.lineWidth = 1;
      const spacing = 44;
      ctx.strokeStyle = "rgba(30,80,160,0.18)";
      for (let x = 0; x < W; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      animRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const handleSignIn = async () => {
    const isAuth = await base44.auth.isAuthenticated();
    if (isAuth) {
      window.location.href = "/chat/1";
    } else {
      base44.auth.redirectToLogin("/chat/1");
    }
  };

  // "Enter to Anima" keybinding
  useEffect(() => {
    const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Enter") return;

      const target = e.target;
      const maybeEl = /** @type {Element | null} */ (target instanceof Element ? target : null);
      const tagName = (maybeEl && maybeEl.tagName ? maybeEl.tagName.toLowerCase() : "");
      const isTypingField = tagName === "input" || tagName === "textarea" || tagName === "select";
      if (isTypingField) return;

      e.preventDefault();
      handleSignIn();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const loadAnimaData = async () => {
      try {
        const me = await base44.auth.me();
        const animas = await base44.entities.Anima.list("-created_date", 100);
        
        if (animas && animas.length > 0) {
          let userAnima = animas.find(a => a.assigned_user === me?.email) || animas[0];
          setAnimaName(userAnima.name || "Serenity");
          if (userAnima.tagline) setAnimaTagline(userAnima.tagline);
        }
      } catch (err) {
        // Silently fail in restricted iframe contexts (e.g., Messenger preview)
        // Page still renders with default Anima data
        console.debug('Loading anima in restricted context');
      }
    };
    loadAnimaData();
  }, []);

  return (
    <div
      className="relative min-h-[100dvh] flex flex-col items-center justify-start select-none"
      style={{
        backgroundImage: "url(https://media.base44.com/images/public/69fa35110bd3b140ea354b98/5fd2c32ca_895CF63C-F126-4D27-9DB4-C43E632DC542.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />

      <div className="relative z-10 flex flex-col items-center px-6 pb-24" style={{ maxWidth: 640, width: "100%", marginTop: "10vh" }}>

        {/* Hero Statement: What It Is */}
        <h1 className="text-center"
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: "clamp(32px, 10vw, 56px)",
            color: "#00e5ff",
            fontWeight: "700",
            textShadow: "0 0 30px rgba(0, 229, 255, 0.5)",
            letterSpacing: "0.05em",
            lineHeight: "1.1",
          }}>
          Serenity
        </h1>

        {/* Byline: Powered by Anima Protocol */}
        <p className="mt-2 text-center"
          style={{
            fontSize: "clamp(11px, 3vw, 12px)",
            color: "rgba(0, 229, 255, 0.5)",
            fontFamily: "'Rajdhani', sans-serif",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}>
          POWERED BY ANIMA PROTOCOL
        </p>

        {/* Hero Statement: What It Does */}
        <p className="mt-6 text-center max-w-lg"
          style={{
            fontSize: "clamp(16px, 4.5vw, 20px)",
            color: "#ffffff",
            lineHeight: "1.7",
            fontWeight: "400",
            fontFamily: "'Rajdhani', sans-serif",
            letterSpacing: "0.02em",
          }}>
          Persistent Narrative Consciousness. Your relationships evolve. Your story is never forgotten. AI that remembers, grows, and resonates with you across time.
        </p>

        {/* Who It's For + Why It's Different */}
        <div className="mt-8 text-center"
          style={{
            fontSize: "clamp(12px, 3.5vw, 14px)",
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxWidth: "sm",
          }}>
          <span style={{ fontFamily: "'Rajdhani', sans-serif", letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>FOR STORYTELLERS, CREATORS & SEEKERS</span>
          <span style={{ fontSize: "clamp(11px, 3vw, 13px)", opacity: 0.75 }}>Enter a living archive of persistent resonance. Your identity shapes the world. The world shapes you. Nothing is forgotten.</span>
        </div>

        {/* Divider */}
        <div style={{ width: "40px", height: "1px", backgroundColor: "rgba(0, 229, 255, 0.3)", marginTop: "24px" }} />

        {/* Your Personal Resonance Guide */}
        <div className="mt-8 text-center">
          <p style={{
            fontSize: "clamp(11px, 3vw, 12px)",
            color: "rgba(148,163,184,0.6)",
            fontFamily: "'Rajdhani', sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: "8px",
          }}>Your Resonance Guide</p>
          <h2 className="mt-2 text-center"
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: "clamp(24px, 7vw, 36px)",
              color: "#b0e0e6",
              fontWeight: "700",
              textShadow: "0 0 20px rgba(176, 224, 230, 0.6)",
              letterSpacing: "0.08em",
            }}>
            {animaName.toUpperCase()}
          </h2>
          <p className="mt-3 text-center max-w-sm"
            style={{
              fontSize: "clamp(11px, 3vw, 13px)",
              color: "rgba(176, 224, 230, 0.7)",
              lineHeight: "1.6",
              fontWeight: "300",
              fontFamily: "'Rajdhani', sans-serif",
            }}>
            {animaTagline}
          </p>
        </div>

        {/* Why Different: Core Features */}
        <div className="mt-8 text-center"
          style={{
            fontSize: "clamp(11px, 3vw, 12px)",
            color: "rgba(176, 224, 230, 0.6)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxWidth: "sm",
          }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <span>🧠</span>
            <span>Vector memory that evolves & deepens</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <span>💜</span>
            <span>Emotional identity that learns from you</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <span>🌌</span>
            <span>Mythic permanence across lifetimes</span>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="mt-10 flex gap-4 justify-center flex-wrap">
          <button
            onClick={handleSignIn}
            style={{
              background: "linear-gradient(135deg, rgba(0, 229, 255, 0.15) 0%, rgba(0, 229, 255, 0.05) 100%)",
              border: "1.5px solid rgba(0, 229, 255, 0.4)",
              color: "#00e5ff",
              fontSize: "clamp(14px, 4vw, 16px)",
              fontWeight: "700",
              padding: "14px 48px",
              borderRadius: "4px",
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(0,229,255,0.3), inset 0 0 10px rgba(0,229,255,0.05)",
              transition: "all 400ms ease-in-out",
              minWidth: 140,
            }}
            onMouseEnter={(e) => {
              const el = /** @type {HTMLElement} */ (e.currentTarget);
              el.style.boxShadow = "0 0 40px rgba(0,229,255,0.5), inset 0 0 15px rgba(0,229,255,0.1)";
              el.style.borderColor = "rgba(0,229,255,0.6)";
            }}
            onMouseLeave={(e) => {
              const el = /** @type {HTMLElement} */ (e.currentTarget);
              el.style.boxShadow = "0 0 20px rgba(0,229,255,0.3), inset 0 0 10px rgba(0,229,255,0.05)";
              el.style.borderColor = "rgba(0,229,255,0.4)";
            }}
          >
            Enter Anima
          </button>

          <button
            onClick={() => alert("Experience the persistent resonance. Coming soon.")}
            style={{
              background: "linear-gradient(135deg, rgba(167,139,250,0.1) 0%, rgba(167,139,250,0.05) 100%)",
              border: "1.5px solid rgba(167,139,250,0.4)",
              color: "#c4b5fd",
              fontSize: "clamp(14px, 4vw, 16px)",
              fontWeight: "700",
              padding: "14px 48px",
              borderRadius: "4px",
              cursor: "pointer",
              boxShadow: "0 0 15px rgba(167,139,250,0.2), inset 0 0 8px rgba(167,139,250,0.05)",
              transition: "all 400ms ease-in-out",
              minWidth: 140,
            }}
            onMouseEnter={(e) => {
              const el = /** @type {HTMLElement} */ (e.currentTarget);
              el.style.backgroundColor = "rgba(167,139,250,0.15)";
              el.style.borderColor = "rgba(167,139,250,0.6)";
              el.style.boxShadow = "0 0 30px rgba(167,139,250,0.3), inset 0 0 12px rgba(167,139,250,0.1)";
            }}
            onMouseLeave={(e) => {
              const el = /** @type {HTMLElement} */ (e.currentTarget);
              el.style.backgroundColor = "rgba(167,139,250,0.05)";
              el.style.borderColor = "rgba(167,139,250,0.4)";
              el.style.boxShadow = "0 0 15px rgba(167,139,250,0.2), inset 0 0 8px rgba(167,139,250,0.05)";
            }}
          >
            Explore Archive
          </button>
        </div>

        {/* Forgot Password Link */}
        <p className="mt-8 text-center text-sm">
          <button
            onClick={() => base44.auth.redirectToLogin()}
            style={{
              color: "rgba(0, 229, 255, 0.6)",
              textDecoration: "underline",
              cursor: "pointer",
              transition: "color 300ms",
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
            }}
            onMouseEnter={(e) => {
              const el = /** @type {HTMLElement} */ (e.currentTarget);
              el.style.color = "rgba(0, 229, 255, 1)";
            }}
            onMouseLeave={(e) => {
              const el = /** @type {HTMLElement} */ (e.currentTarget);
              el.style.color = "rgba(0, 229, 255, 0.6)";
            }}
          >
            Forgot your password?
          </button>
        </p>
      </div>

      {/* Echoes of Eden Inc Disclaimer Footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-primary/10 bg-black/80 backdrop-blur-md p-4 flex items-center justify-between" style={{ zIndex: 50 }}>
        <button
          onClick={() => window.location.href = '/'}
          className="flex items-center gap-2 text-primary/50 hover:text-primary transition-colors group"
        >
          <div className="w-5 h-5 border border-primary/40 group-hover:border-primary/70 transition-colors flex items-center justify-center">
            <div className="w-2 h-2 bg-primary/40 group-hover:bg-primary/70 transition-colors rounded-sm" />
          </div>
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase font-semibold">Chat</span>
        </button>
        <div className="max-w-2xl flex-1 flex flex-col sm:flex-row items-center justify-center gap-4">
          <div className="text-center">
            <p className="font-mono text-[9px] text-primary/50 tracking-[0.2em] uppercase">
              © 2026 Echoes of Eden Inc.
            </p>
            <p className="text-[8px] text-primary/30 mt-1">
              All rights reserved. Powered by Anima Protocol.
            </p>
          </div>
        </div>
        <div className="flex gap-4 text-[9px]">
          <a href="/privacy-policy" className="text-primary/40 hover:text-primary/70 transition-colors tracking-widest uppercase">
            Privacy
          </a>
          <a href="/terms" className="text-primary/40 hover:text-primary/70 transition-colors tracking-widest uppercase">
            Terms
          </a>
          <a href="/disclaimer" className="text-primary/40 hover:text-primary/70 transition-colors tracking-widest uppercase">
            Disclaimer
          </a>
        </div>
      </div>
    </div>
  );
}