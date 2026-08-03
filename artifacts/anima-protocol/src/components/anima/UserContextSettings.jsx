import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import UserContextUploadModal from './UserContextUploadModal';
import UserContextPanel from './UserContextUpload';

export default function UserContextSettings() {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUploadComplete = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 p-4 border border-purple-400/20 bg-purple-900/10 rounded-lg"
    >
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-400" />
            <h2 className="font-mono text-purple-400 tracking-wider uppercase text-sm">
              Anima Background Context
            </h2>
          </div>
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/30 border border-purple-400/40 text-purple-400 hover:bg-purple-600/50 font-mono text-[8px] tracking-widest uppercase transition-all rounded"
          >
            <Plus className="w-3.5 h-3.5" />
            Upload Document
          </button>
        </div>
        <p className="text-[8px] font-mono text-purple-400/50">
          Upload your novels, essays, or personal writings to give the Anima deeper context about who you are
        </p>
      </div>

      {/* Context Panel */}
      <UserContextPanel key={refreshKey} onContextUpdated={handleUploadComplete} />

      {/* Upload Modal */}
      <UserContextUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadComplete={handleUploadComplete}
      />
    </motion.div>
  );
}