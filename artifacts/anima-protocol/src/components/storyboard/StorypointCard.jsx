import { GripVertical, Trash2, GitFork } from "lucide-react";

export default function StorypointCard({ point, index, onDelete, isDragging, onFork }) {
  return (
    <div
      className={`group relative border transition-all hud-corner ${
        isDragging
          ? "border-primary/60 bg-primary/10 opacity-50"
          : "border-primary/15 bg-black/40 hover:border-primary/40 hover:bg-primary/5"
      }`}
    >
      <div className="flex gap-4 p-4">
        {/* Drag Handle */}
        <div className="flex-shrink-0 text-primary/30 pt-1 cursor-grab active:cursor-grabbing">
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                  Act {index + 1}
                </span>
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase truncate">
                  {point.title || "Untitled"}
                </h3>
              </div>
              <p className="text-[10px] font-mono text-primary/60 leading-relaxed line-clamp-3">
                {point.summary}
              </p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {point.session_id && onFork && (
                <button
                  onClick={() => onFork(point)}
                  className="w-6 h-6 bg-black/80 border border-primary/30 text-primary/50 hover:text-primary flex items-center justify-center transition-colors"
                  title="Fork session from this point"
                >
                  <GitFork className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={onDelete}
                className="w-6 h-6 bg-black/80 border border-red-900/30 text-red-900 hover:text-red-400 flex items-center justify-center transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}