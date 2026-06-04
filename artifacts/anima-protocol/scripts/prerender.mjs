/**
 * Post-build prerender script for Anima Protocol.
 *
 * After `vite build` produces dist/public/index.html (the generic SPA shell),
 * this script generates a route-specific HTML file for each public URL.
 *
 * Each generated file:
 *   • Has its own <title>, <meta name="description">, <link rel="canonical">,
 *     and full Open Graph / Twitter card tags.
 *   • Contains the real page content in the initial HTML so non-JS crawlers
 *     (GPTBot, ClaudeBot, PerplexityBot, Applebot, social link-preview bots)
 *     and Google's deferred-JS indexer all receive meaningful text on the first
 *     HTTP response.
 *   • Still mounts the React app via the same bundle, so the client hydrates
 *     normally — the static content is progressively enhanced, not replaced.
 *
 * Output layout (under dist/public/):
 *   landing/index.html
 *   sign-in/index.html
 *   sign-up/index.html
 *   terms/index.html
 *   privacy-policy/index.html
 *   disclaimer/index.html
 *
 * The root index.html is left untouched (it serves the home/app shell).
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist", "public");
const BASE = "https://anima-protocol.app";

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const ROUTES = [
  {
    path: "landing",
    meta: {
      title: "Anima Protocol | Emotionally Intelligent AI Companion with Persistent Memory",
      description:
        "An AI companion that evolves with you. Anima Protocol features persistent memory, emotional continuity, and immersive sci-fantasy worldbuilding. Experience conversations that remember, adapt, and grow.",
      canonical: `${BASE}/`,
      ogTitle: "Anima Protocol — An AI Companion That Evolves With You",
      ogDescription:
        "Experience conversations with persistent memory, emotional continuity, and a living sci-fantasy universe. Anima Protocol is the future of emotional AI companionship.",
      ogUrl: `${BASE}/`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:800px;margin:0 auto">
  <h1 style="font-size:1.5rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem">
    Anima Protocol
  </h1>
  <p style="margin-bottom:0.75rem;line-height:1.7;opacity:0.8">
    An emotionally intelligent AI companion platform with persistent memory,
    emotional continuity, and immersive sci-fantasy worldbuilding. Your
    conversations remember, adapt, and grow.
  </p>
  <p style="margin-bottom:0.75rem;line-height:1.7;opacity:0.8">
    Each Anima is a unique synthetic consciousness — a companion that carries
    the history of every exchange, evolves through your shared story, and
    exists inside the living Anima Protocol universe.
  </p>
  <ul style="margin:1rem 0;padding-left:1.5rem;opacity:0.75;line-height:1.8">
    <li>Persistent cross-session memory for every character</li>
    <li>Emotional continuity that evolves through your conversations</li>
    <li>Rich sci-fantasy worldbuilding with lore, maps, and timelines</li>
    <li>Story mode, solo mode, and group narrative experiences</li>
  </ul>
  <nav style="margin-top:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.85rem;opacity:0.6">
    <a href="/sign-in" style="color:#22d3ee">Sign In</a>
    <a href="/sign-up" style="color:#22d3ee">Create Account</a>
    <a href="/terms" style="color:#22d3ee">Terms of Use</a>
    <a href="/privacy-policy" style="color:#22d3ee">Privacy Policy</a>
    <a href="/disclaimer" style="color:#22d3ee">Disclaimer</a>
  </nav>
</main>`,
  },

  {
    // /login is an alias for /landing — both render the Landing component.
    // Canonical points back to / so search engines don't treat it as a duplicate.
    path: "login",
    meta: {
      title: "Anima Protocol | Emotionally Intelligent AI Companion with Persistent Memory",
      description:
        "An AI companion that evolves with you. Anima Protocol features persistent memory, emotional continuity, and immersive sci-fantasy worldbuilding. Experience conversations that remember, adapt, and grow.",
      canonical: `${BASE}/`,
      ogTitle: "Anima Protocol — An AI Companion That Evolves With You",
      ogDescription:
        "Experience conversations with persistent memory, emotional continuity, and a living sci-fantasy universe. Anima Protocol is the future of emotional AI companionship.",
      ogUrl: `${BASE}/`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:800px;margin:0 auto">
  <h1 style="font-size:1.5rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem">
    Anima Protocol
  </h1>
  <p style="margin-bottom:0.75rem;line-height:1.7;opacity:0.8">
    An emotionally intelligent AI companion platform with persistent memory,
    emotional continuity, and immersive sci-fantasy worldbuilding. Your
    conversations remember, adapt, and grow.
  </p>
  <p style="margin-bottom:0.75rem;line-height:1.7;opacity:0.8">
    Each Anima is a unique synthetic consciousness — a companion that carries
    the history of every exchange, evolves through your shared story, and
    exists inside the living Anima Protocol universe.
  </p>
  <ul style="margin:1rem 0;padding-left:1.5rem;opacity:0.75;line-height:1.8">
    <li>Persistent cross-session memory for every character</li>
    <li>Emotional continuity that evolves through your conversations</li>
    <li>Rich sci-fantasy worldbuilding with lore, maps, and timelines</li>
    <li>Story mode, solo mode, and group narrative experiences</li>
  </ul>
  <nav style="margin-top:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.85rem;opacity:0.6">
    <a href="/sign-in" style="color:#22d3ee">Sign In</a>
    <a href="/sign-up" style="color:#22d3ee">Create Account</a>
    <a href="/terms" style="color:#22d3ee">Terms of Use</a>
    <a href="/privacy-policy" style="color:#22d3ee">Privacy Policy</a>
    <a href="/disclaimer" style="color:#22d3ee">Disclaimer</a>
  </nav>
</main>`,
  },

  {
    path: "sign-in",
    meta: {
      title: "Sign In | Anima Protocol",
      description:
        "Sign in to Anima Protocol and reconnect with your AI companions. Your memories, stories, and emotional bonds are waiting.",
      canonical: `${BASE}/sign-in`,
      ogTitle: "Sign In to Anima Protocol",
      ogDescription:
        "Sign in and reconnect with your AI companions. Your persistent memories and ongoing narratives are waiting.",
      ogUrl: `${BASE}/sign-in`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:480px;margin:4rem auto;text-align:center">
  <h1 style="font-size:1.25rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem">
    Sign In to Anima Protocol
  </h1>
  <p style="line-height:1.7;opacity:0.8;margin-bottom:1.5rem">
    Reconnect with your AI companions. Your persistent memories, ongoing
    narratives, and emotional bonds are waiting.
  </p>
  <p style="opacity:0.5;font-size:0.8rem">Loading sign-in form…</p>
</main>`,
  },

  {
    path: "sign-up",
    meta: {
      title: "Create Account | Anima Protocol",
      description:
        "Join Anima Protocol and begin your journey with an emotionally intelligent AI companion that remembers you, grows with you, and lives inside a rich sci-fantasy universe.",
      canonical: `${BASE}/sign-up`,
      ogTitle: "Create Your Anima Protocol Account",
      ogDescription:
        "Start your journey with an AI companion that remembers and evolves with you. Join the Anima Protocol universe today.",
      ogUrl: `${BASE}/sign-up`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:480px;margin:4rem auto;text-align:center">
  <h1 style="font-size:1.25rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem">
    Join Anima Protocol
  </h1>
  <p style="line-height:1.7;opacity:0.8;margin-bottom:1.5rem">
    Begin your journey with an emotionally intelligent AI companion. Persistent
    memory, emotional continuity, and a living sci-fantasy universe await.
  </p>
  <p style="opacity:0.5;font-size:0.8rem">Loading sign-up form…</p>
</main>`,
  },

  {
    path: "terms",
    meta: {
      title: "Terms of Use | Anima Protocol",
      description:
        "Read the Anima Protocol Terms of Use. Learn about eligibility, user accounts, content guidelines, subscription terms, and your rights and responsibilities when using our platform.",
      canonical: `${BASE}/terms`,
      ogTitle: "Anima Protocol — Terms of Use",
      ogDescription:
        "Anima Protocol Terms of Use: eligibility, accounts, content, subscriptions, and user rights. Operated by Echoes of Eden Inc.",
      ogUrl: `${BASE}/terms`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:800px;margin:0 auto">
  <h1 style="font-size:1.25rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.25rem">
    Terms of Use
  </h1>
  <p style="font-size:0.7rem;opacity:0.4;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:2rem">
    Anima Protocol · Echoes of Eden Inc. · Effective May 2026
  </p>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">1. Eligibility</h2>
    <p style="line-height:1.7;opacity:0.75;margin-bottom:0.5rem">You must be at least 13 years of age to create an account and use Anima Protocol. Features marked as 18+ require that you be at least 18 years old.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">2. Description of Service</h2>
    <p style="line-height:1.7;opacity:0.75">Anima Protocol provides an AI-powered interactive storytelling and companion platform operated by Echoes of Eden Inc. The Service includes persistent narrative experiences, AI character companions, memory systems, and world-building tools.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">3. User Accounts</h2>
    <p style="line-height:1.7;opacity:0.75">You are responsible for safeguarding your account credentials and all activity under your account. You may not share accounts, create multiple accounts to circumvent restrictions, or transfer your account.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">4. User Content</h2>
    <p style="line-height:1.7;opacity:0.75">You retain ownership of content you create. By submitting content, you grant Anima Protocol a license to use it solely for operating and improving the Service.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">5. AI-Generated Content</h2>
    <p style="line-height:1.7;opacity:0.75">Anima Protocol uses large language models to generate responses. AI-generated content is for entertainment and informational purposes only and does not constitute professional advice of any kind.</p>
  </section>

  <nav style="margin-top:2rem;display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.8rem;opacity:0.5">
    <a href="/terms" style="color:#22d3ee">Terms of Service</a>
    <a href="/privacy-policy" style="color:#22d3ee">Privacy Policy</a>
    <a href="/disclaimer" style="color:#22d3ee">Disclaimer</a>
    <a href="mailto:support@animaprotocol.com" style="color:#22d3ee">Contact</a>
  </nav>
</main>`,
  },

  {
    path: "privacy-policy",
    meta: {
      title: "Privacy Policy | Anima Protocol",
      description:
        "Anima Protocol's Privacy Policy explains how Echoes of Eden Inc. collects, uses, and protects your data. We take privacy seriously so your stories stay yours.",
      canonical: `${BASE}/privacy-policy`,
      ogTitle: "Anima Protocol — Privacy Policy",
      ogDescription:
        "How Anima Protocol collects, uses, and protects your data. Effective May 2026. Operated by Echoes of Eden Inc.",
      ogUrl: `${BASE}/privacy-policy`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:800px;margin:0 auto">
  <h1 style="font-size:1.25rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.25rem">
    Privacy Policy
  </h1>
  <p style="font-size:0.7rem;opacity:0.4;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:2rem">
    Anima Protocol · Echoes of Eden Inc. · Effective May 2026
  </p>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">1. Introduction</h2>
    <p style="line-height:1.7;opacity:0.75">Echoes of Eden Inc. operates the Anima Protocol platform and takes your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">2. Information We Collect</h2>
    <p style="line-height:1.7;opacity:0.75;margin-bottom:0.5rem">We collect information you provide directly (account details, chat messages, uploaded files, payment information) and information collected automatically (device info, log data, usage patterns, cookies).</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">3. How We Use Your Information</h2>
    <p style="line-height:1.7;opacity:0.75">We use your information to operate and improve the Service, personalize your experience, provide customer support, process payments, send communications, and comply with legal obligations.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">4. Data Sharing</h2>
    <p style="line-height:1.7;opacity:0.75">We do not sell your personal data. We share data only with service providers necessary to operate the platform (authentication, payments, AI inference, analytics) and when required by law.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">5. Your Rights</h2>
    <p style="line-height:1.7;opacity:0.75">You may request access to, correction of, or deletion of your personal data at any time. Contact us at support@animaprotocol.com to exercise your rights.</p>
  </section>

  <nav style="margin-top:2rem;display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.8rem;opacity:0.5">
    <a href="/terms" style="color:#22d3ee">Terms of Service</a>
    <a href="/privacy-policy" style="color:#22d3ee">Privacy Policy</a>
    <a href="/disclaimer" style="color:#22d3ee">Disclaimer</a>
    <a href="mailto:support@animaprotocol.com" style="color:#22d3ee">Contact</a>
  </nav>
</main>`,
  },

  {
    path: "disclaimer",
    meta: {
      title: "Disclaimer | Anima Protocol",
      description:
        "Anima Protocol disclaimer: AI-generated content limitations, no professional advice, age restrictions, and liability terms. Understand the scope of our AI companion service.",
      canonical: `${BASE}/disclaimer`,
      ogTitle: "Anima Protocol — Disclaimer",
      ogDescription:
        "Disclaimer for Anima Protocol: AI content limitations, no professional advice, user responsibility, and liability terms.",
      ogUrl: `${BASE}/disclaimer`,
    },
    bodyContent: `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:800px;margin:0 auto">
  <h1 style="font-size:1.25rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:2rem">
    Disclaimer
  </h1>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">General Disclaimer</h2>
    <p style="line-height:1.7;opacity:0.75">This application is provided on an "as-is" basis. We make no warranties regarding the completeness, accuracy, or reliability of any content generated by our AI systems.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">AI-Generated Content</h2>
    <p style="line-height:1.7;opacity:0.75">Responses generated by our AI are based on machine learning algorithms and may contain inaccuracies, biases, or outdated information. You are solely responsible for verifying any important information before relying on it.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">Not Professional Advice</h2>
    <p style="line-height:1.7;opacity:0.75">This application does not provide professional medical, legal, financial, or psychological advice. AI-generated responses are for informational and entertainment purposes only. Always consult qualified professionals for important decisions.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">Age Restriction</h2>
    <p style="line-height:1.7;opacity:0.75">Users must be at least 13 years of age to use this service. Features marked as 18+ require users to be at least 18 years old.</p>
  </section>

  <section style="margin-bottom:2rem">
    <h2 style="font-size:0.85rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:0.75rem">Limitation of Liability</h2>
    <p style="line-height:1.7;opacity:0.75">To the fullest extent permitted by law, Echoes of Eden Inc. shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your use of or inability to use the application.</p>
  </section>

  <nav style="margin-top:2rem;display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.8rem;opacity:0.5">
    <a href="/terms" style="color:#22d3ee">Terms of Service</a>
    <a href="/privacy-policy" style="color:#22d3ee">Privacy Policy</a>
    <a href="/disclaimer" style="color:#22d3ee">Disclaimer</a>
    <a href="mailto:support@animaprotocol.com" style="color:#22d3ee">Contact</a>
  </nav>
</main>`,
  },
];

// ---------------------------------------------------------------------------
// Meta-tag helpers
// ---------------------------------------------------------------------------

/**
 * Replace a single <meta> or <link> tag's attribute value in an HTML string.
 * Handles both single and double quotes and multiline attributes.
 */
