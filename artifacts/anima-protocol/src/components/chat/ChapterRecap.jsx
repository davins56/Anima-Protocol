import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BookOpen, ChevronDown, Loader } from 'lucide-react';

export default function ChapterRecap({ sessionId, isVisible }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (sessionId && isVisible) {
      generateRecap();
    }
  }, [sessionId]);

  const generateRecap = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('generateSessionSummary', {
        session_id: sessionId
      });
      if (result?.data?.summary) {
        setSummary(result.data.summary);
      }
    } catch (err) {
      console.error('Error generating recap:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isVisible) return null;

  if (loading) {
    return (
      <div className="border-b border-primary/10 bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader className="w-3.5 h-3.5 text-primary/40 animate-spin" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Generating chapter recap...
          </p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="border-b border-primary/10 bg-primary/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 text-left">
          <BookOpen className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-primary/80 tracking-widest uppercase truncate">
              Chapter Recap
            </p>
            <p className="font-mono text-[9px] text-primary/40 truncate">
              {summary.synopsis?.slice(0, 50)}...
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-primary/40 flex-shrink-0 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-primary/10 px-4 py-3 space-y-3 bg-black/40">
          {/* Synopsis */}
          <div>
            <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
              Synopsis
            </p>
            <p className="font-mono text-[10px] text-primary/70 leading-relaxed">
              {summary.synopsis}
            </p>
          </div>

          {/* Key Moments */}
          {summary.key_moments?.length > 0 && (
            <div>
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                Key Moments
              </p>
              <div className="space-y-1">
                {summary.key_moments.map((moment, idx) => (
                  <div
                    key={idx}
                    className="font-mono text-[9px] text-primary/60 border-l-2 border-primary/20 pl-2 py-1"
                  >
                    {moment}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Emotional Arc */}
          {summary.emotional_arc && (
            <div>
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                Emotional Tone
              </p>
              <p className="font-mono text-[10px] text-primary/70">
                {summary.emotional_arc}
              </p>
            </div>
          )}

          <button
            onClick={generateRecap}
            className="w-full mt-2 px-3 py-1.5 border border-primary/20 text-primary/50 hover:text-primary/70 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}