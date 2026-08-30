/**
 * Authenticated shell: Clerk, Auth, and the lazy route map.
 * Lazy-loaded from App.full.jsx so the HTML entry chunk stays Landing-only.
 */
import { Toaster } from "@/components/ui/toaster";
import ConsentBanner from "@/components/ConsentBanner";
import { usePageMeta, ROUTE_META } from "./lib/usePageMeta";

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
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  HandleSSOCallback,
  SignUp,
  Show,
  useClerk,
} from "@clerk/react";
import EmailCodeSignIn from "@/components/auth/EmailCodeSignIn";
import { dark } from "@clerk/themes";
import { Suspense, lazy, useRef, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSwipeGestures } from "@/hooks/useSwipeGestures";
import useViewportHeight from "@/hooks/useViewportHeight";
import { initializeColorScheme } from "@/lib/colorScheme";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ConfirmProvider } from "@/lib/ConfirmDialog";
import BottomTabBar from "@/components/layout/BottomTabBar";
import MobileHeader from "@/components/layout/MobileHeader";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import {
  bootstrapUserData,
  mergeLeftoverLocalData,
  dismissLeftoverLocalData,
} from "@/lib/syncBootstrap";
import { prefetchHotRoutes } from "@/lib/prefetchHotRoutes";
import { base44 } from "@/api/base44Client";
import {
  CLERK_FAILURE_HINT,
  CLERK_STALL_HINT,
  isClerkProxyHealthy,
  probeClerkConnectivity,
} from "@/lib/clerkConnectDiagnostics";
import {
  isUsableClerkPublishableKey,
  isVercelPreviewHost,
  resolveClerkProxyUrl,
  sanitizeClerkPublishableKey,
  shouldUseClerkProxy,
} from "@/lib/clerkProxy";

// Title screen is eager so cold opens paint Landing immediately (no spinner).
import Landing from "./pages/Landing";

// Lazy-loaded pages for code splitting
const Chat = lazy(() => import("./pages/Chat"));
const Codespace = lazy(() => import("./pages/Codespace"));
const RepoCodespace = lazy(() => import("./pages/RepoCodespace"));
const NetBattle = lazy(() => import("./pages/NetBattle"));
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
const EnergyFragments = lazy(() => import("./pages/EnergyFragments"));
const EchoKeys = lazy(() => import("./pages/EchoKeys"));
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
const CustomiseAnima = lazy(() => import("./pages/CustomiseAnima"));
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
const Therapy = lazy(() => import("./pages/Therapy"));
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

import { PageLoader } from "./app/PageLoader";

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
 * Use the build-time publishable key when it decodes to a real Clerk host.
 * Placeholder / mojibake keys are treated as unset so fallbackDevKey applies.
 */
function resolveFrontendClerkPublishableKey(hostname, envKey) {
  return sanitizeClerkPublishableKey(envKey);
}

const fallbackDevKey = "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA"; // pragma: allowlist secret

const clerkPubKey = resolveFrontendClerkPublishableKey(
  window.location.hostname,
  viteClerkPublishableKey,
) || fallbackDevKey;

// Relative `/api/__clerk/` in production (pk_live_) — see lib/clerkProxy.js. An
// absolute proxyUrl breaks clerk-js script loading and OAuth redirects.
const initialClerkProxyUrl = resolveClerkProxyUrl(clerkPubKey);
const clerkProxyCapable = shouldUseClerkProxy(clerkPubKey);
const authRedirectCompleteUrl = basePath || "/";

function stripBase(path) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  console.warn("Missing VITE_CLERK_PUBLISHABLE_KEY. Running in fallback mode.");
}

if (clerkPubKey.startsWith("sk_")) {
  throw new Error(
    "VITE_CLERK_PUBLISHABLE_KEY must be a publishable key (pk_live_… or pk_test_…), not a secret key (sk_…).",
  );
}