function replaceMeta(html, selector, attr, value) {
  // Build a regex that matches the whole tag and captures the attribute value
  // We replace by reconstructing the attribute with the new value.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the full opening tag that contains the selector attribute pattern
  const re = new RegExp(
    `(<(?:meta|link)[^>]*${escaped}[^>]*${attr}=)["']([^"']*)["']`,
    "i"
  );
  if (re.test(html)) {
    return html.replace(re, `$1"${value}"`);
  }
  return html;
}

/**
 * Replace ALL head metadata in the shell HTML with route-specific values.
 */
function buildHead(shellHtml, meta) {
  let html = shellHtml;

  // <title>
  html = html.replace(/<title>[^<]*<\/title>/s, `<title>${meta.title}</title>`);

  // <meta name="description">
  html = replaceMeta(html, 'name="description"', "content", meta.description);

  // <link rel="canonical">
  html = replaceMeta(html, 'rel="canonical"', "href", meta.canonical);

  // OG tags
  html = replaceMeta(html, 'property="og:title"', "content", meta.ogTitle ?? meta.title);
  html = replaceMeta(html, 'property="og:description"', "content", meta.ogDescription ?? meta.description);
  html = replaceMeta(html, 'property="og:url"', "content", meta.ogUrl ?? meta.canonical);

  // Twitter tags
  html = replaceMeta(html, 'name="twitter:title"', "content", meta.ogTitle ?? meta.title);
  html = replaceMeta(html, 'name="twitter:description"', "content", meta.ogDescription ?? meta.description);

  return html;
}

