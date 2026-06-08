import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster, toast } from "sonner";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ClerkProvider,
  HandleSSOCallback,
  SignIn,
  SignUp,
  Show,
  useClerk,
  useSignIn,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { FaApple, FaGithub, FaGoogle } from "react-icons/fa";
import { Suspense, lazy, useRef, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSwipeGestures } from "@/hooks/useSwipeGestures";
import useViewportHeight from "@/hooks/useViewportHeight";
import { initializeColorScheme } from "@/lib/colorScheme";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ConfirmProvider } from "@/lib/ConfirmDialog";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";
import ConsentBanner from "@/components/ConsentBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import BottomTabBar from "@/components/layout/BottomTabBar";
import MobileHeader from "@/components/layout/MobileHeader";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import {
  bootstrapUserData,
  mergeLeftoverLocalData,
  dismissLeftoverLocalData,
} from "@/lib/syncBootstrap";
import { base44 } from "@/api/base44Client";

// Lazy-loaded pages for code splitting
const Chat = lazy(() => import("./pages/Chat"));
const Codespace = lazy(() => import("./pages/Codespace"));
const Landing = lazy(() => import("./pages/Landing"));
const MainHome = lazy(() => import("./pages/MainHome"));
const NewChat = lazy(() => import("./pages/NewChat"));

