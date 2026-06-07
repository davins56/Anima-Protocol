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
import { Suspense, lazy, useRef, useEffect, useMemo, useState } from "react";
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

const clerkPubKey = resolveFrontendClerkPublishableKey(
  window.location.hostname,
  viteClerkPublishableKey,
);

// Clerk Frontend API proxy — only when explicitly configured or for production
// Clerk keys on same-origin hosts. Development keys (pk_test_*) break with the
// proxy on custom domains (POST /api/__clerk/v1/client → 400 Origin mismatch).
function configuredClerkProxyUrl() {
  return typeof import.meta.env.VITE_CLERK_PROXY_URL === "string"
    ? import.meta.env.VITE_CLERK_PROXY_URL.trim()
    : "";
}

function isSameOriginProductionHost() {
  if (typeof window === "undefined" || !import.meta.env.PROD) return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host === "anima-protocol.com" ||
    host === "www.anima-protocol.com" ||
    host.endsWith(".anima-protocol.com") ||
    host.endsWith(".replit.app") ||
    host.endsWith(".vercel.app")
  );
}

function isDevClerkKey(key) {
  const builtIn =
    typeof import.meta.env.VITE_CLERK_PUBLISHABLE_KEY === "string"
      ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
      : "";
  if (builtIn.startsWith("pk_test_")) return true;
  return typeof key === "string" && key.startsWith("pk_test_");
}

function effectiveClerkProxyUrl() {
  const configured = configuredClerkProxyUrl();
  if (configured) return configured;
  if (isDevClerkKey(clerkPubKey)) return "";
  if (!isSameOriginProductionHost()) return "";
  return `${window.location.origin}/api/__clerk`;
}

const clerkProxyUrl = effectiveClerkProxyUrl();
const authRedirectCompleteUrl = basePath || "/";

const socialAuthProviders = [
  {
    label: "Continue with Google",
    strategy: "oauth_google",
    Icon: FaGoogle,
  },
  {
    label: "Continue with Apple",
    strategy: "oauth_apple",
    Icon: FaApple,
  },
  {
    label: "Continue with GitHub",
    strategy: "oauth_github",
    Icon: FaGithub,
  },
];

function oauthCallbackPath(mode) {
  const segment = mode === "sign-up" ? "sign-up" : "sign-in";
  return `${basePath}/${segment}/sso-callback`;
}

function oauthRedirectUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path;
}

function stripBase(path) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