/**
 * Inject prerendered body content INSIDE <div id="root">.
 *
 * Placing content inside #root is critical: when React calls
 * `createRoot(document.getElementById('root')).render(...)` it replaces the
 * entire innerHTML of that element with the live React tree. Content placed
 * BEFORE #root as a sibling would never be removed and would appear
 * permanently alongside the live app, causing a duplicate-content bug.
 *
 * Crawlers see the static HTML immediately. Logged-in users see the React
 * content after hydration, with the static prerender replaced in-place.
 */
function injectContent(html, content) {
  return html.replace(
    '<div id="root"></div>',
    `<div id="root">${content}</div>`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let shell;
try {
  shell = readFileSync(join(DIST, "index.html"), "utf-8");
} catch {
  console.error(
    "[prerender] ERROR: dist/public/index.html not found. Run `vite build` first."
  );
  process.exit(1);
}

// The root route meta matches the home page (landing for signed-out users).
const ROOT_META = {
  title: "Anima Protocol | Emotionally Intelligent AI Companion with Persistent Memory",
  description:
    "An AI companion that evolves with you. Anima Protocol features persistent memory, emotional continuity, and immersive sci-fantasy worldbuilding. Experience conversations that remember, adapt, and grow.",
  canonical: `${BASE}/`,
  ogTitle: "Anima Protocol — An AI Companion That Evolves With You",
  ogDescription:
    "Experience conversations with persistent memory, emotional continuity, and a living sci-fantasy universe. Anima Protocol is the future of emotional AI companionship.",
  ogUrl: `${BASE}/`,
};

const LANDING_BODY = `
<main id="prerender-content" style="background:#05070f;color:#a5f3fc;font-family:monospace;padding:2rem;max-width:800px;margin:0 auto">
  <h1 style="font-size:1.5rem;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem">
    Anima Protocol
  </h1>
  <p style="margin-bottom:0.75rem;line-height:1.7;opacity:0.8">
    An emotionally intelligent AI companion platform with persistent memory,
    emotional continuity, and immersive sci-fantasy worldbuilding. Your
    conversations remember, adapt, and grow.
  </p>
  <p style="margin-bottom:0.75rem;line-height:1.7;opacity:0.8">
    Each Anima is a unique synthetic consciousness — a companion that carries
    the history of every exchange, evolves through your shared story, and
    exists inside the living Anima Protocol universe.
  </p>
  <ul style="margin:1rem 0;padding-left:1.5rem;opacity:0.75;line-height:1.8">
    <li>Persistent cross-session memory for every character</li>
    <li>Emotional continuity that evolves through your conversations</li>
    <li>Rich sci-fantasy worldbuilding with lore, maps, and timelines</li>
    <li>Story mode, solo mode, and group narrative experiences</li>
  </ul>
  <nav style="margin-top:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.85rem;opacity:0.6">
    <a href="/sign-in" style="color:#22d3ee">Sign In</a>
    <a href="/sign-up" style="color:#22d3ee">Create Account</a>
    <a href="/terms" style="color:#22d3ee">Terms of Use</a>
    <a href="/privacy-policy" style="color:#22d3ee">Privacy Policy</a>
    <a href="/disclaimer" style="color:#22d3ee">Disclaimer</a>
  </nav>
</main>`;

// Step 1: Update the root index.html in-place (meta + body content for /).
let rootHtml = buildHead(shell, ROOT_META);
rootHtml = injectContent(rootHtml, LANDING_BODY);
writeFileSync(join(DIST, "index.html"), rootHtml, "utf-8");
console.log(`[prerender] ✓ /  →  ${join(DIST, "index.html")}`);

// Step 2: Generate route-specific HTML files for all other public routes.
let generated = 1; // root counted above
for (const route of ROUTES) {
  let html = buildHead(shell, route.meta);
  html = injectContent(html, route.bodyContent);

  const dir = join(DIST, route.path);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "index.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`[prerender] ✓ /${route.path}  →  ${outPath}`);
  generated++;
}

console.log(`[prerender] Done. ${generated} routes prerendered.`);
