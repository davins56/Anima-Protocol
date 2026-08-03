import { useState } from "react";
import { useClerk, useSignIn } from "@clerk/react";
import { useNavigate } from "react-router-dom";
import {
  clerkErrorMessage,
  hasEmailCodeFactor,
  startGitHubOAuthSignIn,
} from "@/lib/emailCodeSignIn";
import { clerkOAuthCompletePath } from "@/lib/clerkOAuthPaths";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Custom sign-in that forces email OTP (not magic link) and uses
 * Clerk Future `signIn.sso()` for GitHub OAuth. Avoids the prebuilt
 * Continue → email_link hang when the verification email is opened on
 * another device.
 */
export default function EmailCodeSignIn() {
  const { signIn, fetchStatus } = useSignIn();
  const clerk = useClerk();
  const navigate = useNavigate();

  const [step, setStep] = useState("identifier"); // 'identifier' | 'code'
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'email' | 'github' | 'verify' | 'resend'
  const [maskedEmail, setMaskedEmail] = useState("");

  const loading = fetchStatus === "fetching" || Boolean(busy);

  const finishSignIn = async () => {
    if (signIn.status !== "complete") {
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

  const handleIdentifierSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    const value = identifier.trim();
    if (!value) {
      setError("Enter your email or username.");
      return;
    }
    setBusy("email");
    try {
      const { error: createError } = await signIn.create({ identifier: value });
      if (createError) {
        setError(clerkErrorMessage(createError) || "Couldn't start sign-in.");
        return;
      }

      if (!hasEmailCodeFactor(signIn.supportedFirstFactors)) {
        setError(
          "Email code sign-in is not available for this account. Use Continue with GitHub instead.",
        );
        return;
      }

      const { error: sendError } = await signIn.emailCode.sendCode();
      if (sendError) {
        setError(clerkErrorMessage(sendError) || "Couldn't send a verification code.");
        return;
      }

      const emailFactor = (signIn.supportedFirstFactors || []).find(
        (factor) => factor?.strategy === "email_code",
      );
      setMaskedEmail(emailFactor?.safeIdentifier || value);
      setStep("code");
      setCode("");
    } catch (err) {
      setError(clerkErrorMessage(err) || "Couldn't start sign-in.");
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
        setError(clerkErrorMessage(verifyError) || "Invalid verification code.");
        return;
      }
      await finishSignIn();
    } catch (err) {
      setError(clerkErrorMessage(err) || "Couldn't verify that code.");
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
        setError(clerkErrorMessage(sendError) || "Couldn't resend the code.");
        return;
      }
    } catch (err) {
      setError(clerkErrorMessage(err) || "Couldn't resend the code.");
    } finally {
      setBusy(null);
    }
  };

  const handleGitHub = async () => {
    setError(null);
    setBusy("github");
    try {
      if (!signIn) {
        setError("Sign-in is still loading. Wait a moment and try GitHub again.");
        return;
      }
      // Clerk React v6 Future API: use signIn.sso(). Calling
      // clerk.authenticateWithRedirect throws "is not a function".
      await startGitHubOAuthSignIn(signIn, basePath, clerk);
    } catch (err) {
      setError(clerkErrorMessage(err) || "GitHub sign-in failed. Try again.");
      setBusy(null);
    }
  };

  const cardClass =
    "w-full rounded-md border border-cyan-400/30 bg-[#090912] p-6 shadow-[0_0_40px_rgba(34,211,238,0.15)]";
  const inputClass =
    "mt-1 w-full rounded border border-cyan-400/30 bg-[#0c1420] px-3 py-2 text-cyan-100 outline-none focus:border-cyan-400/60";
  const primaryBtnClass =
    "w-full rounded border border-cyan-400/50 bg-cyan-400/15 px-3 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryBtnClass =
    "w-full rounded border border-cyan-400/40 bg-cyan-400/10 px-3 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50";

  if (step === "code") {
    return (
      <div className={cardClass}>
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
          {busy === "email" ? "Sending code…" : "Continue"}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-cyan-400/45">
        We email a one-time code — not a magic link — so login can finish here.
      </p>
    </div>
  );
}
