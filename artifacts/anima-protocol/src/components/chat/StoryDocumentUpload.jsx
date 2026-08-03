import { useState } from 'react';
import { Upload, X, Loader, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';

export default function StoryDocumentUpload({ sessionId, onDocumentProcessed }) {
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState(null);

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        setError('File must be under 10MB');
        continue;
      }

      setUploading(true);
      setError(null);

      try {
        // Upload file
        const { file_url } = await base44.integrations.Core.UploadFile({ file });

        // Process document as user context
        const result = await base44.functions.invoke('processUserContext', {
          file_url,
          title: file.name,
          document_type: 'user_uploaded',
        });

        if (result?.data?.success) {
          setDocuments(prev => [...prev, {
            id: result.data.id,
            name: file.name,
            type: file.type,
            processed: true,
          }]);

          onDocumentProcessed?.(result.data);
        }
      } catch (err) {
        console.error('Upload error:', err);
        setError(`Failed to upload ${file.name}`);
      } finally {
        setUploading(false);
      }
    }

    // Reset input
    e.target.value = '';
  };

  const removeDocument = (id) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id));
  };

  return (
    <div className="border border-primary/20 bg-black/40 rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[9px] font-mono text-primary/60 tracking-widest uppercase cursor-pointer hover:text-primary transition-colors">
          <Upload className="w-3.5 h-3.5" />
          <span>Inject Document Context</span>
          <input
            type="file"
            multiple
            accept=".txt,.pdf,.doc,.docx,.md"
            onChange={handleFileSelect}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {/* Uploaded documents */}
      <AnimatePresence>
        {documents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1.5"
          >
            {documents.map(doc => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center justify-between gap-2 p-2 bg-primary/5 border border-primary/15 rounded text-[9px] font-mono text-primary/70"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
                  <span className="truncate">{doc.name}</span>
                </div>
                <button
                  onClick={() => removeDocument(doc.id)}
                  className="text-primary/40 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading state */}
      {uploading && (
        <div className="flex items-center gap-2 text-primary/50 text-[9px] font-mono">
          <Loader className="w-3 h-3 animate-spin" />
          Processing document...
        </div>
      )}

      {/* Error message */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-2 bg-red-900/20 border border-red-400/30 rounded text-[8px] font-mono text-red-400"
        >
          {error}
        </motion.div>
      )}

      <p className="text-[8px] font-mono text-primary/30 italic">
        Documents are processed to enhance character context and narrative depth
      </p>
    </div>
  );
}