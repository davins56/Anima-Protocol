import { useState, useEffect, useRef } from 'react';
import { BookOpen, Trash2, ToggleLeft, ToggleRight, RotateCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { animaClient } from '@/api/animaClient';
import { toast } from 'sonner';
import {
  USER_CONTEXT_ACCEPT,
  deriveUserContextStatus,
  runUserContextProcessing,
  userContextFileRejection,
  userContextTruncationNote,
  userContextWordCountLabel,
} from '@/lib/userContextUpload';
import { buildUserContextPayload } from '@/lib/userContextPayload';

import { useConfirm } from "@/lib/ConfirmDialog";

export default function UserContextPanel({ onContextUpdated }) {
  const confirm = useConfirm();
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const [retryErrors, setRetryErrors] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const filePickRef = useRef(null);
  const pendingFileRetry = useRef(null);

  // Re-check "in progress" cards so a stalled one flips to Stalled/No text
  // without a reload.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadContexts();
  }, []);

  const loadContexts = async () => {
    try {
      const user = await animaClient.auth.me();
      if (user?.email) {
        const docs = await animaClient.entities.UserContext.filter({
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
      await animaClient.entities.UserContext.update(docId, { is_active: !isActive });
      await loadContexts();
      onContextUpdated?.();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const retryDoc = async (doc, file) => {
    setRetrying(doc.id);
    setRetryErrors((prev) => ({ ...prev, [doc.id]: '' }));
    try {
      const payload = file
        ? await buildUserContextPayload(file, {
            title: doc.title,
            docType: doc.document_type,
            fileUrl: doc.file_url || '',
          })
        : { title: doc.title, document_type: doc.document_type, is_image: false, file_content: '' };
      const outcome = await runUserContextProcessing({
        invoke: (name, data, options) => animaClient.functions.invoke(name, data, options),
        updateRecord: (id, patch) => animaClient.entities.UserContext.update(id, patch),
        recordId: doc.id,
        payload,
      });
      if (!outcome.ok) {
        setRetryErrors((prev) => ({ ...prev, [doc.id]: outcome.message }));
        toast.error(outcome.message);
      } else {
        toast.success('Analysis finished');
      }
      await loadContexts();
      onContextUpdated?.();
    } catch (err) {
      const message = err?.message || "Couldn't retry that document.";
      setRetryErrors((prev) => ({ ...prev, [doc.id]: message }));
      toast.error(message);
    } finally {
      setRetrying(null);
    }
  };

  const handleRetry = (doc, mode) => {
    if (mode === 'server') {
      retryDoc(doc, null);
      return;
    }
    pendingFileRetry.current = doc;
    filePickRef.current?.click();
  };

  const handleRetryFile = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    const doc = pendingFileRetry.current;
    pendingFileRetry.current = null;
    if (!picked || !doc) return;
    const rejection = userContextFileRejection(picked);
    if (rejection) {
      setRetryErrors((prev) => ({ ...prev, [doc.id]: rejection }));
      return;
    }
    retryDoc(doc, picked);
  };

  const handleDelete = async (docId) => {
    const ok = await confirm({
      title: "Delete this document?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setDeleting(docId);
    try {
      await animaClient.entities.UserContext.delete(docId);
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
      <input
        ref={filePickRef}
        type="file"
        accept={USER_CONTEXT_ACCEPT}
        className="hidden"
        data-testid="user-context-retry-file"
        onChange={handleRetryFile}
      />

      <AnimatePresence>
        {contexts.map((doc) => {
          const status = deriveUserContextStatus(doc, now);
          const truncation = userContextTruncationNote(doc);
          const retryError = retryErrors[doc.id];
          return (
          <motion.div
            key={doc.id}
            data-testid="user-context-card"
            data-status={status.state}
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
                    {doc.document_type} • {userContextWordCountLabel(doc, status)}
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

              {truncation && (
                <p className="text-[7px] font-mono text-yellow-300/70">{truncation}</p>
              )}

              {/* Processing Status */}
              {status.state === 'processing' && (
                <p className="text-[7px] font-mono text-yellow-400/70 animate-pulse">
                  AI analysis in progress...
                </p>
              )}
              {(status.state === 'failed' || status.state === 'stalled') && (
                <p className="text-[7px] font-mono text-red-400/90" role="status">
                  {status.label}: {status.reason}
                </p>
              )}
              {status.state === 'no_text' && (
                <p className="text-[7px] font-mono text-red-300/80" role="status">
                  {status.reason}
                </p>
              )}
              {retryError && (
                <p className="text-[7px] font-mono text-red-400/90" role="alert">
                  {retryError}
                </p>
              )}
              {status.retry && (
                <button
                  type="button"
                  onClick={() => handleRetry(doc, status.retry)}
                  disabled={retrying === doc.id}
                  className="flex items-center gap-1 px-2 py-1 border border-purple-400/30 text-purple-300 hover:text-purple-200 font-mono text-[8px] tracking-widest uppercase disabled:opacity-50"
                >
                  <RotateCw className={`w-3 h-3 ${retrying === doc.id ? 'animate-spin' : ''}`} />
                  {retrying === doc.id
                    ? 'Retrying...'
                    : status.retry === 'file'
                      ? 'Retry (choose the file again)'
                      : 'Retry'}
                </button>
              )}
            </div>
          </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}