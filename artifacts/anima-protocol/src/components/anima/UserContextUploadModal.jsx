import { useState } from 'react';
import { Upload, X, Loader } from 'lucide-react';
import { motion } from 'framer-motion';
import { animaClient } from '@/api/animaClient';
import { buildUserContextPayload, readUserContextImage } from '@/lib/userContextPayload';
import {
  USER_CONTEXT_ACCEPT,
  classifyUserContextFile,
  formatUserContextUploadError,
  runUserContextProcessing,
  uploadUserContextStorageFile,
  userContextFileRejection,
  userContextNeedsStorageUpload,
} from '@/lib/userContextUpload';

export default function UserContextUploadModal({ isOpen, onClose, onUploadComplete }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  // Row saved on a previous attempt whose analysis failed. "Retry analysis"
  // re-runs processing on it instead of saving a duplicate card.
  const [savedRecord, setSavedRecord] = useState(null);
  const [savedPayload, setSavedPayload] = useState(null);

  const resetAndClose = () => {
    setFile(null);
    setTitle('');
    setDocType('other');
    setError('');
    setPhase('');
    setSavedRecord(null);
    setSavedPayload(null);
    onClose();
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const rejection = userContextFileRejection(selectedFile);
      if (rejection) {
        setFile(null);
        setError(rejection);
        return;
      }
      setFile(selectedFile);
      setError('');
      setSavedRecord(null);
      setSavedPayload(null);
      if (!title) setTitle(selectedFile.name.replace(/\.[^.]+$/, ''));
    }
  };

  const processRecord = async (recordId, payload) => {
    setPhase('analysing');
    const outcome = await runUserContextProcessing({
      invoke: (name, data, options) => animaClient.functions.invoke(name, data, options),
      updateRecord: (id, patch) => animaClient.entities.UserContext.update(id, patch),
      recordId,
      payload,
    });
    onUploadComplete?.();
    if (outcome.ok) {
      resetAndClose();
      return;
    }
    setError(`Saved, but the analysis failed: ${outcome.message} The card shows Failed with a Retry button.`);
  };

  const handleRetry = async () => {
    if (!savedRecord || !savedPayload) return;
    setUploading(true);
    setError('');
    try {
      await processRecord(savedRecord.id, savedPayload);
    } finally {
      setUploading(false);
      setPhase('');
    }
  };

  const handleUpload = async () => {
    if (!file || !title) {
      setError('Please select a file and enter a title');
      return;
    }
    const rejection = userContextFileRejection(file);
    if (rejection) {
      setError(rejection);
      return;
    }

    setUploading(true);
    setError('');
    setPhase('uploading');

    try {
      const user = await animaClient.auth.me();
      const kind = classifyUserContextFile(file);
      const isImage = kind === 'image';

      let fileToUpload = file;
      let imageDataUrl = '';
      if (isImage) {
        ({ fileToUpload, imageDataUrl } = await readUserContextImage(file));
      }

      // Images go through Postgres-backed /api/storage/uploads. Text documents
      // skip that path — UploadFile only accepts images.
      let fileUrl = '';
      if (userContextNeedsStorageUpload(isImage)) {
        try {
          fileUrl = await uploadUserContextStorageFile(
            fileToUpload,
            (payload) => animaClient.integrations.Core.UploadFile(payload),
          );
        } catch (uploadErr) {
          setError(formatUserContextUploadError(uploadErr));
          return;
        }
      }

      const payload = await buildUserContextPayload(file, {
        title,
        docType,
        fileUrl,
        imageDataUrl: isImage ? imageDataUrl : undefined,
      });
      if (!isImage && !payload.file_content.trim()) {
        setError('That file has no text in it.');
        return;
      }

      const contextRecord = await animaClient.entities.UserContext.create({
        user_email: user.email,
        title,
        document_type: docType,
        file_url: fileUrl,
        file_name: file.name,
        source_kind: isImage ? 'image' : 'text',
        is_active: true,
        processing_complete: false,
        processing_status: 'processing',
        processing_started_at: new Date().toISOString(),
      });
      setSavedRecord(contextRecord);
      setSavedPayload(payload);

      // Wait for the analysis so a failure is shown here, not swallowed.
      await processRecord(contextRecord.id, payload);
    } catch (err) {
      console.error('Upload failed:', err);
      setError(formatUserContextUploadError(err) || 'Upload failed. Please check the file and try again.');
    } finally {
      setUploading(false);
      setPhase('');
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-black border border-purple-400/30 rounded-lg p-6 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-purple-400 tracking-wider uppercase text-sm">
            Upload Background Document
          </h3>
          <button
            onClick={resetAndClose}
            aria-label="Close"
            className="text-purple-400/50 hover:text-purple-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File Input */}
        <div className="space-y-2">
          <label className="block text-[9px] font-mono text-purple-400/60 tracking-widest uppercase">
            Document Type
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full bg-black/60 border border-purple-400/20 text-purple-400 font-mono text-sm px-3 py-2 focus:outline-none focus:border-purple-400/50 rounded"
          >
            <option value="novel">Novel / Story</option>
            <option value="biography">Biography</option>
            <option value="essay">Essay</option>
            <option value="journal">Journal / Diary</option>
            <option value="character_background">Character Background</option>
            <option value="world_building">World Building</option>
            <option value="poetry">Poetry</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <label className="block text-[9px] font-mono text-purple-400/60 tracking-widest uppercase">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., My First Novel, Personal Values Essay"
            className="w-full bg-black/60 border border-purple-400/20 text-purple-400 placeholder-purple-400/30 font-mono text-sm px-3 py-2 focus:outline-none focus:border-purple-400/50 rounded"
          />
        </div>

        {/* File Upload */}
        <div className="space-y-2">
          <label className="block text-[9px] font-mono text-purple-400/60 tracking-widest uppercase">
            File
          </label>
          <div className="relative">
            <input
              type="file"
              onChange={handleFileSelect}
              accept={USER_CONTEXT_ACCEPT}
              data-testid="user-context-file"
              className="hidden"
              id="file-input"
              disabled={uploading}
            />
            <label
              htmlFor="file-input"
              className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded cursor-pointer transition-colors ${
                file
                  ? 'border-purple-400/50 bg-purple-900/10'
                  : 'border-purple-400/20 hover:border-purple-400/40 bg-black/40'
              }`}
            >
              <Upload className="w-4 h-4 text-purple-400/60" />
              <span className="font-mono text-sm text-purple-400/70">
                {file ? file.name : 'Select or drag file here'}
              </span>
            </label>
          </div>
          <p className="text-[8px] font-mono text-purple-400/40">
            Supported: .txt, .md, images (max 10MB). Book PDFs, Word and EPUB files are coming with the new upload pipeline.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-2 border border-red-400/30 bg-red-900/10 rounded" role="alert">
            <p className="text-[8px] font-mono text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={resetAndClose}
            disabled={uploading}
            className="flex-1 px-4 py-2 border border-purple-400/20 text-purple-400/70 hover:text-purple-400 font-mono text-sm tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={savedRecord ? handleRetry : handleUpload}
            disabled={!file || !title || uploading}
            className="flex-1 px-4 py-2 bg-purple-600/30 border border-purple-400/50 text-purple-400 hover:bg-purple-600/50 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm tracking-wider uppercase transition-all flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                {phase === 'analysing' ? 'Analysing...' : 'Uploading...'}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {savedRecord ? 'Retry analysis' : 'Upload'}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}