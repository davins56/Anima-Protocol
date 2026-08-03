import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { BookOpen, X } from "lucide-react";
import { motion } from "framer-motion";

export default function StoryTemplateBrowser({ onSelectTemplate, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const data = await base44.entities.StoryTemplate.filter({ is_active: true }, "-created_date", 50);
      setTemplates(data || []);
    } catch (err) {
      console.error("Error loading templates:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = (template) => {
    onSelectTemplate(template);
    onClose();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">Loading templates...</p>
        </div>
      </div>
    );
  }

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
        className="w-full max-w-2xl max-h-[80vh] bg-background border border-primary/30 rounded overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">Story Templates</h2>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Templates Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {templates.length === 0 ? (
            <div className="text-center py-8">
              <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">No templates available</p>
            </div>
          ) : (
            templates.map((template) => (
              <motion.button
                key={template.id}
                onClick={() => handleSelectTemplate(template)}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full p-4 border border-primary/20 bg-black/40 hover:bg-primary/10 hover:border-primary/40 text-left transition-all rounded space-y-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-mono text-primary font-semibold text-sm">{template.title}</h3>
                    <p className="font-mono text-[9px] text-primary/50 mt-1">{template.universe}</p>
                  </div>
                  <span className="text-[9px] font-mono text-primary/40 flex-shrink-0">
                    {template.character_bases?.length || 0} characters
                  </span>
                </div>
                {template.description && (
                  <p className="text-[9px] font-mono text-primary/60 leading-relaxed">{template.description}</p>
                )}
                {template.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-2">
                    {template.tags.slice(0, 3).map((tag, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-primary/10 border border-primary/20 text-[8px] font-mono text-primary/70 rounded">
                        {tag}
                      </span>
                    ))}
                    {template.tags.length > 3 && (
                      <span className="px-2 py-0.5 text-[8px] font-mono text-primary/50">+{template.tags.length - 3}</span>
                    )}
                  </div>
                )}
              </motion.button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}