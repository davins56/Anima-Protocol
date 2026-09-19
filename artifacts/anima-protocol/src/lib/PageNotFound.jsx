// @ts-check
import { Link, useLocation } from "react-router-dom";

export default function PageNotFound() {
  const location = useLocation();
  const pageName = (location.pathname || "/").replace(/^\//, "") || "this path";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full border border-primary/30 bg-[#090912] shadow-[0_0_30px_rgba(34,211,238,0.15)] p-8 text-center">
        <p className="font-mono text-5xl text-primary/25 tracking-[0.2em] mb-4">
          404
        </p>
        <h1 className="font-mono text-xs tracking-[0.3em] uppercase text-primary/90 mb-3">
          Page not found
        </h1>
        <p className="font-mono text-[11px] leading-relaxed text-primary/50 mb-6">
          <span className="text-primary/80">/{pageName}</span> is not a screen
          in this application.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center font-mono text-[10px] tracking-[0.2em] uppercase bg-primary/15 text-primary border border-primary/40 px-5 py-2.5 hover:bg-primary/25 transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}