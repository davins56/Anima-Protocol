// @ts-check
/**
 * Imperatively updates <title>, canonical, and all OG/Twitter meta tags for
 * the current route. Call from the top level of every public page component.
 *
 * This runs in the browser, so social-sharing bots that execute JavaScript
 * (Facebook, Twitter/X, LinkedIn, Slack) will see the correct tags after
 * hydration. The accompanying prerender script (scripts/prerender.mjs) bakes
 * the same values into the initial HTML so non-JS crawlers (GPTBot, ClaudeBot,
 * etc.) also receive route-specific metadata.
 */

import { useEffect } from "react";

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
  ogImage?: string;
  twitterTitle?: string;
  twitterDescription?: string;
}

function setMeta(selector: string, attr: string, value: string): void {
  let el = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
  if (!el) {
    if (selector.startsWith("link")) {
      el = document.createElement("link");
    } else {
      el = document.createElement("meta");
    }
    // Copy attributes from the selector to bootstrap the element
    const attrMatch = selector.match(/\[([^\]]+)="([^"]+)"\]/);
    if (attrMatch) {
      el.setAttribute(attrMatch[1], attrMatch[2]);
    }
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

export function applyPageMeta(meta: PageMeta): void {
  const ogTitle = meta.ogTitle ?? meta.title;
  const ogDesc = meta.ogDescription ?? meta.description;
  const ogUrl = meta.ogUrl ?? meta.canonical;
  const twitterTitle = meta.twitterTitle ?? ogTitle;
  const twitterDesc = meta.twitterDescription ?? ogDesc;
  const ogImage = meta.ogImage ?? "/icon-512.png";

  document.title = meta.title;

  setMeta('meta[name="description"]', "content", meta.description);
  setMeta('link[rel="canonical"]', "href", meta.canonical);

  setMeta('meta[property="og:title"]', "content", ogTitle);
  setMeta('meta[property="og:description"]', "content", ogDesc);
  setMeta('meta[property="og:url"]', "content", ogUrl);
  setMeta('meta[property="og:image"]', "content", ogImage);

  setMeta('meta[name="twitter:title"]', "content", twitterTitle);
  setMeta('meta[name="twitter:description"]', "content", twitterDesc);
}

export function usePageMeta(meta: PageMeta): void {
  useEffect(() => {
    applyPageMeta(meta);
  }, [
    meta.title,
    meta.description,
    meta.canonical,
    meta.ogTitle,
    meta.ogDescription,
    meta.ogUrl,
    meta.ogImage,
    meta.twitterTitle,
    meta.twitterDescription,
  ]);
}

/** Canonical base URL (no trailing slash). */
export const BASE_URL = "https://anima-protocol.app";

/** Pre-defined metadata for every public route. */
export const ROUTE_META: Record<string, PageMeta> = {
  "/": {
    title: "Anima Protocol | Emotionally Intelligent AI Companion with Persistent Memory",
    description:
      "An AI companion that evolves with you. Anima Protocol features persistent memory, emotional continuity, and immersive sci-fantasy worldbuilding. Experience conversations that remember, adapt, and grow.",
    canonical: `${BASE_URL}/`,
    ogTitle: "Anima Protocol — An AI Companion That Evolves With You",
    ogDescription:
      "Experience conversations with persistent memory, emotional continuity, and a living sci-fantasy universe. Anima Protocol is the future of emotional AI companionship.",
  },
  "/landing": {
    title: "Anima Protocol | Emotionally Intelligent AI Companion with Persistent Memory",
    description:
      "An AI companion that evolves with you. Anima Protocol features persistent memory, emotional continuity, and immersive sci-fantasy worldbuilding. Experience conversations that remember, adapt, and grow.",
    canonical: `${BASE_URL}/`,
    ogTitle: "Anima Protocol — An AI Companion That Evolves With You",
    ogDescription:
      "Experience conversations with persistent memory, emotional continuity, and a living sci-fantasy universe. Anima Protocol is the future of emotional AI companionship.",
    ogUrl: `${BASE_URL}/`,
  },
  "/sign-in": {
    title: "Sign In | Anima Protocol",
    description:
      "Sign in to Anima Protocol and reconnect with your AI companions. Your memories, stories, and emotional bonds are waiting.",
    canonical: `${BASE_URL}/sign-in`,
    ogTitle: "Sign In to Anima Protocol",
    ogDescription:
      "Sign in and reconnect with your AI companions. Your persistent memories and ongoing narratives are waiting.",
  },
  "/sign-up": {
    title: "Create Account | Anima Protocol",
    description:
      "Join Anima Protocol and begin your journey with an emotionally intelligent AI companion that remembers you, grows with you, and lives inside a rich sci-fantasy universe.",
    canonical: `${BASE_URL}/sign-up`,
    ogTitle: "Create Your Anima Protocol Account",
    ogDescription:
      "Start your journey with an AI companion that remembers and evolves with you. Join the Anima Protocol universe today.",
  },
  "/terms": {
    title: "Terms of Use | Anima Protocol",
    description:
      "Read the Anima Protocol Terms of Use. Learn about eligibility, user accounts, content guidelines, subscription terms, and your rights and responsibilities when using our platform.",
    canonical: `${BASE_URL}/terms`,
    ogTitle: "Anima Protocol — Terms of Use",
    ogDescription:
      "Anima Protocol Terms of Use: eligibility, accounts, content, subscriptions, and user rights. Operated by Echoes of Eden Inc.",
  },
  "/privacy-policy": {
    title: "Privacy Policy | Anima Protocol",
    description:
      "Anima Protocol's Privacy Policy explains how Echoes of Eden Inc. collects, uses, and protects your data. We take privacy seriously so your stories stay yours.",
    canonical: `${BASE_URL}/privacy-policy`,
    ogTitle: "Anima Protocol — Privacy Policy",
    ogDescription:
      "How Anima Protocol collects, uses, and protects your data. Effective May 2026. Operated by Echoes of Eden Inc.",
  },
  "/disclaimer": {
    title: "Disclaimer | Anima Protocol",
    description:
      "Anima Protocol disclaimer: AI-generated content limitations, no professional advice, age restrictions, and liability terms. Understand the scope of our AI companion service.",
    canonical: `${BASE_URL}/disclaimer`,
    ogTitle: "Anima Protocol — Disclaimer",
    ogDescription:
      "Disclaimer for Anima Protocol: AI content limitations, no professional advice, user responsibility, and liability terms.",
  },
};
