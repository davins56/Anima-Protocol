import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { installBugSquasher, recordBreadcrumb } from "@/lib/bugSquasher/capture";
import { OPEN_BUG_REPORT_EVENT } from "@/lib/bugSquasher/api";
import ReportBugDialog from "./ReportBugDialog";
import { readShowTab, SHOW_TAB_EVENT } from "./prefs";

/**
 * App-wide Bug Squasher wiring, mounted once inside the signed-in shell:
 *   - installs automatic capture (window errors, unhandled rejections,
 *     failed /api calls) while someone is signed in;
 *   - records navigation breadcrumbs;
 *   - hosts the Report a bug panel, opened by `openBugReport()` from
 *     anywhere (Settings, the crash screen) or by the optional edge tab.
 */
export default function BugSquasherSync() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const userIdRef = useRef(null);
  useEffect(() => {
    userIdRef.current = user?.id || null;
  }, [user?.id]);
  const isAdmin = user?.role === "admin";

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState({ description: "", context: null });
  const [showTab, setShowTab] = useState(() => readShowTab(isAdmin));

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    return installBugSquasher({ getUserId: () => userIdRef.current });
  }, [isAuthenticated]);

  useEffect(() => {
    recordBreadcrumb("nav", location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    setShowTab(readShowTab(isAdmin));
    const onTab = () => setShowTab(readShowTab(isAdmin));
    window.addEventListener(SHOW_TAB_EVENT, onTab);
    return () => window.removeEventListener(SHOW_TAB_EVENT, onTab);
  }, [isAdmin]);

  useEffect(() => {
    const onOpen = (event) => {
      const d = event?.detail || {};
      if (event?.detail && typeof event.detail === "object") event.detail.handled = true;
      setDetail({
        description: typeof d.description === "string" ? d.description : "",
        context: d.context && typeof d.context === "object" ? d.context : null,
      });
      setOpen(true);
    };
    window.addEventListener(OPEN_BUG_REPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BUG_REPORT_EVENT, onOpen);
  }, []);

  if (!isAuthenticated) return null;

  return (
    <>
      {showTab && !open && (
        <button
          type="button"
          data-bug-squasher-ui=""
          onClick={() => {
            setDetail({ description: "", context: null });
            setOpen(true);
          }}
          className="fixed left-0 top-1/2 z-40 -translate-y-1/2 border border-l-0 border-primary/30 bg-[#090912]/90 px-1 py-2 text-primary/60 shadow-[0_0_12px_rgba(34,211,238,0.12)] hover:text-primary"
          aria-label="Report a bug"
          title="Report a bug"
        >
          <Bug className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      <ReportBugDialog
        open={open}
        onOpenChange={setOpen}
        initialDescription={detail.description}
        extraContext={detail.context}
      />
    </>
  );
}
