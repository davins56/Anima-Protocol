import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, Loader, X } from "lucide-react";
import { motion } from "framer-motion";
import { persistPortraitWithInlineFallback } from "@/lib/characterAvatarUpload";

export default function PortraitUploader({ onUploadSuccess, currentUrl }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const persisted = await persistPortraitWithInlineFallback(file, (payload) =>
        base44.integrations.Core.UploadFile(payload),
      );
      onUploadSuccess(persisted.url);
      if (persisted.warning) setError(persisted.warning);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err?.message || "Upload failed — try another image.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block">
        Portrait
      </label>

      {/* Preview */}
      <div className="w-full aspect-[3/4] border-2 border-dashed border-primary/30 bg-black/40 rounded overflow-hidden flex items-center justify-center">
        {currentUrl ? (
          <img
            src={currentUrl}
            alt="Portrait"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center space-y-2">
            <Upload className="w-6 h-6 text-primary/20 mx-auto" />
            <p className="text-[8px] font-mono text-primary/30">No image yet</p>
          </div>
        )}
      </div>

      {/* Upload Button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all font-mono text-[9px] tracking-widest uppercase"
      >
        {uploading ? (
          <>
            <Loader className="w-3.5 h-3.5 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="w-3.5 h-3.5" />
            {currentUrl ? "Change Image" : "Upload Portrait"}
          </>
        )}
      </button>
      {error ? (
        <p className="text-[9px] font-mono text-red-400/90 leading-relaxed">{error}</p>
      ) : null}
    </div>
  );
}