if (
  import.meta.env.PROD &&
  (clerkPubKey.includes("placeholder") || !viteClerkPublishableKey)
) {
  console.error(
    "[Anima] VITE_CLERK_PUBLISHABLE_KEY must be set at build time on Vercel. " +
      "GitHub sign-in will fail without the real pk_test_ or pk_live_ key.",
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
    socialButtonsRoot: "!hidden",
    dividerRow: "!hidden",
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

function formatClerkOAuthError(error) {
  if (error?.errors?.length) {
    return error.errors
      .map((entry) => entry.longMessage || entry.message)
      .filter(Boolean)
      .join(" ");
  }
  return error?.longMessage || error?.message || "";
}

function clerkInstanceLabel() {
  if (typeof clerkPubKey !== "string") return "Clerk";
  return clerkPubKey.startsWith("pk_test_") ? "Development" : "Production";
}

function getEnabledOAuthStrategies(clerk) {
  const environment =
    clerk?.__internal_environment ?? clerk?.environment ?? null;
  const strategies = new Set();

  const authList =
    environment?.userSettings?.authenticatableSocialStrategies ?? null;
  if (Array.isArray(authList)) {
    for (const strategy of authList) {
      if (strategy) strategies.add(strategy);
    }
  }

  const social = environment?.userSettings?.social;
  if (social && typeof social === "object") {
    for (const provider of Object.values(social)) {
      if (provider?.enabled && provider?.strategy) {
        strategies.add(provider.strategy);
      }
    }
  }

  return strategies.size > 0 ? [...strategies] : null;
}

function filterProvidersByEnvList(providers) {
  const envList = import.meta.env.VITE_CLERK_OAUTH_STRATEGIES;
  if (typeof envList !== "string" || !envList.trim()) {
    return providers;
  }
  const allowed = new Set(
    envList.split(",").map((entry) => entry.trim()).filter(Boolean),
  );
  return providers.filter((provider) => allowed.has(provider.strategy));
}

const CLERK_SSO_DASHBOARD_URL =
  "https://dashboard.clerk.com/last-active?path=user-authentication/sso-connections";

function clerkGitHubSetupHint() {
  const instance = clerkInstanceLabel();
  if (instance === "Development") {
    return (
      "In Clerk Dashboard → Development → SSO connections: Add connection → " +
      "For all users → GitHub. Leave “Use custom credentials” OFF (dev uses " +
      "shared GitHub OAuth). Redirect URLs are already registered for anima-protocol.com."
    );
  }
  return (
    "In Clerk Dashboard → Production → SSO connections: enable GitHub with " +
    "custom OAuth credentials, set Proxy URL to https://www.anima-protocol.com/api/__clerk, " +
    "and add the sign-in/sso-callback redirect URLs."
  );
}

function SocialAuthButtons({ mode }) {
  const clerk = useClerk();
  const { signIn, fetchStatus } = useSignIn();
  const [pendingStrategy, setPendingStrategy] = useState(null);
  const [enabledStrategies, setEnabledStrategies] = useState(null);

  useEffect(() => {
    if (!clerk.loaded) {
      setEnabledStrategies(null);
      return;
    }
    const syncStrategies = () => {
      setEnabledStrategies(getEnabledOAuthStrategies(clerk));
    };
    syncStrategies();
    return clerk.addListener(syncStrategies);
  }, [clerk, clerk.loaded]);

  const providers = useMemo(() => {
    if (!clerk.loaded) return [];
    if (!Array.isArray(enabledStrategies)) return [];
    const enabled = filterProvidersByEnvList(
      socialAuthProviders.filter((provider) =>
        enabledStrategies.includes(provider.strategy),
      ),
    );
    return enabled;
  }, [clerk.loaded, enabledStrategies]);

  const githubMissing =
    clerk.loaded &&
    Array.isArray(enabledStrategies) &&
    !enabledStrategies.includes("oauth_github");

  const handleOAuth = async (strategy) => {
    if (!clerk.loaded || fetchStatus === "fetching") {
      return;
    }
    setPendingStrategy(strategy);
    const redirectCallbackUrl = oauthRedirectUrl(oauthCallbackPath(mode));
    const redirectUrl = oauthRedirectUrl(authRedirectCompleteUrl);
    try {
      // OAuth sign-up/sign-in share one transferable flow; always start from signIn.
      const { error } = await signIn.sso({
        strategy,
        redirectCallbackUrl,
        redirectUrl,
      });
      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("OAuth redirect failed", error);
      const providerName =
        socialAuthProviders.find((provider) => provider.strategy === strategy)
          ?.label ?? "That provider";
      const detail = formatClerkOAuthError(error);
      toast.error(
        detail
          ? `${detail} ${clerkGitHubSetupHint()}`
          : `${providerName} is not enabled for this Clerk ${clerkInstanceLabel()} instance. ${clerkGitHubSetupHint()}`,
      );
      setPendingStrategy(null);
    }
  };

  return (
    <div className="w-full space-y-2">
      {!clerk.loaded ? (
        <p className="py-2 text-center text-sm text-cyan-400/50">
          Loading sign-in options…
        </p>
      ) : providers.length === 0 ? (
        <p className="py-2 text-center text-sm text-cyan-400/50">
          No social sign-in providers configured in Clerk yet.
        </p>
      ) : (
        providers.map(({ label, strategy, Icon }) => (
          <button
            key={strategy}
            type="button"
            disabled={Boolean(pendingStrategy) || fetchStatus === "fetching"}
            onClick={() => handleOAuth(strategy)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded border border-cyan-400/30 bg-cyan-400/5 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>
              {pendingStrategy === strategy ? "Redirecting..." : label}
            </span>
          </button>
        ))
      )}
      {githubMissing ? (
        <p className="pt-2 text-center text-xs leading-relaxed text-amber-300/80">
          GitHub is not active for this Clerk {clerkInstanceLabel()} instance
          yet. {clerkGitHubSetupHint()}{" "}
          <a
            href={CLERK_SSO_DASHBOARD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 underline hover:text-cyan-200"
          >
            Open Clerk SSO settings
          </a>
        </p>
      ) : null}
    </div>
  );
}

function AuthFormShell({ mode, children }) {
  return (
    <div className="flex min-h-screen-safe items-center justify-center bg-background px-4">
      <div className="w-[420px] max-w-full space-y-3">
        <div className="rounded-md border border-cyan-400/30 bg-[#090912] p-4 shadow-[0_0_40px_rgba(34,211,238,0.12)]">
          <SocialAuthButtons mode={mode} />
          <p className="mt-3 text-center text-xs text-cyan-400/45">
            {mode === "sign-in"
              ? "Use GitHub if that is how you created your account. You can also sign in with email below."
              : "Or continue with email below."}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function SignInPage() {
  usePageMeta(ROUTE_META["/sign-in"]);
  return (
    <AuthFormShell mode="sign-in">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        oauthFlow="redirect"
        transferable
        fallbackRedirectUrl={authRedirectCompleteUrl}
        forceRedirectUrl={authRedirectCompleteUrl}
      />
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

// First-run gate for signed-in users: if they have not yet awakened an Anima,
// show the Serenity-led onboarding. Once an Anima exists, load their dashboard.
// Fails open to the dashboard so a transient lookup error never traps the user.
function SignedInHome() {
  const [state, setState] = useState("checking"); // 'checking' | 'onboarding' | 'home'

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setState("home");
    }, 12000);
    (async () => {
      try {
        const animas = await base44.entities.Anima.list("-created_date", 1);
        if (!cancelled) {
          setState((animas?.length || 0) > 0 ? "home" : "onboarding");
        }
      } catch {
        if (!cancelled) setState("home");
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  if (state === "checking") return <PageLoader />;
  return (
    <Suspense fallback={<PageLoader />}>
      {state === "onboarding" ? (
        <OnboardingFlow onComplete={() => setState("home")} />
      ) : (
        <MainHome />
      )}
    </Suspense>
  );
}

// Public landing for signed-out users; full app home for signed-in users.
function HomeGate() {
  return (
    <>
      <Show when="signed-in">
        <SignedInHome />
      </Show>
      <Show when="signed-out">
        <Suspense fallback={<PageLoader />}>
          <Landing />
        </Suspense>
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes({ children }) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      {...(clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : {})}
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
      <ClerkQueryClientCacheInvalidator />
      {children}
    </ClerkProvider>
  );
}

// Public routes that signed-out users may reach without authentication.
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/terms",
  "/privacy-policy",
  "/disclaimer",
];

const AuthenticatedApp = () => {
  const {
    isLoadingAuth,
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
  const [authWaitExpired, setAuthWaitExpired] = useState(false);

  useEffect(() => {
    if (!isLoadingAuth) {
      setAuthWaitExpired(false);
      return;
    }
    const timer = setTimeout(() => setAuthWaitExpired(true), 15000);
    return () => clearTimeout(timer);
  }, [isLoadingAuth]);

  if (authError) {
    if (authError.type === "user_not_registered") {
      return <UserNotRegisteredError />;
    } else if (authError.type === "auth_required") {
      return <Landing />;
    }
  }

  // Wait for Clerk to resolve the session before deciding what to show.
  if (isLoadingAuth && !authWaitExpired) {
    return <PageLoader />;
  }

  // Gate protected routes: signed-out users are sent to the public Landing.
  const pathname = location.pathname;
  const isPublicPath =
    pathname === "/" ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isAuthenticated && !isPublicPath) {
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
              <Route path="/sign-in/*" element={<SignInPage />} />
              <Route path="/sign-up/*" element={<SignUpPage />} />
              <Route
                path="/sso-callback/*"
                element={<Navigate to="/sign-in/sso-callback" replace />}
              />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route
                path="/chat"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <NewChat />
                  </Suspense>
                }
              />
              <Route
                path="/chat/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Chat />
                  </Suspense>
                }
              />
              <Route
                path="/codespace"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Codespace />
                  </Suspense>
                }
              />

              {/* Everything else remains as-is */}
              <Route
                path="/onboarding"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <OnboardingFlow />
                  </Suspense>
                }
              />
              <Route
                path="/legacy-onboarding"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Onboarding />
                  </Suspense>
                }
              />
              <Route
                path="/mode-select"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <ModeSelect />
                  </Suspense>
                }
              />
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route
                path="/check-in"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CheckIn />
                  </Suspense>
                }
              />
              <Route
                path="/reflection-log"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <ReflectionLog />
                  </Suspense>
                }
              />
              <Route
                path="/characters"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Characters />
                  </Suspense>
                }
              />
              <Route
                path="/groups"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterGroups />
                  </Suspense>
                }
              />
              <Route
                path="/storyboard"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Storyboard />
                  </Suspense>
                }
              />
              <Route
                path="/storyboard-manager/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryboardManager />
                  </Suspense>
                }
              />
              <Route
                path="/network"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Network />
                  </Suspense>
                }
              />
              <Route
                path="/settings"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Settings />
                  </Suspense>
                }
              />
              <Route
                path="/profile"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <UserProfile />
                  </Suspense>
                }
              />
              <Route
                path="/origins"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <HallOfOrigins />
                  </Suspense>
                }
              />
              <Route
                path="/memory-crystals"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <MemoryCrystals />
                  </Suspense>
                }
              />
              <Route
                path="/constellation"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <ConstellationMap />
                  </Suspense>
                }
              />
              <Route
                path="/book-of-echoes"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <BookOfEchoes />
                  </Suspense>
                }
              />
              <Route
                path="/animas"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Animas />
                  </Suspense>
                }
              />
              <Route
                path="/lorebook"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LoreBook />
                  </Suspense>
                }
              />
              <Route
                path="/worldmap"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldMap />
                  </Suspense>
                }
              />
              <Route
                path="/journals"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Journals />
                  </Suspense>
                }
              />
              <Route
                path="/wiki"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Wiki />
                  </Suspense>
                }
              />
              <Route
                path="/narrative"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <NarrativeProgress />
                  </Suspense>
                }
              />
              <Route
                path="/flowchart"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryFlowchart />
                  </Suspense>
                }
              />
              <Route
                path="/relationships"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipNetwork />
                  </Suspense>
                }
              />
              <Route
                path="/graph"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterGraphVisualization />
                  </Suspense>
                }
              />
              <Route
                path="/archive"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LoreArchive />
                  </Suspense>
                }
              />
              <Route
                path="/insights"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Insights />
                  </Suspense>
                }
              />
              <Route
                path="/reflections"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Reflections />
                  </Suspense>
                }
              />
              <Route
                path="/discoveries"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <DiscoveryQueue />
                  </Suspense>
                }
              />
              <Route
                path="/locationsmap"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LocationsMap />
                  </Suspense>
                }
              />
              <Route
                path="/relationshipviz"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipVisualization />
                  </Suspense>
                }
              />
              <Route
                path="/globalwiki"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <GlobalWiki />
                  </Suspense>
                }
              />
              <Route
                path="/worldcalendar"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldCalendar />
                  </Suspense>
                }
              />
              <Route
                path="/worldcodex"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldCodex />
                  </Suspense>
                }
              />
              <Route
                path="/relationshipgraph"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipGraph />
                  </Suspense>
                }
              />
              <Route
                path="/inventory"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <InventoryPanel />
                  </Suspense>
                }
              />
              <Route
                path="/calenderview"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CalendarView />
                  </Suspense>
                }
              />
              <Route
                path="/branching"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryBranching />
                  </Suspense>
                }
              />
              <Route
                path="/memory-map"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterMemoryMap />
                  </Suspense>
                }
              />
              <Route
                path="/world-pulse"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldPulse />
                  </Suspense>
                }
              />
              <Route
                path="/branching-map"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <NarrativeBranchingMap />
                  </Suspense>
                }
              />
              <Route
                path="/relationship-graph"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipGraphPage />
                  </Suspense>
                }
              />
              <Route
                path="/yn-library"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <YnStoriesLibrary />
                  </Suspense>
                }
              />
              <Route
                path="/world-timeline"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldTimeline />
                  </Suspense>
                }
              />
              <Route
                path="/characters-repository"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterRepository />
                  </Suspense>
                }
              />
              <Route
                path="/analytics"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryAnalyticsDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/faction-network"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <FactionNetwork />
                  </Suspense>
                }
              />
              <Route
                path="/story-control"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <NarrativeFlowchartPage />
                  </Suspense>
                }
              />
              <Route
                path="/character-memories"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterMemories />
                  </Suspense>
                }
              />
              <Route
                path="/customize"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterCustomization />
                  </Suspense>
                }
              />
              <Route
                path="/orchestrate/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SceneOrchestrator />
                  </Suspense>
                }
              />
              <Route
                path="/memory-graph/:characterId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <MemoryGraphDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/create-scenario"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CreateScenario />
                  </Suspense>
                }
              />
              <Route
                path="/quests/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <QuestTrackingDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/looks"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterLookCustomizer />
                  </Suspense>
                }
              />
              <Route
                path="/ai-behavior"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <AIBehaviorSettings />
                  </Suspense>
                }
              />
              <Route
                path="/dashboard/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipAndLocationDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/graph-visualization"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <InteractiveGraphVisualization />
                  </Suspense>
                }
              />
              <Route
                path="/graph-visualization/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <InteractiveGraphVisualization />
                  </Suspense>
                }
              />
              <Route
                path="/integrated-calendar"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <IntegratedWorldCalendar />
                  </Suspense>
                }
              />
              <Route
                path="/integrated-calendar/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <IntegratedWorldCalendar />
                  </Suspense>
                }
              />
              <Route
                path="/quest-log"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <QuestLog />
                  </Suspense>
                }
              />
              <Route
                path="/quest-log/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <QuestLog />
                  </Suspense>
                }
              />
              <Route
                path="/memories"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CharacterMemoriesDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/story-branching/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryBranchingGraph />
                  </Suspense>
                }
              />
              <Route
                path="/story-branching"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryBranchingGraph />
                  </Suspense>
                }
              />
              <Route
                path="/world-calendar-dashboard"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldCalendarDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/world-calendar-dashboard/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WorldCalendarDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/conflict-dashboard"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <NarrativeConflictDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/interactive-inventory"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <InteractiveInventory />
                  </Suspense>
                }
              />
              <Route
                path="/interactive-inventory/:sessionId/:characterId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <InteractiveInventory />
                  </Suspense>
                }
              />
              <Route
                path="/quest-log-page"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <QuestLogPage />
                  </Suspense>
                }
              />
              <Route
                path="/quest-log-page/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <QuestLogPage />
                  </Suspense>
                }
              />
              <Route
                path="/lore-archives"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LoreArchivesDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/meditation"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Meditation />
                  </Suspense>
                }
              />
              <Route
                path="/subscription"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Subscription />
                  </Suspense>
                }
              />
              <Route
                path="/lifetime-access"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LifetimeAccess />
                  </Suspense>
                }
              />
              <Route
                path="/narrative-world-map/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <NarrativeWorldMap />
                  </Suspense>
                }
              />
              <Route
                path="/companion-generator"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CompanionGenerator />
                  </Suspense>
                }
              />
              <Route
                path="/what-if"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <WhatIfScenarios />
                  </Suspense>
                }
              />
              <Route
                path="/story-reader/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <StoryReader />
                  </Suspense>
                }
              />
              <Route
                path="/quest-journal"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <QuestJournal />
                  </Suspense>
                }
              />
              <Route
                path="/timeline/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <TimelineDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/relationship-graph/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipNodeGraphPage />
                  </Suspense>
                }
              />
              <Route
                path="/relationship-graph"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <RelationshipNodeGraphPage />
                  </Suspense>
                }
              />
              <Route
                path="/terms"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <TermsOfUse />
                  </Suspense>
                }
              />
              <Route
                path="/chronicles"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Chronicles />
                  </Suspense>
                }
              />
              <Route
                path="/privacy-policy"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <PrivacyPolicy />
                  </Suspense>
                }
              />
              <Route
                path="/disclaimer"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Disclaimer />
                  </Suspense>
                }
              />
              <Route
                path="/progress"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <ProgressDashboard />
                  </Suspense>
                }
              />
              <Route
                path="/premium"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <PremiumPlans />
                  </Suspense>
                }
              />
              <Route
                path="/templates"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <TemplateHub />
                  </Suspense>
                }
              />
              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </ErrorBoundary>
        </motion.div>
      </AnimatePresence>
      {showChrome && <BottomTabBar />}
    </>
  );
};

function App() {
  useViewportHeight();
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ClerkProviderWithRoutes>
          <AuthProvider>
            <ConfirmProvider>
              <InAppBrowserWarning />
              <TapTargetValidator />
              <div
                className="flex flex-col h-screen-safe"
                style={{
                  paddingTop: "env(safe-area-inset-top, 0px)",
                  paddingBottom: "env(safe-area-inset-bottom, 0px)",
                }}
              >
                <AuthenticatedApp />
              </div>
            </ConfirmProvider>
          </AuthProvider>
        </ClerkProviderWithRoutes>
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

export default App;