// Keep the rest of your app's pages lazy-loaded
const Characters = lazy(() => import("./pages/Characters"));
const CharacterGroups = lazy(() => import("./pages/CharacterGroups"));
const Storyboard = lazy(() => import("./pages/Storyboard"));
const Network = lazy(() => import("./pages/Network"));
const Settings = lazy(() => import("./pages/Settings"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const Animas = lazy(() => import("./pages/Animas"));
const LoreBook = lazy(() => import("./pages/LoreBook"));
const WorldMap = lazy(() => import("./pages/WorldMap"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const OnboardingFlow = lazy(() => import("./pages/OnboardingFlow"));
const HallOfOrigins = lazy(() => import("./pages/HallOfOrigins"));
const MemoryCrystals = lazy(() => import("./pages/MemoryCrystals"));
const ConstellationMap = lazy(() => import("./pages/ConstellationMap"));
const BookOfEchoes = lazy(() => import("./pages/BookOfEchoes"));
const ModeSelect = lazy(() => import("./pages/ModeSelect"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
const ReflectionLog = lazy(() => import("./pages/ReflectionLog"));
const Journals = lazy(() => import("./pages/Journals"));
const Wiki = lazy(() => import("./pages/Wiki"));
const NarrativeProgress = lazy(() => import("./pages/NarrativeProgress"));
const StoryFlowchart = lazy(() => import("./pages/StoryFlowchart"));
const StoryboardManager = lazy(() => import("./pages/StoryboardManager"));
const RelationshipNetwork = lazy(() => import("./pages/RelationshipNetwork"));
const CharacterGraphVisualization = lazy(
  () => import("./pages/CharacterGraphVisualization"),
);
const LoreArchive = lazy(() => import("./pages/LoreArchive"));
const Insights = lazy(() => import("./pages/Insights"));
const Reflections = lazy(() => import("./pages/Reflections"));
const DiscoveryQueue = lazy(() => import("./pages/DiscoveryQueue"));
const LocationsMap = lazy(() => import("./pages/LocationsMap"));
const RelationshipVisualization = lazy(
  () => import("./pages/RelationshipVisualization"),
);
const GlobalWiki = lazy(() => import("./pages/GlobalWiki"));
const WorldCalendar = lazy(() => import("./pages/WorldCalendar"));
const WorldCodex = lazy(() => import("./pages/WorldCodex"));
const RelationshipGraph = lazy(() => import("./pages/RelationshipGraph"));
const InventoryPanel = lazy(() => import("./pages/InventoryPanel"));
const CalendarView = lazy(() => import("./pages/CalendarView"));
const StoryBranching = lazy(() => import("./pages/StoryBranching"));
const CharacterMemoryMap = lazy(() => import("./pages/CharacterMemoryMap"));
const WorldPulse = lazy(() => import("./pages/WorldPulse"));
const NarrativeBranchingMap = lazy(
  () => import("./pages/NarrativeBranchingMap"),
);
const RelationshipGraphPage = lazy(
  () => import("./pages/RelationshipGraphPage"),
);
const YnStoriesLibrary = lazy(() => import("./pages/YnStoriesLibrary"));
const WorldTimeline = lazy(() => import("./pages/WorldTimeline"));
const CharacterRepository = lazy(() => import("./pages/CharacterRepository"));
const StoryAnalyticsDashboard = lazy(
  () => import("./pages/StoryAnalyticsDashboard"),
);
const FactionNetwork = lazy(() => import("./pages/FactionNetwork"));
const NarrativeFlowchartPage = lazy(
  () => import("./pages/NarrativeFlowchartPage"),
);
const CharacterMemories = lazy(() => import("./pages/CharacterMemories"));
const CharacterCustomization = lazy(
  () => import("./pages/CharacterCustomization"),
);
const SceneOrchestrator = lazy(() => import("./pages/SceneOrchestrator"));
const MemoryGraphDashboard = lazy(() => import("./pages/MemoryGraphDashboard"));
const CreateScenario = lazy(() => import("./pages/CreateScenario"));
const QuestTrackingDashboard = lazy(
  () => import("./pages/QuestTrackingDashboard"),
);
const CharacterLookCustomizer = lazy(
  () => import("./pages/CharacterLookCustomizer"),
);
const AIBehaviorSettings = lazy(() => import("./pages/AIBehaviorSettings"));
const RelationshipAndLocationDashboard = lazy(
  () => import("./pages/RelationshipAndLocationDashboard"),
);
const InteractiveGraphVisualization = lazy(
  () => import("./pages/InteractiveGraphVisualization"),
);
const IntegratedWorldCalendar = lazy(
  () => import("./pages/IntegratedWorldCalendar"),
);
const QuestLog = lazy(() => import("./pages/QuestLog"));
const CharacterMemoriesDashboard = lazy(
  () => import("./pages/CharacterMemoriesDashboard"),
);
const StoryBranchingGraph = lazy(() => import("./pages/StoryBranchingGraph"));
const CharacterRelationshipForceGraph = lazy(
  () => import("./pages/CharacterRelationshipForceGraph"),
);
const WorldCalendarDashboard = lazy(
  () => import("./pages/WorldCalendarDashboard"),
);
const NarrativeConflictDashboard = lazy(
  () => import("./pages/NarrativeConflictDashboard"),
);
const InteractiveInventory = lazy(() => import("./pages/InteractiveInventory"));
const QuestLogPage = lazy(() => import("./pages/QuestLogPage"));
const LoreArchivesDashboard = lazy(
  () => import("./pages/LoreArchivesDashboard"),
);
const Meditation = lazy(() => import("./pages/Meditation"));
const Subscription = lazy(() => import("./pages/Subscription"));
const LifetimeAccess = lazy(() => import("./pages/LifetimeAccess"));
const ProgressDashboard = lazy(() => import("./pages/ProgressDashboard"));
const PremiumPlans = lazy(() => import("./pages/PremiumPlans"));
const TemplateHub = lazy(() => import("./pages/TemplateHub"));
const NarrativeWorldMap = lazy(() => import("./pages/NarrativeWorldMap"));
const CompanionGenerator = lazy(() => import("./pages/CompanionGenerator"));
const StoryReader = lazy(() => import("./pages/StoryReader"));
const QuestJournal = lazy(() => import("./pages/QuestJournal"));
const TimelineDashboard = lazy(() => import("./pages/TimelineDashboard"));
const RelationshipNodeGraphPage = lazy(
  () => import("./pages/RelationshipNodeGraphPage"),
);
const WhatIfScenarios = lazy(() => import("./pages/WhatIfScenarios"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const Chronicles = lazy(() => import("./pages/Chronicles"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Disclaimer = lazy(() => import("./pages/Disclaimer"));

import { Navigate } from "react-router-dom";
import AIDisclaimerModal from "@/components/legal/AIDisclaimerModal";
import TutorialOverlay from "@/components/onboarding/TutorialOverlay";
import InAppBrowserWarning from "@/components/InAppBrowserWarning";
import TapTargetValidator from "@/components/mobile/TapTargetValidator";

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen-safe">
    <div className="text-center">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
      <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
        Loading...
      </p>
    </div>
  </div>
);

// ── Clerk auth wiring ─────────────────────────────────────────────────────
// BASE_URL is "/" for this artifact, so basePath is "" and the sign-in/up
// routes live at the domain root. Canonical Clerk constants are copied verbatim
// from the clerk-auth skill; only the router glue is adapted to react-router.
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const viteClerkPublishableKey =
  typeof import.meta.env.VITE_CLERK_PUBLISHABLE_KEY === "string"
    ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY.trim()
    : "";

/**
 * Match api-server resolveClerkPublishableKey: Development keys (pk_test_) talk
 * to the dev Clerk instance directly on custom domains (no proxy). Host-derived
 * pk_live_ keys must not override a configured pk_test_ build — that mismatch
 * makes oauth_github fail with "strategy not allowed" when GitHub is only
 * enabled in the Development dashboard.
 */
function resolveFrontendClerkPublishableKey(hostname, envKey) {
  if (envKey.startsWith("pk_test_")) {
    return envKey;
  }
  if (envKey.startsWith("pk_live_")) {
    return publishableKeyFromHost(hostname, envKey);
  }
  return publishableKeyFromHost(hostname, envKey || undefined);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);// @ts-check
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.full.jsx";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

// Initialize Mixpanel once at startup. Tracking stays opted-out until the user
// accepts in ConsentBanner; init itself sends nothing.
initAnalytics();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[anima] service worker registration failed", err);
    });
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);