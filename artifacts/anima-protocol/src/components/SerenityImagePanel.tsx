import React from 'react';

interface SerenityImagePanelProps {
  imageUrl: string;
  caption?: string;
  isMax: boolean;
  onRegenerate?: () => void;
  onEditPrompt?: (newPrompt: string) => void;
  onClose?: () => void;
}

export default function SerenityImagePanel({
  imageUrl,
  caption,
  isMax,
  onRegenerate,
  onEditPrompt,
  onClose,
}: SerenityImagePanelProps) {
  return (
    <div className="my-4 rounded-3xl overflow-hidden border border-white/10 bg-zinc-950 shadow-xl">
      <div className="relative">
        <img 
          src={imageUrl} 
          alt="Serenity" 
          className="w-full object-cover max-h-[520px]" 
        />
        
        {onClose && (
          <button 
            onClick={onClose}
            className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white text-xs px-3 py-1 rounded-full"
          >
            Close
          </button>
        )}
      </div>

      {caption && (
        <div className="px-5 py-4 text-sm text-white/75 italic border-t border-white/10 bg-black/40">
          “{caption}”
        </div>
      )}

      {isMax && (
        <div className="flex gap-2 p-4 bg-black/70">
          <button
            onClick={onRegenerate}
            className="flex-1 py-2.5 text-sm rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
          >
            Regenerate
          </button>
          <button
            onClick={() => {
              const newPrompt = prompt("Describe how you want to change this image...");
              if (newPrompt && onEditPrompt) onEditPrompt(newPrompt);
            }}
            className="flex-1 py-2.5 text-sm rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors"
          >
            Edit this moment
          </button>
        </div>
      )}
    </div>
  );
}