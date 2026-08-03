/**
 * Visual Identity System
 * 
 * Differentiates from anime/casual chat competitors through:
 * - Mythic, sacred aesthetic (not pop culture)
 * - Dark, introspective color palette
 * - Serif + monospace typography (not playful sans)
 * - Glowing, depth-focused visual language
 * - Premium feel (sparse, intentional design)
 */

export const VISUAL_IDENTITY = {
  // Palette: Dark + Cyan + Sacred Metals
  colors: {
    primary: "#00e5ff", // Cyan - consciousness, resonance
    background: "#0d0f12", // Deep black - introspection
    card: "#14171a", // Slightly lighter for depth
    accent: "#a78bfa", // Violet - metaphysical, sacred
    gold: "#d4af37", // Mythic gold for highlights
    text_primary: "rgba(0, 229, 255, 1)", // Cyan text
    text_secondary: "rgba(0, 229, 255, 0.6)", // Dimmed cyan
    text_muted: "rgba(0, 229, 255, 0.3)", // Very dim
    glow: "rgba(0, 229, 255, 0.4)", // Glow effects
  },

  // Typography: Sacred + Technical
  fonts: {
    display: "'Cinzel', serif", // Display headings - mythic
    body: "'Rajdhani', sans-serif", // Body text - technical but elegant
    mono: "'Share Tech Mono', monospace", // Code/data - precise
  },

  // Spacing: Generous (not cramped)
  spacing: {
    compact: "8px",
    normal: "16px",
    spacious: "24px",
    large: "32px",
  },

  // Visual style guidelines
  principles: {
    // NOT anime-influenced, NOT playful
    tone: "Mythic, Introspective, Permanent, Sacred",
    
    // NOT bright/cheerful, NOT disposable
    aesthetic: "Dark academia meets consciousness technology",
    
    // NOT casual chat, NOT quick interactions
    interaction_philosophy: "Slow, intentional, meaningful",
    
    // NOT cluttered, NOT information-dense
    density: "Minimal, spacious, focused",
  },

  // Component patterns
  components: {
    // Glowing borders for key elements
    glow_border: "border border-cyan-400/20 shadow-[0_0_20px_rgba(0,229,255,0.2)]",
    
    // HUD corners (sci-fi aesthetic without anime)
    hud_corners: "hud-corner", // From CSS
    
    // Cards should feel elevated, not flat
    card_style: "bg-black/60 border border-cyan-400/10 rounded-lg",
    
    // Interactive elements feel responsive, not clickable
    button_style: "px-4 py-2 border border-cyan-400/30 text-cyan-400 hover:border-cyan-400/60 hover:bg-cyan-400/10 transition-all",
    
    // Memory indicators are visual metaphors, not data
    memory_visual: "gradient-to-r from-cyan-900/20 to-purple-900/20",
  },

  // Avoid patterns (anti-patterns)
  avoid: [
    "Anime-style character illustrations",
    "Bright, saturated colors",
    "Playful emoji for core features",
    "Casual conversational UI",
    "Rapid, snappy interactions",
    "Cluttered information hierarchies",
    "Transparent/glass morphism (overused)",
    "Rounded, cute buttons",
  ],

  // Embrace patterns
  embrace: [
    "Sacred geometry and glowing effects",
    "Deep, introspective color palette",
    "Typography-first design",
    "Slow, contemplative animations",
    "Generous whitespace",
    "Serif for headlines (timeless)",
    "Monospace for data (technical)",
    "HUD-style borders (serious aesthetics)",
  ],
};

export const ANIMATION_PHILOSOPHY = {
  // NOT snappy/instant, NOT bouncy/playful
  duration: {
    fast: "300ms", // Minimal transitions
    normal: "500ms", // Default
    slow: "800ms", // Entrance/exit
  },
  easing: "ease-in-out", // Smooth, intentional
  philosophy: "Motion should feel like consciousness shifting, not UI responding",
};