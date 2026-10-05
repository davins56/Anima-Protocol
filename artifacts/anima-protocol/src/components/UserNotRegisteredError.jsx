// @ts-check
import { Link } from "react-router-dom";

const UserNotRegisteredError = () => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full border border-primary/30 bg-[#090912] shadow-[0_0_30px_rgba(34,211,238,0.15)] p-8 text-center">
        <div className="mx-auto mb-5 w-12 h-12 flex items-center justify-center border border-amber-400/40 rounded-full">
          <span className="text-amber-300 text-xl font-mono">!</span>
        </div>
        <h1 className="font-mono text-xs tracking-[0.3em] uppercase text-primary/90 mb-3">
          Access restricted
        </h1>
        <p className="font-mono text-[11px] leading-relaxed text-primary/50 mb-6">
          This account is not registered to use Anima Protocol. Sign in with the
          account that lives here, or return home.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link
            to="/sign-in"
            className="font-mono text-[10px] tracking-[0.2em] uppercase bg-primary/15 text-primary border border-primary/40 px-5 py-2.5 hover:bg-primary/25 transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/"
            className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/60 border border-primary/20 px-5 py-2.5 hover:text-primary hover:border-primary/40 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
