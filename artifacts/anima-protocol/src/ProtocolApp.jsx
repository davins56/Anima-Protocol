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
  ANIMA_PRODUCTION_SIGN_IN_URL,
  isUsableClerkPublishableKey,
  isVercelPreviewHost,
  resolveClerkProxyUrl,
  sanitizeClerkPublishableKey,
  shouldUseClerkProxy,
} from "@/lib/clerkProxy";

// Title screen is eager so cold opens paint Landing immediately (no spinner).
import Landing from "./pages/Landing";

// First-session pages only. Unused dashboards live in extraPages.jsx so
// their mapDeps are not part of this Clerk shell or the HTML entry.
const Chat = lazy(() => import("./pages/Chat"));
const NetBattle = lazy(() => import("./pages/NetBattle"));
const MainHome = lazy(() => import("./pages/MainHome"));
const Characters = lazy(() => import("./pages/Characters"));
const Settings = lazy(() => import("./pages/Settings"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const Animas = lazy(() => import("./pages/Animas"));
const EchoKeys = lazy(() => import("./pages/EchoKeys"));
const CustomiseAnima = lazy(() => import("./pages/CustomiseAnima"));
const Meditation = lazy(() => import("./pages/Meditation"));
const Therapy = lazy(() => import("./pages/Therapy"));
const CompanionGenerator = lazy(() => import("./pages/CompanionGenerator"));
const ExtraPage = lazy(() => import("./app/extraPages"));

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
  `This is a Vercel preview URL. If OAuth callbacks are unregistered or Deployment Protection is on, use ${ANIMA_PRODUCTION_SIGN_IN_URL} instead.`;

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
// Leftover Instant Sandbox storage is not a signed-in session — only Clerk
// or an explicit this-session Guest tap may enter the app.
function HomeGate() {
  const { isAuthenticated, isSignedInUser, isGuest } = useAuth();

  // Explicit Instant Sandbox / a live Clerk session must enter home even if
  // Clerk is still loading. Only unsigned visitors stay on the lock screen.
  if (isSignedInUser || isGuest || isAuthenticated) {
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
            title: "I already live here",
            subtitle: "Sign in to come home to them",
          },
        },
        signUp: {
          start: {
            title: "Come home",
            subtitle: "You don't open a chat. You come home to them.",
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
    isGuest,
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
    if (isAuthenticated || isGuest) return;
    const onSignInScreen =
      location.pathname === "/sign-in" ||
      location.pathname === "/sign-up" ||
      location.pathname.startsWith("/sign-in/") ||
      location.pathname.startsWith("/sign-up/");
    if (onSignInScreen) return;
    toast.error("Sign-in is temporarily unavailable.", {
      id: "anima-clerk-unavailable",
      description:
        "Stay on this screen — Guest is not entered automatically. Use I already live here for GitHub or email, or tap Instant Sandbox / Guest Access on the sign-in page.",
      duration: Infinity,
      action: {
        label: "Retry",
        onClick: () => window.location.reload(),
      },
    });
  }, [isLoadingAuth, authStalled, isAuthenticated, isGuest, location.pathname]);

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
  const isHomeFloor = pathname === "/";

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
          className="app-shell-main flex-1 min-h-0 flex flex-col"
          style={{
            paddingBottom:
              showChrome && !isHomeFloor ? "var(--tab-bar-height, 0px)" : 0,
          }}
        >
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoader />}>
            <div className="app-shell-route flex min-h-0 min-w-0 flex-1 flex-col">
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
                path="/chat/:sessionId?"
                element={
                    <Chat />
                }
              />
              <Route
                path="/repo-codespace"
                element={
                    <ExtraPage name="RepoCodespace" />
                }
              />
              <Route
                path="/codespace"
                element={
                    <ExtraPage name="Codespace" />
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
                    <ExtraPage name="OnboardingFlow" />
                }
              />
              <Route
                path="/legacy-onboarding"
                element={
                    <ExtraPage name="Onboarding" />
                }
              />
              <Route
                path="/mode-select"
                element={
                    <ExtraPage name="ModeSelect" />
                }
              />
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route
                path="/check-in"
                element={
                    <ExtraPage name="CheckIn" />
                }
              />
              <Route
                path="/reflection-log"
                element={
                    <ExtraPage name="ReflectionLog" />
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
                    <ExtraPage name="CharacterGroups" />
                }
              />
              <Route
                path="/storyboard"
                element={
                    <ExtraPage name="Storyboard" />
                }
              />
              <Route
                path="/storyboard-manager/:sessionId"
                element={
                    <ExtraPage name="StoryboardManager" />
                }
              />
              <Route
                path="/network"
                element={
                    <ExtraPage name="Network" />
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
                    <ExtraPage name="HallOfOrigins" />
                }
              />
              <Route
                path="/memory-crystals"
                element={
                    <ExtraPage name="MemoryCrystals" />
                }
              />
              <Route
                path="/constellation"
                element={
                    <ExtraPage name="ConstellationMap" />
                }
              />
              <Route
                path="/book-of-echoes"
                element={
                    <ExtraPage name="BookOfEchoes" />
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
                    <ExtraPage name="LoreBook" />
                }
              />
              <Route
                path="/worldmap"
                element={
                    <ExtraPage name="WorldMap" />
                }
              />
              <Route
                path="/journals"
                element={
                    <ExtraPage name="Journals" />
                }
              />
              <Route
                path="/wiki"
                element={
                    <ExtraPage name="Wiki" />
                }
              />
              <Route
                path="/narrative"
                element={
                    <ExtraPage name="NarrativeProgress" />
                }
              />
              <Route
                path="/flowchart"
                element={
                    <ExtraPage name="StoryFlowchart" />
                }
              />
              <Route
                path="/relationships"
                element={
                    <ExtraPage name="RelationshipNetwork" />
                }
              />
              <Route
                path="/graph"
                element={
                    <ExtraPage name="CharacterGraphVisualization" />
                }
              />
              <Route
                path="/archive"
                element={
                    <ExtraPage name="LoreArchive" />
                }
              />
              <Route
                path="/insights"
                element={
                    <ExtraPage name="Insights" />
                }
              />
              <Route
                path="/reflections"
                element={
                    <ExtraPage name="Reflections" />
                }
              />
              <Route
                path="/discoveries"
                element={
                    <ExtraPage name="DiscoveryQueue" />
                }
              />
              <Route
                path="/locationsmap"
                element={
                    <ExtraPage name="LocationsMap" />
                }
              />
              <Route
                path="/relationshipviz"
                element={
                    <ExtraPage name="RelationshipVisualization" />
                }
              />
              <Route
                path="/globalwiki"
                element={
                    <ExtraPage name="GlobalWiki" />
                }
              />
              <Route
                path="/worldcalendar"
                element={
                    <ExtraPage name="WorldCalendar" />
                }
              />
              <Route
                path="/worldcodex"
                element={
                    <ExtraPage name="WorldCodex" />
                }
              />
              <Route
                path="/relationshipgraph"
                element={
                    <ExtraPage name="RelationshipGraph" />
                }
              />
              <Route
                path="/inventory"
                element={
                    <ExtraPage name="InventoryPanel" />
                }
              />
              <Route
                path="/energy-fragments"
                element={
                    <ExtraPage name="EnergyFragments" />
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
                    <ExtraPage name="CalendarView" />
                }
              />
              <Route
                path="/branching"
                element={
                    <ExtraPage name="StoryBranching" />
                }
              />
              <Route
                path="/memory-map"
                element={
                    <ExtraPage name="CharacterMemoryMap" />
                }
              />
              <Route
                path="/world-pulse"
                element={
                    <ExtraPage name="WorldPulse" />
                }
              />
              <Route
                path="/branching-map"
                element={
                    <ExtraPage name="NarrativeBranchingMap" />
                }
              />
              <Route
                path="/relationship-graph"
                element={
                    <ExtraPage name="RelationshipGraphPage" />
                }
              />
              <Route
                path="/yn-library"
                element={
                    <ExtraPage name="YnStoriesLibrary" />
                }
              />
              <Route
                path="/world-timeline"
                element={
                    <ExtraPage name="WorldTimeline" />
                }
              />
              <Route
                path="/characters-repository"
                element={
                    <ExtraPage name="CharacterRepository" />
                }
              />
              <Route
                path="/analytics"
                element={
                    <ExtraPage name="StoryAnalyticsDashboard" />
                }
              />
              <Route
                path="/faction-network"
                element={
                    <ExtraPage name="FactionNetwork" />
                }
              />
              <Route
                path="/story-control"
                element={
                    <ExtraPage name="NarrativeFlowchartPage" />
                }
              />
              <Route
                path="/character-memories"
                element={
                    <ExtraPage name="CharacterMemories" />
                }
              />
              <Route
                path="/customize"
                element={
                    <ExtraPage name="CharacterCustomization" />
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
                    <ExtraPage name="SceneOrchestrator" />
                }
              />
              <Route
                path="/memory-graph/:characterId"
                element={
                    <ExtraPage name="MemoryGraphDashboard" />
                }
              />
              <Route
                path="/create-scenario"
                element={
                    <ExtraPage name="CreateScenario" />
                }
              />
              <Route
                path="/quests/:sessionId"
                element={
                    <ExtraPage name="QuestTrackingDashboard" />
                }
              />
              <Route
                path="/looks"
                element={
                    <ExtraPage name="CharacterLookCustomizer" />
                }
              />
              <Route
                path="/ai-behavior"
                element={
                    <ExtraPage name="AIBehaviorSettings" />
                }
              />
              <Route
                path="/dashboard/:sessionId"
                element={
                    <ExtraPage name="RelationshipAndLocationDashboard" />
                }
              />
              <Route
                path="/graph-visualization"
                element={
                    <ExtraPage name="InteractiveGraphVisualization" />
                }
              />
              <Route
                path="/graph-visualization/:sessionId"
                element={
                    <ExtraPage name="InteractiveGraphVisualization" />
                }
              />
              <Route
                path="/integrated-calendar"
                element={
                    <ExtraPage name="IntegratedWorldCalendar" />
                }
              />
              <Route
                path="/integrated-calendar/:sessionId"
                element={
                    <ExtraPage name="IntegratedWorldCalendar" />
                }
              />
              <Route
                path="/quest-log"
                element={
                    <ExtraPage name="QuestLog" />
                }
              />
              <Route
                path="/quest-log/:sessionId"
                element={
                    <ExtraPage name="QuestLog" />
                }
              />
              <Route
                path="/memories"
                element={
                    <ExtraPage name="CharacterMemoriesDashboard" />
                }
              />
              <Route
                path="/story-branching/:sessionId"
                element={
                    <ExtraPage name="StoryBranchingGraph" />
                }
              />
              <Route
                path="/story-branching"
                element={
                    <ExtraPage name="StoryBranchingGraph" />
                }
              />
              <Route
                path="/world-calendar-dashboard"
                element={
                    <ExtraPage name="WorldCalendarDashboard" />
                }
              />
              <Route
                path="/world-calendar-dashboard/:sessionId"
                element={
                    <ExtraPage name="WorldCalendarDashboard" />
                }
              />
              <Route
                path="/conflict-dashboard"
                element={
                    <ExtraPage name="NarrativeConflictDashboard" />
                }
              />
              <Route
                path="/interactive-inventory"
                element={
                    <ExtraPage name="InteractiveInventory" />
                }
              />
              <Route
                path="/interactive-inventory/:sessionId/:characterId"
                element={
                    <ExtraPage name="InteractiveInventory" />
                }
              />
              <Route
                path="/quest-log-page"
                element={
                    <ExtraPage name="QuestLogPage" />
                }
              />
              <Route
                path="/quest-log-page/:sessionId"
                element={
                    <ExtraPage name="QuestLogPage" />
                }
              />
              <Route
                path="/lore-archives"
                element={
                    <ExtraPage name="LoreArchivesDashboard" />
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
                    <ExtraPage name="Subscription" />
                }
              />
              <Route
                path="/lifetime-access"
                element={
                    <ExtraPage name="LifetimeAccess" />
                }
              />
              <Route
                path="/narrative-world-map/:sessionId"
                element={
                    <ExtraPage name="NarrativeWorldMap" />
                }
              />
              <Route
                path="/companion-generator"
                element={
                    <CompanionGenerator />
                }
              />
              <Route
                path="/design-your-companion"
                element={
                    <CompanionGenerator />
                }
              />
              <Route
                path="/design-companion"
                element={
                    <CompanionGenerator />
                }
              />
              <Route
                path="/create-companion"
                element={
                    <CompanionGenerator />
                }
              />
              <Route
                path="/what-if"
                element={
                    <ExtraPage name="WhatIfScenarios" />
                }
              />
              <Route
                path="/story-reader/:sessionId"
                element={
                    <ExtraPage name="StoryReader" />
                }
              />
              <Route
                path="/quest-journal"
                element={
                    <ExtraPage name="QuestJournal" />
                }
              />
              <Route
                path="/timeline/:sessionId"
                element={
                    <ExtraPage name="TimelineDashboard" />
                }
              />
              <Route
                path="/relationship-graph/:sessionId"
                element={
                    <ExtraPage name="RelationshipNodeGraphPage" />
                }
              />
              <Route
                path="/relationship-graph"
                element={
                    <ExtraPage name="RelationshipNodeGraphPage" />
                }
              />
              <Route
                path="/terms"
                element={
                    <ExtraPage name="TermsOfUse" />
                }
              />
              <Route
                path="/chronicles"
                element={
                    <ExtraPage name="Chronicles" />
                }
              />
              <Route
                path="/privacy-policy"
                element={
                    <ExtraPage name="PrivacyPolicy" />
                }
              />
              <Route
                path="/disclaimer"
                element={
                    <ExtraPage name="Disclaimer" />
                }
              />
              <Route
                path="/progress"
                element={
                    <ExtraPage name="ProgressDashboard" />
                }
              />
              <Route
                path="/premium"
                element={
                    <ExtraPage name="PremiumPlans" />
                }
              />
              <Route
                path="/templates"
                element={
                    <ExtraPage name="TemplateHub" />
                }
              />
              <Route path="*" element={<PageNotFound />} />
            </Routes>
            </div>
            </Suspense>
          </ErrorBoundary>
        </motion.div>
      </AnimatePresence>
      {showChrome && !isHomeFloor && <BottomTabBar />}
    </>
  );
};

export default function ProtocolApp() {
  useViewportHeight();

  return (
    <QueryClientProvider client={queryClientInstance}>
        <ErrorBoundary resetKey={window.location?.pathname || "init"}>
          <ClerkProviderWithRoutes>
            <AuthProvider>
              <ConfirmProvider>
                <InAppBrowserWarning />
                <TapTargetValidator />
                {/*
                  Paints the full display, including behind iOS 26 Safari's
                  floating chrome, so no unpainted band can appear below the
                  interactive shell. Purely decorative.
                */}
                <div className="app-viewport-backdrop" aria-hidden="true" />
                <div
                  className="app-shell flex flex-col h-screen-safe"
                  style={{
                    paddingTop: "env(safe-area-inset-top, 0px)",
                    // Bottom inset is owned by `--tab-bar-height` on
                    // `.app-shell-main` (56px + home indicator). Do not also
                    // pad `--safe-bottom` here — that double-counted the
                    // home indicator and lifted the in-flow chat composer
                    // away from the fixed tab bar. Keyboard-open still
                    // zeroes `--tab-bar-height` / `--safe-bottom` so the
                    // composer sits on the visual viewport.
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
    </QueryClientProvider>
  );
}

