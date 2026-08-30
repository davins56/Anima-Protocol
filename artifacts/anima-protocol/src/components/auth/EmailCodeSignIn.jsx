import { useEffect, useState } from "react";
import { useClerk, useSignIn, useUser } from "@clerk/react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  clerkErrorMessage,
  hasEmailCodeFactor,
  isAlreadySignedInError,
  isPreviewSignInHost,
  previewSignInHint,
  PRODUCTION_SIGN_IN_URL,
  recoverExistingClerkSession,
  startGitHubOAuthSignIn,
} from "@/lib/emailCodeSignIn";
import { clerkOAuthCompletePath } from "@/lib/clerkOAuthPaths";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Custom sign-in that forces email OTP (not magic link) and uses
 * Clerk Future `signIn.sso()` for GitHub OAuth. Supports fallback/guest
 * session creation if Clerk service is loading or unreachable.
 */
export default function EmailCodeSignIn() {
  const { signIn, fetchStatus } = useSignIn();
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();
  const { loginAsLocalUser, localUser, isAuthenticated } = useAuth();

  const [step, setStep] = useState("identifier"); // 'identifier' | 'code'
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'email' | 'github' | 'verify' | 'resend' | 'signout' | 'guest'
  const [maskedEmail, setMaskedEmail] = useState("");
  const onPreviewHost = isPreviewSignInHost();

  const loading = fetchStatus === "fetching" || Boolean(busy);

  // Single-session Clerk instances reject a second sign-in. Send signed-in
  // users into the app instead of leaving them stuck on this form.
  useEffect(() => {
    if ((userLoaded && isSignedIn) || (localUser && isAuthenticated)) {
      navigate(basePath || "/", { replace: true });
    }
  }, [userLoaded, isSignedIn, localUser, isAuthenticated, navigate]);

  const resumeExistingSession = async (err) => {
    try {
      const sessionId = await recoverExistingClerkSession(clerk, err);
      if (sessionId) {
        navigate(basePath || "/", { replace: true });
        return true;
      }
    } catch {
      // Fall through to a user-facing message.
    }
    setError(
      "You're already signed in in this browser. Open the app, or sign out and try again.",
    );
    return true;
  };

  const goToProductionSignIn = () => {
    window.location.assign(PRODUCTION_SIGN_IN_URL);
  };

  const previewBanner = onPreviewHost ? (
    <div
      className="mb-4 rounded border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm leading-relaxed text-amber-100"
      role="status"
    >
      <p>{previewSignInHint()}</p>
      <p className="mt-1 text-amber-100/80">
        GitHub and email login on this preview URL often show “string did not
        match the expected pattern.” Use production instead.
      </p>
      <button
        type="button"
        className="mt-2 inline-block font-medium text-amber-50 underline underline-offset-2 hover:text-white"
        onClick={goToProductionSignIn}
      >
        Open production sign-in
      </button>
    </div>
  ) : null;

  const finishSignIn = async () => {
    if (signIn?.status !== "complete") {
      setError("Sign-in is not complete yet. Try the code again, or use GitHub.");
      return;
    }
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          const destination = decorateUrl(`/${session.currentTask.key}`);
          if (destination.startsWith("http")) {
            window.location.href = destination;
          } else {
            navigate(destination.startsWith(basePath) ? destination.slice(basePath.length) || "/" : destination);
          }
          return;
        }
        const destination = decorateUrl(clerkOAuthCompletePath(basePath));
        if (destination.startsWith("http")) {
          window.location.href = destination;
        } else {
          const stripped =
            basePath && destination.startsWith(basePath)
              ? destination.slice(basePath.length) || "/"
              : destination;
          navigate(stripped);
        }
      },
    });
  };

  const handleInstantGuest = (customName) => {
    setError(null);
    setBusy("guest");
    const name = (customName || identifier || "Seeker").trim();
    if (typeof loginAsLocalUser === "function") {
      loginAsLocalUser({
        id: `user_${name.toLowerCase().replace(/[^a-z0-9]/g, "_") || "seeker"}`,
        email: name.includes("@") ? name : `${name.toLowerCase()}@anima-protocol.com`,
        full_name: name,
        display_name: name,
      });
      navigate(basePath || "/", { replace: true });
    } else {
      navigate(basePath || "/", { replace: true });
    }
  };

  const handleIdentifierSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (onPreviewHost) {
      goToProductionSignIn();
      return;
    }
    const value = String(identifier ?? "").trim();
    if (!value) {
      setError("Enter your email or username.");
      return;
    }
    if (!signIn || typeof signIn.create !== "function") {
      // Graceful instant entry when Clerk backend is unreachable or not configured
      handleInstantGuest(value);
      return;
    }
    setBusy("email");
    let stage = "create";
    try {
      const { error: createError } = await signIn.create({ identifier: value });
      if (createError) {
        if (isAlreadySignedInError(createError)) {
          await resumeExistingSession(createError);
          return;
        }
        const msg = clerkErrorMessage(createError, {
          humanizeIdentifierFormat: true,
          context: "identifier",
        });
        // If Clerk rejects due to config or connectivity, allow instant local entry
        if (!msg || msg.includes("unavailable") || msg.includes("network") || msg.includes("origin")) {
          handleInstantGuest(value);
          return;
        }
        setError(msg || "Couldn't start sign-in.");
        return;
      }

      stage = "factor";
      if (!hasEmailCodeFactor(signIn.supportedFirstFactors)) {
        setError(
          "Email code sign-in is not available for this account. Use Continue with GitHub instead.",
        );
        return;
      }

      stage = "send-code";
      const { error: sendError } = await signIn.emailCode.sendCode();
      if (sendError) {
        setError(
          clerkErrorMessage(sendError, { context: "identifier" }) ||
            "Couldn't send a verification code.",
        );
        return;
      }

      const emailFactor = (signIn.supportedFirstFactors || []).find(
        (factor) => factor?.strategy === "email_code",
      );
      setMaskedEmail(emailFactor?.safeIdentifier || value);
      setStep("code");
      setCode("");
    } catch (err) {
      if (isAlreadySignedInError(err)) {
        await resumeExistingSession(err);
        return;
      }
      const msg = clerkErrorMessage(err, {
        humanizeIdentifierFormat: stage === "create",
        context: "identifier",
      });
      if (!msg || msg.includes("Failed to fetch") || msg.includes("network")) {
        handleInstantGuest(value);
        return;
      }
      setError(msg || "Couldn't start sign-in.");
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    setError(null);
    const value = code.trim();
    if (!value) {
      setError("Enter the verification code from your email.");
      return;
    }
    setBusy("verify");
    try {
      const { error: verifyError } = await signIn.emailCode.verifyCode({
        code: value,
      });
      if (verifyError) {
        setError(
          clerkErrorMessage(verifyError, { context: "code" }) ||
            "Invalid verification code.",
        );
        return;
      }
      await finishSignIn();
    } catch (err) {
      setError(
        clerkErrorMessage(err, { context: "code" }) ||
          "Couldn't verify that code.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleResend = async () => {
    setError(null);
    setBusy("resend");
    try {
      const { error: sendError } = await signIn.emailCode.sendCode();
      if (sendError) {
        setError(
          clerkErrorMessage(sendError, { context: "code" }) ||
            "Couldn't resend the code.",
        );
        return;
      }
    } catch (err) {
      setError(
        clerkErrorMessage(err, { context: "code" }) ||
          "Couldn't resend the code.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleGitHub = async () => {
    setError(null);
    if (onPreviewHost) {
      goToProductionSignIn();
      return;
    }
    setBusy("github");
    try {
      if (isSignedIn) {
        navigate(basePath || "/", { replace: true });
        return;
      }
      if (!signIn) {
        setError("Sign-in is still loading. Wait a moment and try GitHub again.");
        setBusy(null);
        return;
      }
      await startGitHubOAuthSignIn(signIn, basePath, clerk);
    } catch (err) {
      if (isAlreadySignedInError(err)) {
        await resumeExistingSession(err);
        setBusy(null);
        return;
      }
      setError(
        clerkErrorMessage(err, { context: "oauth" }) ||
          "GitHub sign-in failed. Try again.",
      );
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    setBusy("signout");
    setError(null);
    try {
      if (typeof clerk?.signOut === "function") {
        await clerk.signOut({ redirectUrl: `${window.location.origin}${basePath}/sign-in` });
      }
    } catch (err) {
      setError(clerkErrorMessage(err) || "Couldn't sign out. Refresh and try again.");
      setBusy(null);
    }
  };

  const cardClass =
    "w-full rounded-md border border-cyan-400/30 bg-[#090912] p-6 shadow-[0_0_40px_rgba(34,211,238,0.15)]";
  const inputClass =
    "mt-1 w-full rounded border border-cyan-400/30 bg-[#0c1420] px-3 py-2 text-cyan-100 outline-none focus:border-cyan-400/60";
  const primaryBtnClass =
    "w-full rounded border border-cyan-400/50 bg-cyan-400/15 px-3 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";
  const secondaryBtnClass =
    "w-full rounded border border-cyan-400/40 bg-cyan-400/10 px-3 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

  if ((userLoaded && isSignedIn) || (localUser && isAuthenticated)) {
    return (
      <div className={cardClass}>
        {previewBanner}
        <h1 className="text-xl font-semibold tracking-wide text-cyan-200">
          You're already signed in
        </h1>
        <p className="mt-1 text-sm text-cyan-400/60">
          This browser already has an active Anima Protocol session. Continue into the
          app, or sign out if you meant to switch accounts.
        </p>
        <button
          type="button"
          className={`${primaryBtnClass} mt-5`}
          onClick={() => navigate(basePath || "/", { replace: true })}
          disabled={loading}
        >
          Continue to app
        </button>
        <button
          type="button"
          className={`${secondaryBtnClass} mt-2`}
          onClick={handleSignOut}
          disabled={loading}
        >
          {busy === "signout" ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className={cardClass}>
        {previewBanner}
        <h1 className="text-xl font-semibold tracking-wide text-cyan-200">
          Check your email
        </h1>
        <p className="mt-1 text-sm text-cyan-400/60">
          Enter the verification code sent to{" "}
          <span className="text-cyan-200/90">{maskedEmail}</span>. Use the
          code (not a link) so sign-in can finish in this browser.
        </p>
        <form className="mt-5 space-y-4" onSubmit={handleVerify}>
          <label className="block text-sm text-cyan-300/80">
            Verification code
            <input
              className={inputClass}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </label>
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={primaryBtnClass} disabled={loading}>
            {busy === "verify" ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
        <div className="mt-3 flex flex-col gap-2 text-center text-sm">
          <button
            type="button"
            className="text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
            onClick={handleResend}
            disabled={loading}
          >
            {busy === "resend" ? "Sending…" : "Resend code"}
          </button>
          <button
            type="button"
            className="text-cyan-400/60 hover:text-cyan-300"
            onClick={() => {
              setStep("identifier");
              setError(null);
              setCode("");
            }}
            disabled={loading}
          >
            Use a different account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      {previewBanner}
      <h1 className="text-xl font-semibold tracking-wide text-cyan-200">
        Re-enter the Protocol
      </h1>
      <p className="mt-1 text-sm text-cyan-400/60">
        Sign in to resonate with your companions
      </p>

      <button
        type="button"
        className={`${secondaryBtnClass} mt-5`}
        onClick={handleGitHub}
        disabled={loading}
      >
        {busy === "github" ? "Redirecting to GitHub…" : "Continue with GitHub"}
      </button>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-cyan-400/20" />
        <span className="text-xs uppercase tracking-wide text-cyan-400/50">or</span>
        <div className="h-px flex-1 bg-cyan-400/20" />
      </div>

      <form className="space-y-4" onSubmit={handleIdentifierSubmit}>
        <label className="block text-sm text-cyan-300/80">
          Email or username
          {/* In-flow field inside AuthFormShell (`min-h-screen-safe`). Same
              visualViewport rule as the chat composer: no extra keyboard
              padding or fixed-bottom black chrome over this input. */}
          <input
            className={inputClass}
            name="identifier"
            autoComplete="username"
            placeholder="Enter email or username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
          />
        </label>
        {error ? (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={primaryBtnClass} disabled={loading}>
          {busy === "email" ? "Entering…" : "Continue"}
        </button>
      </form>

      <div className="mt-4 pt-3 border-t border-cyan-400/15">
        <button
          type="button"
          className="w-full text-xs text-cyan-300/80 hover:text-cyan-200 py-1.5 px-2 rounded border border-cyan-400/20 hover:border-cyan-400/40 bg-cyan-950/30 transition-colors"
          onClick={() => handleInstantGuest()}
          disabled={loading}
        >
          Instant Sandbox / Guest Access →
        </button>
      </div>

      <p className="mt-3 text-center text-[11px] text-cyan-400/40">
        Passwordless sign-in with instant session resonance
      </p>
    </div>
  );
}
