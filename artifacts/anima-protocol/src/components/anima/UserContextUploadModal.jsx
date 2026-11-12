import { useState } from 'react';
import { Upload, X, Loader } from 'lucide-react';
import { motion } from 'framer-motion';
import { animaClient } from '@/api/animaClient';
import { downscaleDataUrl } from '@/lib/downscaleImage';
import { readPhotoAsDataUrl } from '@/lib/avatarPhoto';
import {
  formatUserContextUploadError,
  uploadUserContextStorageFile,
  userContextNeedsStorageUpload,
} from '@/lib/userContextUpload';
import { uploadPdfDocument } from '@/api/pdfDocuments';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function isImageFile(file) {
  if (!file) return false;
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  return (file.type || '').startsWith('image/') || IMAGE_EXTS.includes(ext);
}

export default function UserContextUploadModal({ isOpen, onClose, onUploadComplete }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const validTypes = ['text/plain', 'application/pdf', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/epub+zip', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      const validExts = ['.txt', '.md', '.pdf', '.docx', '.epub', ...IMAGE_EXTS];
      const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
      
      if (!validTypes.includes(selectedFile.type) && !validExts.includes(ext)) {
        setError('Please upload: .txt, .md, .pdf, .docx, .epub, or an image');
        return;
      }

      const maxSize = 100 * 1024 * 1024;
      if (selectedFile.size > maxSize) {
        setError('File must be under 100 MB.');
        return;
      }

      setFile(selectedFile);
      setError('');
      if (!title) setTitle(selectedFile.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (!file || !title) {
      setError('Please select a file and enter a title');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const user = await animaClient.auth.me();

      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const isPdf = ext === '.pdf' || file.type === 'application/pdf';
      const isImage = isImageFile(file);

      let fileToUpload = file;
      let imageDataUrl = '';
      if (isImage) {
        try {
          const dataUrl = await readPhotoAsDataUrl(file);
          if (dataUrl) {
            let small = '';
            try {
              small = await downscaleDataUrl(dataUrl, 1024, 0.85);
            } catch (downscaleErr) {
              console.debug('Image downscale failed; using original', downscaleErr);
            }
            imageDataUrl = small || dataUrl;
            if (small) {
              const blob = await (await fetch(small)).blob();
              const baseName = file.name.replace(/\.[^.]+$/, '');
              fileToUpload = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
            }
          }
        } catch (readErr) {
          console.debug('Image read failed; using original', readErr);
          fileToUpload = file;
        }
      }

      let fileUrl = '';
      if (userContextNeedsStorageUpload(isImage)) {
        try {
          fileUrl = await uploadUserContextStorageFile(
            fileToUpload,
            (payload) => animaClient.integrations.Core.UploadFile(payload),
          );
        } catch (uploadErr) {
          setError(formatUserContextUploadError(uploadErr));
          setUploading(false);
          return;
        }
      }

      // For PDFs, upload via the existing extractor so the server has the chunks.
      // Pass the document id so processUserContext can pull the real text.
      let fileData = '';
      let pdfDocumentId = '';
      if (isPdf) {
        try {
          const stored = await uploadPdfDocument({
            file,
            scope: 'lore',
          });
          pdfDocumentId = stored?.id || '';
          fileData = pdfDocumentId
            ? `[PDF document id: ${pdfDocumentId}]`
            : '';
        } catch (pdfErr) {
          console.warn('PDF pre-extract failed; continuing with empty content', pdfErr);
        }
      } else if (!isImage) {
        try { fileData = await file.text(); } catch (_) {}
      }

      // Create UserContext record immediately so the list updates.
      const contextRecord = await animaClient.entities.UserContext.create({
        user_email: user.email,
        title,
        document_type: docType,
        file_url: fileUrl,
        is_active: true,
        processing_complete: false,
      });

      // Refresh the list right away so the upload resolves for the user.
      onUploadComplete?.();

      // Background analysis (non-blocking). Backend will fetch PDF text from chunks when pdf_document_id is present.
      animaClient.functions.invoke('processUserContext', {
        user_context_id: contextRecord.id,
        file_url: fileUrl,
        file_content: fileData,
        pdf_document_id: pdfDocumentId || undefined,
        is_pdf: isPdf,
        is_image: isImage,
        image_data_url: imageDataUrl,
        document_type: docType,
        title,
      })
        .then(() => onUploadComplete?.())
        .catch(err => console.warn('Background processing encountered an issue:', err));

      setFile(null);
      setTitle('');
      setDocType('other');
      onClose();
    } catch (err) {
      console.error('Upload failed:', err);
      setError(formatUserContextUploadError(err) || 'Upload failed. Please check the file and try again.');
    } finally {
      setUploading(false);
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
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-purple-400 tracking-wider uppercase text-sm">
            Upload Background Document
          </h3>
          <button
            onClick={onClose}
            className="text-purple-400/50 hover:text-purple-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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

        <div className="space-y-2">
          <label className="block text-[9px] font-mono text-purple-400/60 tracking-widest uppercase">
            File
          </label>
          <div className="relative">
            <input
              type="file"
              onChange={handleFileSelect}
              accept=".txt,.md,.pdf,.docx,.epub,image/*"
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
            Supported: .txt, .md, .pdf, .docx, .epub, images (max 100 MB)
          </p>
        </div>

        {error && (
          <div className="p-2 border border-red-400/30 bg-red-900/10 rounded">
            <p className="text-[8px] font-mono text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={uploading}
            className="flex-1 px-4 py-2 border border-purple-400/20 text-purple-400/70 hover:text-purple-400 font-mono text-sm tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || !title || uploading}
            className="flex-1 px-4 py-2 bg-purple-600/30 border border-purple-400/50 text-purple-400 hover:bg-purple-600/50 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm tracking-wider uppercase transition-all flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
