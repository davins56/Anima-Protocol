import { useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { mountRegister } from "@/components/memorySecurityLab/register";
import markup from "@/components/memorySecurityLab/register.html?raw";
import styles from "@/components/memorySecurityLab/register.css?inline";

function Register({ userId }) {
  const host = useRef(null);

  useEffect(() => {
    const node = host.current;
    const root = node.shadowRoot ?? node.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = styles;
    const template = document.createElement("template");
    template.innerHTML = markup;
    root.replaceChildren(sheet, template.content.cloneNode(true));
    return mountRegister(root, userId);
  }, [userId]);

  return <div ref={host} />;
}

export default function MemorySecurityLab() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const { user: clerkUser, isLoaded } = useUser();
  const accountId = clerkUser?.id;
  const allowed =
    isAuthenticated &&
    accountId &&
    user?.id === accountId &&
    user.is_steward === true;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background pb-24 lg:pb-6">
      <div className="p-4">
        <Link
          to="/settings?section=data"
          className="text-sm text-primary underline"
        >
          Back to Data &amp; Privacy
        </Link>
      </div>
      {!isLoaded || isLoadingAuth ? (
        <p role="status" className="p-4">
          Loading account access…
        </p>
      ) : allowed ? (
        <Register key={accountId} userId={accountId} />
      ) : (
        <p className="p-4">
          The Memory Security Lab is available to the Protocol steward.
        </p>
      )}
    </div>
  );
}
