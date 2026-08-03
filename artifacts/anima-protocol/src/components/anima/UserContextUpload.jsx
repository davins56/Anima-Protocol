import { useState, useEffect } from 'react';
import { BookOpen, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function UserContextPanel({ onContextUpdated }) {
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    loadContexts();
  }, []);

  const loadContexts = async () => {
    try {
      const user = await base44.auth.me();
      if (user?.email) {
        const docs = await base44.entities.UserContext.filter({
          user_email: user.email,
        }, '-created_date', 20);
        setContexts(docs || []);
      }
    } catch (err) {
      console.error('Failed to load contexts:', err);
      setContexts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (docId, isActive) => {
    try {
      await base44.entities.UserContext.update(docId, { is_active: !isActive });
      await loadContexts();
      onContextUpdated?.();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    setDeleting(docId);
    try {
      await base44.entities.UserContext.delete(docId);
      setContexts(prev => prev.filter(c => c.id !== docId));
      toast.success('Document deleted');
      onContextUpdated?.();
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete document');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center font-mono text-[9px] text-purple-400/50 animate-pulse">
        Loading your context...
      </div>
    );
  }

  if (contexts.length === 0) {
    return (
      <div className="p-4 text-center space-y-2">
        <BookOpen className="w-6 h-6 text-purple-400/40 mx-auto" />
        <p className="font-mono text-[8px] text-purple-400/50">No context uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      <p className="text-[8px] font-mono text-purple-400/60 tracking-widest uppercase px-4 pt-3">
        Your Documents ({contexts.length})
      </p>

      <AnimatePresence>
        {contexts.map((doc) => (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-3 mx-2 border rounded transition-all ${
              doc.is_active
                ? 'border-purple-400/40 bg-purple-900/20'
                : 'border-purple-400/15 bg-black/40 opacity-60'
            }`}
          >
            <div className="space-y-2">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[8px] font-mono text-purple-400/80 font-semibold">{doc.title}</p>
                  <p className="text-[7px] font-mono text-purple-400/50 mt-0.5">
                    {doc.document_type} • {doc.word_count || 0} words
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleToggleActive(doc.id, doc.is_active)}
                    className="p-1 text-purple-400/60 hover:text-purple-400 transition-colors"
                    title={doc.is_active ? 'Disable context' : 'Enable context'}
                  >
                    {doc.is_active ? (
                      <ToggleRight className="w-4 h-4" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deleting === doc.id}
                    className="p-1 text-purple-400/60 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Delete document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Summary */}
              {doc.extracted_summary && (
                <p className="text-[7px] font-mono text-purple-400/70 leading-relaxed">
                  {doc.extracted_summary}
                </p>
              )}

              {/* Themes */}
              {doc.key_themes?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {doc.key_themes.slice(0, 3).map((theme) => (
                    <span
                      key={theme}
                      className="text-[7px] font-mono px-1.5 py-0.5 bg-purple-400/10 border border-purple-400/20 text-purple-400/70 rounded"
                    >
                      {theme}
                    </span>
                  ))}
                  {doc.key_themes.length > 3 && (
                    <span className="text-[7px] font-mono text-purple-400/50">
                      +{doc.key_themes.length - 3} more
                    </span>
                  )}
                </div>
              )}

              {/* Values */}
              {doc.personal_values?.length > 0 && (
                <p className="text-[7px] font-mono text-purple-400/60">
                  Values: {doc.personal_values.join(', ')}
                </p>
              )}

              {/* Processing Status */}
              {!doc.processing_complete && (
                <p className="text-[7px] font-mono text-yellow-400/70 animate-pulse">
                  AI analysis in progress...
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}