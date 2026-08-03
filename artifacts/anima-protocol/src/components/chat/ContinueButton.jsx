export default function ContinueButton({ onClick, disabled, mode }) {
  if (mode !== "solo") return null;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-shrink-0 px-3 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 disabled:opacity-30 disabled:cursor-not-allowed hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all rounded"
      title="Continue the story"
    >
      ▶ Continue
    </button>
  );
}