if (import.meta.env.PROD && !isUsableClerkPublishableKey(clerkPubKey)) {
  console.error(
    "[Anima] VITE_CLERK_PUBLISHABLE_KEY must be a real pk_test_ or pk_live_ key " +
      "whose payload decodes to a Clerk hostname. GitHub sign-in cannot start otherwise.",
  );
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside",
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsVariant: "blockButton",
  },
  variables: {
    colorPrimary: "#22d3ee",
    colorForeground: "#a5f3fc",
    colorMutedForeground: "#5ea9b5",
    colorDanger: "#f87171",
    colorBackground: "#090912",
    colorInput: "#0c1420",
    colorInputForeground: "#a5f3fc",
    colorNeutral: "#22d3ee",
    fontFamily: "'Rajdhani', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#090912] border border-cyan-400/30 shadow-[0_0_40px_rgba(34,211,238,0.15)] rounded-md w-[420px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "!text-cyan-200 tracking-wide",
    headerSubtitle: "!text-cyan-400/60",
    socialButtonsBlockButton:
      "!border-cyan-400/30 !bg-cyan-400/5 hover:!bg-cyan-400/10",
    socialButtonsBlockButtonText: "!text-cyan-100",
    // Apple Production SSO has empty client_id — hide until credentials are set.
    socialButtonsBlockButton__apple: "!hidden",
    socialButtonsProviderIcon__apple: "!hidden",
    // Google Production still returns redirect_uri_mismatch until Google Cloud
    // allowlists https://clerk.anima-protocol.com/v1/oauth_callback — hide so
    // users are not sent into a hard failure; use GitHub or email code instead.
    socialButtonsBlockButton__google: "!hidden",
    socialButtonsProviderIcon__google: "!hidden",
    socialButtonsBlockButton__google_one_tap: "!hidden",
    socialButtonsProviderIcon__google_one_tap: "!hidden",
    // Prefer GitHub while Google/Apple are ops-blocked.
    socialButtonsBlockButton__github:
      "!border-cyan-400/40 !bg-cyan-400/10 hover:!bg-cyan-400/15",
    dividerLine: "!bg-cyan-400/20",
    dividerText: "!text-cyan-400/50",
    formFieldLabel: "!text-cyan-300/80",
    formFieldInput: "!bg-[#0c1420] !border-cyan-400/30 !text-cyan-100",
    formButtonPrimary:
      "!bg-cyan-400/15 !text-cyan-100 !border !border-cyan-400/50 hover:!bg-cyan-400/25",
    footerActionText: "!text-cyan-400/50",
    footerActionLink: "!text-cyan-300 hover:!text-cyan-200",
    identityPreviewEditButton: "!text-cyan-300",
    otpCodeFieldInput: "!text-cyan-100 !border-cyan-400/30",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

/** Delay before showing stall diagnostics so healthy loads never flash a warning. */
const CLERK_DIAGNOSTICS_STALL_MS = 4000;

const VERCEL_PREVIEW_SIGNIN_HINT =
  "This is a Vercel preview URL. If OAuth callbacks are unregistered or Deployment Protection is on, use https://www.anima-protocol.com/sign-in instead.";

function ClerkDiagnosticsBanner({ hints }) {
  if (!hints?.length) return null;
  return (
    <div className="rounded-md border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-100">
      {hints.map((hint) => (
        <p key={hint} className="mt-1 first:mt-0">
          {hint}
        </p>
      ))}
    </div>
  );
}

/**
 * Connectivity hints only when Clerk failed, or is still loading after a stall
 * timeout. Avoids always-on false positives when sign-in is already working.
 */
function ClerkLoginDiagnostics() {
  return (
    <>
      <ClerkFailed>
        <ClerkFailedConnectivityHints />
      </ClerkFailed>
      <ClerkLoading>
        <ClerkStalledConnectivityHints />
      </ClerkLoading>
    </>
  );
}

function useClerkProbeHints() {
  const [probeHints, setProbeHints] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await probeClerkConnectivity(clerkPubKey);
      if (!cancelled) setProbeHints(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return probeHints;
}

function withPreviewHostHint(hints) {
  // Only append preview guidance after a real probe failure — never on healthy
  // stall/failure fallbacks alone.
  if (
    hints.length > 0 &&
    typeof window !== "undefined" &&
    isVercelPreviewHost(window.location.hostname)
  ) {
    return [...hints, VERCEL_PREVIEW_SIGNIN_HINT];
  }
  return hints;
}

function resolveConnectivityHints(probeHints, fallbackHint) {
  if (probeHints === null) return [fallbackHint];
  if (probeHints.length > 0) return withPreviewHostHint(probeHints);
  return [fallbackHint];
}

/**
 * Start probes as soon as ClerkLoading mounts. At the stall timeout, show the
 * stall hint immediately (don't wait for sequential probe timeouts), then swap
 * in specific endpoint failures when probes finish.
 */
function ClerkStalledConnectivityHints() {
  const [stalled, setStalled] = useState(false);
  const probeHints = useClerkProbeHints();

  useEffect(() => {
    const timer = window.setTimeout(
      () => setStalled(true),
      CLERK_DIAGNOSTICS_STALL_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  if (!stalled) return null;
  return (
    <ClerkDiagnosticsBanner
      hints={resolveConnectivityHints(probeHints, CLERK_STALL_HINT)}
    />
  );
}

/** Immediate failure fallback, upgraded with probe results when ready. */
function ClerkFailedConnectivityHints() {
  const probeHints = useClerkProbeHints();
  return (
    <ClerkDiagnosticsBanner
      hints={resolveConnectivityHints(probeHints, CLERK_FAILURE_HINT)}
    />
  );
}

function AuthFormShell({ mode, children }) {
  return (
    <div className="flex min-h-screen-safe items-center justify-center bg-background px-4">
      <div className="w-[420px] max-w-full space-y-3">
        <ClerkLoginDiagnostics />
        {mode === "sign-in" ? (
          <p className="px-1 text-center text-xs leading-relaxed text-cyan-400/55">
            Prefer Continue with GitHub, or the username/email already on your
            account for a one-time code. Google and Apple stay hidden until
            their provider redirect URIs are fixed.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function SignInPage() {
  usePageMeta(ROUTE_META["/sign-in"]);

  useEffect(() => {
    document.title = "Sign In | Anima Protocol";
  }, []);

  return (
    <AuthFormShell mode="sign-in">
      <EmailCodeSignIn />
      <p className="px-1 text-center text-xs text-cyan-400/45">
        Need an account?{" "}
        <a
          href={`${basePath}/sign-up`}
          className="text-cyan-300 hover:text-cyan-200"
        >
          Join the waitlist
        </a>
      </p>
    </AuthFormShell>
  );
}

function SignUpPage() {
  usePageMeta(ROUTE_META["/sign-up"]);

  return (
    <AuthFormShell mode="sign-up">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        oauthFlow="redirect"
        transferable
        fallbackRedirectUrl={authRedirectCompleteUrl}
        forceRedirectUrl={authRedirectCompleteUrl}
      />
      <p className="px-1 text-center text-xs text-cyan-400/45">
        Already registered?{" "}
        <a
          href={`${basePath}/sign-in`}
          className="text-cyan-300 hover:text-cyan-200"
        >
          Sign in
        </a>
      </p>
    </AuthFormShell>
  );
}
function SsoCallbackPage() {
  const navigate = useNavigate();

  const navigateAfterAuth = ({ session, decorateUrl }) => {
    if (session?.currentTask) {
      const destination = decorateUrl(`/${session.currentTask.key}`);
      if (destination.startsWith("http")) {
        window.location.href = destination;
      } else {
        navigate(stripBase(destination));
      }
      return;
    }

    const destination = decorateUrl(authRedirectCompleteUrl);
    if (destination.startsWith("http")) {
      window.location.href = destination;
    } else {
      navigate(stripBase(destination));
    }
  };

  return (
    <div className="flex min-h-screen-safe items-center justify-center bg-background px-4">
      <HandleSSOCallback
        navigateToApp={navigateAfterAuth}
        navigateToSignIn={() => navigate(`${basePath}/sign-in`)}
        navigateToSignUp={() => navigate(`${basePath}/sign-up`)}
      />
      <div id="clerk-captcha" />
    </div>
  );
}

const HAS_COMPANION_KEY = "anima_has_companion";

function readHomeGateState() {
  try {
    return sessionStorage.getItem(HAS_COMPANION_KEY) === "0"
      ? "onboarding"
      : "home";
  } catch {
    return "home";
  }
}

function rememberHasCompanion(has) {
  try {
    sessionStorage.setItem(HAS_COMPANION_KEY, has ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

// First-run gate for signed-in users: if they have not yet awakened an Anima,
// show the Serenity-led onboarding. Once an Anima exists, load their dashboard.
// Optimistic home — do not block first paint on Anima.list. Fails open to the
// dashboard so a transient lookup error never traps the user.
function SignedInHome() {
  const [state, setState] = useState(readHomeGateState); // 'onboarding' | 'home'

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const animas = await base44.entities.Anima.list("-created_date", 1);
        if (cancelled) return;
        const has = (animas?.length || 0) > 0;
        rememberHasCompanion(has);
        setState(has ? "home" : "onboarding");
      } catch {
        if (!cancelled) setState("home");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "onboarding") {
    return (
      <OnboardingFlow
        onComplete={() => {
          rememberHasCompanion(true);
          setState("home");
        }}
      />
    );
  }
  return <MainHome />;
}

// Public landing for signed-out users; full app home for signed-in users.
function HomeGate() {
  const { isLoadingAuth, isAuthenticated, localUser, user } = useAuth();

  if (isLoadingAuth) {
    return <Landing />;
  }

  if (isAuthenticated || localUser || user) {
    return <SignedInHome />;
  }

  return <Landing />;
}

function ClerkStallRecovery({ useProxy, onToggleProxy }) {
  const clerk = useClerk();
  const toggledRef = useRef(false);

  useEffect(() => {
    if (!clerkProxyCapable || toggledRef.current || clerk.loaded) return;
    // Already on direct Clerk — never flip back to a broken same-origin proxy.
    if (!useProxy) return;

    const timer = setTimeout(() => {
      if (clerk.loaded || toggledRef.current) return;
      toggledRef.current = true;
      onToggleProxy(false);
    }, 10_000);

    return () => clearTimeout(timer);
  }, [clerk.loaded, onToggleProxy, useProxy]);

  return null;
}

function ClerkProviderWithRoutes({ children }) {
  const navigate = useNavigate();
  // Initialize to direct mode so routes mount immediately on the first paint
  const [useProxy, setUseProxy] = useState(false);
  const [providerKey, setProviderKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!initialClerkProxyUrl) return;
        const healthy = await isClerkProxyHealthy(clerkPubKey);
        if (!cancelled && healthy) setUseProxy(true);
      } catch {
        if (!cancelled) setUseProxy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeProxyUrl =
    useProxy === true ? resolveClerkProxyUrl(clerkPubKey) : "";

  const handleToggleProxy = (nextUseProxy) => {
    setUseProxy(nextUseProxy);
    setProviderKey((key) => key + 1);
  };

  return (
    <ClerkProvider
      key={`clerk-${providerKey}-${useProxy ? "proxy" : "direct"}`}
      publishableKey={clerkPubKey}
      {...(activeProxyUrl ? { proxyUrl: activeProxyUrl } : {})}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={authRedirectCompleteUrl}
      signUpFallbackRedirectUrl={authRedirectCompleteUrl}
      localization={{
        signIn: {
          start: {
            title: "Re-enter the Protocol",
            subtitle: "Sign in to reconnect with your companions",
          },
        },
        signUp: {
          start: {
            title: "Begin the Protocol",
            subtitle: "Create your account to awaken your companions",
          },
        },
      }}
      routerPush={(to) => navigate(stripBase(to))}
      routerReplace={(to) => navigate(stripBase(to), { replace: true })}
    >
      <ClerkStallRecovery useProxy={useProxy} onToggleProxy={handleToggleProxy} />
      <ClerkQueryClientCacheInvalidator />
      {children}
    </ClerkProvider>
  );
}

// Public routes that signed-out users may reach without authentication.
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/sso-callback",
  "/terms",
  "/privacy-policy",
  "/disclaimer",
];

const AuthenticatedApp = () => {
  const {
    isLoadingAuth,
    authStalled,
    isLoadingPublicSettings,
    authError,
    navigateToLogin,
    isAuthenticated,
    user,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Navigation history for swipe back/forward
  const navigationStack = useRef(["/"]);
  const appContainerRef = useRef(null);
  useKeyboardAvoidance(appContainerRef);

  // Initialize color scheme on mount
  useEffect(() => {
    initializeColorScheme();
  }, []);

  useEffect(() => {
    prefetchHotRoutes();
  }, []);

  // Once a Clerk session exists, migrate any pre-sync local data up to the
  // account (once) and seed starter characters for new accounts. Gated on the
  // resolved user id so it runs per-account and only after the token is ready.
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      bootstrapUserData(user.id).then((outcome) => {
        if (outcome === "failed") {
          // The one-time import of this browser's pre-sync local data didn't
          // confirm success. Let the user know their local characters/profile
          // haven't synced yet (it retries automatically on the next sign-in).
          toast.error("Your saved data hasn't synced to your account yet.", {
            id: "anima-migration-sync",
            description:
              "We'll keep trying automatically. Refresh or sign in again to retry now.",
            duration: Infinity,
            action: {
              label: "Retry",
              onClick: () => window.location.reload(),
            },
          });
        } else if (outcome === "migrated") {
          // A later attempt confirmed success — clear any lingering notice.
          toast.dismiss("anima-migration-sync");
        } else if (outcome === "local_data_available") {
          // A returning user signed in on a fresh browser that still holds local
          // data created offline, but their account already has data — so the
          // one-time import couldn't bring it over. Offer an optional, non-
          // destructive merge that adds this device's data to their account.
          toast("We found data saved on this device.", {
            id: "anima-local-merge",
            description:
              "Add it to your account? Nothing already on your account will be overwritten.",
            duration: Infinity,
            action: {
              label: "Add to my account",
              onClick: async () => {
                toast.loading("Adding your device's data…", {
                  id: "anima-local-merge",
                });
                try {
                  await mergeLeftoverLocalData();
                  toast.success(
                    "Your device's data was added to your account.",
                    { id: "anima-local-merge", duration: 6000 },
                  );
                } catch (err) {
                  console.warn("[Anima] Local data merge failed:", err.message);
                  toast.error("We couldn't add your device's data just now.", {
                    id: "anima-local-merge",
                    description: "Please try again.",
                    duration: Infinity,
                    action: {
                      label: "Retry",
                      onClick: () => window.location.reload(),
                    },
                  });
                }
              },
            },
            cancel: {
              label: "Not now",
              onClick: () => dismissLeftoverLocalData(),
            },
          });
        }
      });
    }
  }, [isAuthenticated, user?.id]);

  // Track route changes
  useEffect(() => {
    const currentPath = location.pathname;
    if (
      navigationStack.current[navigationStack.current.length - 1] !==
      currentPath
    ) {
      navigationStack.current.push(currentPath);
    }
  }, [location.pathname]);

  // Setup swipe gestures — must be in useEffect to avoid hook violations
  const handleSwipeRight = () => {
    if (navigationStack.current.length > 1) {
      navigationStack.current.pop();
      navigate(navigationStack.current[navigationStack.current.length - 1]);
    }
  };

  const handleSwipeLeft = () => {
    navigate("/");
  };

  useSwipeGestures({
    onSwipeRight: handleSwipeRight,
    onSwipeLeft: handleSwipeLeft,
    excludeSelector: "input, textarea, [data-no-swipe]",
  });
  // Gate the first-run tutorial behind the AI disclaimer so the two modals
  // never stack. The disclaimer fires onAccept on mount when already accepted,
  // so returning users surface the tutorial immediately (e.g. when replaying).
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  useEffect(() => {
    if (!isLoadingAuth || !authStalled) return;
    const onSignInScreen =
      location.pathname === "/sign-in" ||
      location.pathname === "/sign-up" ||
      location.pathname.startsWith("/sign-in/") ||
      location.pathname.startsWith("/sign-up/");
    if (onSignInScreen) return;
    toast.error("Sign-in is temporarily unavailable.", {
      id: "anima-clerk-unavailable",
      description:
        "The app will load in guest mode. Fix CLERK_SECRET_KEY on Vercel (sk_live_*), then refresh.",
      duration: Infinity,
      action: {
        label: "Retry",
        onClick: () => window.location.reload(),
      },
    });
  }, [isLoadingAuth, authStalled, location.pathname]);

  if (authError) {
    if (authError.type === "user_not_registered") {
      return <UserNotRegisteredError />;
    } else if (authError.type === "auth_required") {
      return <Landing />;
    }
  }

  // Gate protected routes: signed-out users are sent to the public Landing.
  const pathname = location.pathname;
  const isPublicPath =
    pathname === "/" ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // While Clerk boots, render public routes (especially `/` → title screen)
  // immediately. Protected routes still wait on a short loader; if auth stalls,
  // send guests to the title screen instead of a blank/protected view.
  if (isLoadingAuth && !authStalled) {
    if (!isPublicPath) {
      return <PageLoader />;
    }
  } else if (!isAuthenticated && !isPublicPath) {
    return <Navigate to="/" replace />;
  }

  const showChrome =
    isAuthenticated &&
    !pathname.startsWith("/sign-in") &&
    !pathname.startsWith("/sign-up");

  return (
    <>
      {showChrome && (
        <AIDisclaimerModal onAccept={() => setDisclaimerAccepted(true)} />
      )}
      {showChrome && disclaimerAccepted && <TutorialOverlay />}
      {showChrome && <MobileHeader />}
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname.split("/")[1] || "home"}
          ref={appContainerRef}
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -20, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
          className="flex-1 min-h-0 flex flex-col"
          style={{ paddingBottom: "var(--tab-bar-height, 0px)" }}
        >
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoader />}>
            <Routes location={location}>
              {/* Root: signed-out -> Landing, signed-in -> MainHome */}
              <Route path="/" element={<HomeGate />} />
              <Route
                path="/sign-in/sso-callback"
                element={<SsoCallbackPage />}
              />
              <Route
                path="/sign-up/sso-callback"
                element={<SsoCallbackPage />}
              />
              <Route path="/sso-callback" element={<SsoCallbackPage />} />
              <Route path="/sign-in/*" element={<SignInPage />} />
              <Route path="/sign-up/*" element={<SignUpPage />} />
              <Route
                path="/sso-callback/*"
                element={<Navigate to="/sign-in/sso-callback" replace />}
              />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              <Route path="/login" element={<Navigate to="/sign-in" replace />} />
              <Route
                path="/chat"
                element={
                    <NewChat />
                }
              />
              <Route
                path="/repo-codespace"
                element={
                    <RepoCodespace />
                }
              />
              <Route
                path="/chat/:sessionId"
                element={
                    <Chat />
                }
              />
              <Route
                path="/codespace"
                element={
                    <Codespace />
                }
              />
              <Route
                path="/net-battle"
                element={
                    <NetBattle />
                }
              />

              {/* Everything else remains as-is */}
              <Route
                path="/onboarding"
                element={
                    <OnboardingFlow />
                }
              />
              <Route
                path="/legacy-onboarding"
                element={
                    <Onboarding />
                }
              />
              <Route
                path="/mode-select"
                element={
                    <ModeSelect />
                }
              />
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route
                path="/check-in"
                element={
                    <CheckIn />
                }
              />
              <Route
                path="/reflection-log"
                element={
                    <ReflectionLog />
                }
              />
              <Route
                path="/characters"
                element={
                    <Characters />
                }
              />
              <Route
                path="/groups"
                element={
                    <CharacterGroups />
                }
              />
              <Route
                path="/storyboard"
                element={
                    <Storyboard />
                }
              />
              <Route
                path="/storyboard-manager/:sessionId"
                element={
                    <StoryboardManager />
                }
              />
              <Route
                path="/network"
                element={
                    <Network />
                }
              />
              <Route
                path="/settings"
                element={
                    <Settings />
                }
              />
              <Route
                path="/profile"
                element={
                    <UserProfile />
                }
              />
              <Route
                path="/origins"
                element={
                    <HallOfOrigins />
                }
              />
              <Route
                path="/memory-crystals"
                element={
                    <MemoryCrystals />
                }
              />
              <Route
                path="/constellation"
                element={
                    <ConstellationMap />
                }
              />
              <Route
                path="/book-of-echoes"
                element={
                    <BookOfEchoes />
                }
              />
              <Route
                path="/animas"
                element={
                    <Animas />
                }
              />
              <Route
                path="/lorebook"
                element={
                    <LoreBook />
                }
              />
              <Route
                path="/worldmap"
                element={
                    <WorldMap />
                }
              />
              <Route
                path="/journals"
                element={
                    <Journals />
                }
              />
              <Route
                path="/wiki"
                element={
                    <Wiki />
                }
              />
              <Route
                path="/narrative"
                element={
                    <NarrativeProgress />
                }
              />
              <Route
                path="/flowchart"
                element={
                    <StoryFlowchart />
                }
              />
              <Route
                path="/relationships"
                element={
                    <RelationshipNetwork />
                }
              />
              <Route
                path="/graph"
                element={
                    <CharacterGraphVisualization />
                }
              />
              <Route
                path="/archive"
                element={
                    <LoreArchive />
                }
              />
              <Route
                path="/insights"
                element={
                    <Insights />
                }
              />
              <Route
                path="/reflections"
                element={
                    <Reflections />
                }
              />
              <Route
                path="/discoveries"
                element={
                    <DiscoveryQueue />
                }
              />
              <Route
                path="/locationsmap"
                element={
                    <LocationsMap />
                }
              />
              <Route
                path="/relationshipviz"
                element={
                    <RelationshipVisualization />
                }
              />
              <Route
                path="/globalwiki"
                element={
                    <GlobalWiki />
                }
              />
              <Route
                path="/worldcalendar"
                element={
                    <WorldCalendar />
                }
              />
              <Route
                path="/worldcodex"
                element={
                    <WorldCodex />
                }
              />
              <Route
                path="/relationshipgraph"
                element={
                    <RelationshipGraph />
                }
              />
              <Route
                path="/inventory"
                element={
                    <InventoryPanel />
                }
              />
              <Route
                path="/energy-fragments"
                element={
                    <EnergyFragments />
                }
              />
              <Route
                path="/echo-keys"
                element={
                    <EchoKeys />
                }
              />
              <Route
                path="/calenderview"
                element={
                    <CalendarView />
                }
              />
              <Route
                path="/branching"
                element={
                    <StoryBranching />
                }
              />
              <Route
                path="/memory-map"
                element={
                    <CharacterMemoryMap />
                }
              />
              <Route
                path="/world-pulse"
                element={
                    <WorldPulse />
                }
              />
              <Route
                path="/branching-map"
                element={
                    <NarrativeBranchingMap />
                }
              />
              <Route
                path="/relationship-graph"
                element={
                    <RelationshipGraphPage />
                }
              />
              <Route
                path="/yn-library"
                element={
                    <YnStoriesLibrary />
                }
              />
              <Route
                path="/world-timeline"
                element={
                    <WorldTimeline />
                }
              />
              <Route
                path="/characters-repository"
                element={
                    <CharacterRepository />
                }
              />
              <Route
                path="/analytics"
                element={
                    <StoryAnalyticsDashboard />
                }
              />
              <Route
                path="/faction-network"
                element={
                    <FactionNetwork />
                }
              />
              <Route
                path="/story-control"
                element={
                    <NarrativeFlowchartPage />
                }
              />
              <Route
                path="/character-memories"
                element={
                    <CharacterMemories />
                }
              />
              <Route
                path="/customize"
                element={
                    <CharacterCustomization />
                }
              />
              <Route
                path="/customise-anima"
                element={
                    <CustomiseAnima />
                }
              />
              <Route
                path="/orchestrate/:sessionId"
                element={
                    <SceneOrchestrator />
                }
              />
              <Route
                path="/memory-graph/:characterId"
                element={
                    <MemoryGraphDashboard />
                }
              />
              <Route
                path="/create-scenario"
                element={
                    <CreateScenario />
                }
              />
              <Route
                path="/quests/:sessionId"
                element={
                    <QuestTrackingDashboard />
                }
              />
              <Route
                path="/looks"
                element={
                    <CharacterLookCustomizer />
                }
              />
              <Route
                path="/ai-behavior"
                element={
                    <AIBehaviorSettings />
                }
              />
              <Route
                path="/dashboard/:sessionId"
                element={
                    <RelationshipAndLocationDashboard />
                }
              />
              <Route
                path="/graph-visualization"
                element={
                    <InteractiveGraphVisualization />
                }
              />
              <Route
                path="/graph-visualization/:sessionId"
                element={
                    <InteractiveGraphVisualization />
                }
              />
              <Route
                path="/integrated-calendar"
                element={
                    <IntegratedWorldCalendar />
                }
              />
              <Route
                path="/integrated-calendar/:sessionId"
                element={
                    <IntegratedWorldCalendar />
                }
              />
              <Route
                path="/quest-log"
                element={
                    <QuestLog />
                }
              />
              <Route
                path="/quest-log/:sessionId"
                element={
                    <QuestLog />
                }
              />
              <Route
                path="/memories"
                element={
                    <CharacterMemoriesDashboard />
                }
              />
              <Route
                path="/story-branching/:sessionId"
                element={
                    <StoryBranchingGraph />
                }
              />
              <Route
                path="/story-branching"
                element={
                    <StoryBranchingGraph />
                }
              />
              <Route
                path="/world-calendar-dashboard"
                element={
                    <WorldCalendarDashboard />
                }
              />
              <Route
                path="/world-calendar-dashboard/:sessionId"
                element={
                    <WorldCalendarDashboard />
                }
              />
              <Route
                path="/conflict-dashboard"
                element={
                    <NarrativeConflictDashboard />
                }
              />
              <Route
                path="/interactive-inventory"
                element={
                    <InteractiveInventory />
                }
              />
              <Route
                path="/interactive-inventory/:sessionId/:characterId"
                element={
                    <InteractiveInventory />
                }
              />
              <Route
                path="/quest-log-page"
                element={
                    <QuestLogPage />
                }
              />
              <Route
                path="/quest-log-page/:sessionId"
                element={
                    <QuestLogPage />
                }
              />
              <Route
                path="/lore-archives"
                element={
                    <LoreArchivesDashboard />
                }
              />
              <Route
                path="/meditation"
                element={
                    <Meditation />
                }
              />
              <Route
                path="/therapy"
                element={
                    <Therapy />
                }
              />
              <Route
                path="/subscription"
                element={
                    <Subscription />
                }
              />
              <Route
                path="/lifetime-access"
                element={
                    <LifetimeAccess />
                }
              />
              <Route
                path="/narrative-world-map/:sessionId"
                element={
                    <NarrativeWorldMap />
                }
              />
              <Route
                path="/companion-generator"
                element={
                    <CompanionGenerator />
                }
              />
              <Route
                path="/what-if"
                element={
                    <WhatIfScenarios />
                }
              />
              <Route
                path="/story-reader/:sessionId"
                element={
                    <StoryReader />
                }
              />
              <Route
                path="/quest-journal"
                element={
                    <QuestJournal />
                }
              />
              <Route
                path="/timeline/:sessionId"
                element={
                    <TimelineDashboard />
                }
              />
              <Route
                path="/relationship-graph/:sessionId"
                element={
                    <RelationshipNodeGraphPage />
                }
              />
              <Route
                path="/relationship-graph"
                element={
                    <RelationshipNodeGraphPage />
                }
              />
              <Route
                path="/terms"
                element={
                    <TermsOfUse />
                }
              />
              <Route
                path="/chronicles"
                element={
                    <Chronicles />
                }
              />
              <Route
                path="/privacy-policy"
                element={
                    <PrivacyPolicy />
                }
              />
              <Route
                path="/disclaimer"
                element={
                    <Disclaimer />
                }
              />
              <Route
                path="/progress"
                element={
                    <ProgressDashboard />
                }
              />
              <Route
                path="/premium"
                element={
                    <PremiumPlans />
                }
              />
              <Route
                path="/templates"
                element={
                    <TemplateHub />
                }
              />
              <Route path="*" element={<PageNotFound />} />
            </Routes>
            </Suspense>
          </ErrorBoundary>
        </motion.div>
      </AnimatePresence>
      {showChrome && <BottomTabBar />}
    </>
  );
};

export default function ProtocolApp() {
  useViewportHeight();

  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ErrorBoundary resetKey={window.location?.pathname || "init"}>
          <ClerkProviderWithRoutes>
            <AuthProvider>
              <ConfirmProvider>
                <InAppBrowserWarning />
                <TapTargetValidator />
                <div
                  className="flex flex-col h-screen-safe"
                  style={{
                    paddingTop: "env(safe-area-inset-top, 0px)",
                    // --safe-bottom is env(safe-area-inset-bottom) when the
                    // keyboard is closed, and 0px while it is open so the
                    // home indicator is not reserved above the keyboard.
                    paddingBottom: "var(--safe-bottom, env(safe-area-inset-bottom, 0px))",
                  }}
                >
                  <AuthenticatedApp />
                </div>
              </ConfirmProvider>
            </AuthProvider>
          </ClerkProviderWithRoutes>
        </ErrorBoundary>
        <ConsentBanner />
        <Toaster />
        <SonnerToaster
          theme="dark"
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast:
                "!bg-[#090912] !border !border-primary/30 !text-primary/90 !rounded-none !shadow-[0_0_30px_rgba(34,211,238,0.15)] !font-mono",
              description: "!text-primary/50 !text-xs",
              actionButton:
                "!bg-primary/15 !text-primary !border !border-primary/40 !rounded-none !font-mono !text-[10px] !tracking-[0.2em] !uppercase",
            },
          }}
        />
      </Router>
    </QueryClientProvider>
  );
}

