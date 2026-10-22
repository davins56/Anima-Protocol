/** Small refine row under a generated photo in a chat bubble. */
import { RefreshCw, RotateCw, Shirt, Smile } from "lucide-react";
import { requestPhotoRefine, type RefinementOp } from "@/lib/photo/photoApi";

const ACTIONS: Array<{ op: RefinementOp; icon: typeof RefreshCw; label: string }> = [
  { op: "regenerate", icon: RefreshCw, label: "Regenerate" },
  { op: "vary_angle", icon: RotateCw, label: "Vary angle" },
  { op: "outfit", icon: Shirt, label: "Change outfit" },
  { op: "expression", icon: Smile, label: "Change expression" },
];

export default function PhotoAttachmentActions({ imageId, characterId }: { imageId: string; characterId?: string }) {
  return (
    <div className="flex gap-1 mt-1">
      {ACTIONS.map(({ op, icon: Icon, label }) => (
        <button
          key={op}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => requestPhotoRefine({ imageId, characterId, op })}
          className="p-1 border border-primary/15 text-primary/50 hover:text-primary hover:border-primary/40"
        >
          <Icon className="w-3 h-3" />
        </button>
      ))}
    </div>
  );
}
