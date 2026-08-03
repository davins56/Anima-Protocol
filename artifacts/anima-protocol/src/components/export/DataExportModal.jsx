import { useState } from 'react';
import { Download, X, Check, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import jsPDF from 'jspdf';

const EXPORT_OPTIONS = [
  { id: 'messages', label: 'Chat Messages', desc: 'All conversation history' },
  { id: 'characters', label: 'Characters', desc: 'Character profiles' },
  { id: 'memories', label: 'Memories', desc: 'Character memories & insights' },
  { id: 'quests', label: 'Quests', desc: 'Quest log & tracking' },
  { id: 'inventory', label: 'Inventory', desc: 'Character items & equipment' },
];

export default function DataExportModal({ isOpen, onClose, session }) {
  const [selectedTypes, setSelectedTypes] = useState(['messages', 'characters']);
  const [format, setFormat] = useState('csv');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, success, error

  const toggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleExport = async () => {
    if (!session || selectedTypes.length === 0) return;

    setLoading(true);
    setStatus('idle');

    try {
      const result = await base44.functions.invoke('exportSessionData', {
        session_id: session.id,
        format: format,
        data_types: selectedTypes,
      });

      if (format === 'csv' && result?.data) {
        // CSV data comes directly
        const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' });
        downloadFile(blob, `${session.title || 'session'}_export.csv`);
      } else if (format === 'pdf' && result?.data?.data) {
        // Generate PDF from data
        generatePDF(result.data.data, session.title);
      }

      setStatus('success');
      setTimeout(() => {
        onClose();
        setStatus('idle');
      }, 2000);
    } catch (err) {
      console.error('Export failed:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const generatePDF = (data, sessionTitle) => {
    const doc = new jsPDF();
    let yPosition = 10;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 10;
    const maxWidth = doc.internal.pageSize.width - 2 * margin;

    // Helper to add text with page breaks
    const addText = (text, fontSize = 10, isBold = false) => {
      doc.setFontSize(fontSize);
      if (isBold) doc.setFont(undefined, 'bold');
      else doc.setFont(undefined, 'normal');

      const lines = doc.splitTextToSize(text, maxWidth);
      const lineHeight = fontSize * 0.35;

      lines.forEach(line => {
        if (yPosition + lineHeight > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += lineHeight;
      });
    };

    // Title
    addText(`Session Export: ${sessionTitle || 'Untitled'}`, 16, true);
    yPosition += 5;
    addText(`Exported: ${new Date().toLocaleString()}`, 9);
    yPosition += 10;

    // Messages
    if (selectedTypes.includes('messages') && data.messages?.length > 0) {
      addText('Chat Messages', 12, true);
      yPosition += 3;
      data.messages.slice(0, 50).forEach(msg => {
        const speaker = msg.character_name || msg.role || 'Unknown';
        const content = (msg.content || '').slice(0, 200);
        addText(`${speaker}: ${content}`, 9);
        yPosition += 2;
      });
      yPosition += 5;
    }

    // Characters
    if (selectedTypes.includes('characters') && data.characters?.length > 0) {
      addText('Characters', 12, true);
      yPosition += 3;
      data.characters.forEach(char => {
        addText(`${char.name}${char.universe ? ` (${char.universe})` : ''}`, 10, true);
        if (char.personality) {
          addText(char.personality.slice(0, 150), 8);
        }
        yPosition += 3;
      });
      yPosition += 5;
    }

    // Memories
    if (selectedTypes.includes('memories') && data.memories?.length > 0) {
      addText('Memories', 12, true);
      yPosition += 3;
      data.memories.slice(0, 20).forEach(mem => {
        addText(mem.title || mem.subject || 'Untitled', 10, true);
        if (mem.content) {
          addText(mem.content.slice(0, 150), 8);
        }
        yPosition += 3;
      });
      yPosition += 5;
    }

    // Quests
    if (selectedTypes.includes('quests') && data.quests?.length > 0) {
      addText('Quests', 12, true);
      yPosition += 3;
      data.quests.forEach(quest => {
        addText(`${quest.title} [${quest.status}]`, 10, true);
        if (quest.description) {
          addText(quest.description.slice(0, 150), 8);
        }
        yPosition += 3;
      });
      yPosition += 5;
    }

    // Inventory
    if (selectedTypes.includes('inventory') && data.inventory?.length > 0) {
      addText('Inventory', 12, true);
      yPosition += 3;
      data.inventory.forEach(item => {
        const equipped = item.equipped ? ' [EQUIPPED]' : '';
        addText(`${item.name} x${item.quantity}${equipped}`, 9);
      });
    }

    doc.save(`${sessionTitle || 'session'}_export.pdf`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-primary/20 bg-primary/5 sticky top-0">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary/60" />
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm">
              Export Data
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Format Selection */}
          <div className="space-y-2">
            <p className="text-[9px] font-mono text-primary/50 tracking-widest uppercase">
              Export Format
            </p>
            <div className="flex gap-2">
              {['csv', 'pdf'].map(fmt => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`flex-1 px-3 py-2 border rounded font-mono text-[9px] tracking-widest uppercase transition-all ${
                    format === fmt
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-primary/20 text-primary/40 hover:text-primary/70'
                  }`}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Data Type Selection */}
          <div className="space-y-2">
            <p className="text-[9px] font-mono text-primary/50 tracking-widest uppercase">
              Data to Include
            </p>
            <div className="space-y-1.5">
              {EXPORT_OPTIONS.map(option => (
                <label
                  key={option.id}
                  className="flex items-start gap-2.5 p-2.5 border border-primary/15 bg-black/30 hover:border-primary/30 rounded cursor-pointer transition-all group"
                >
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(option.id)}
                    onChange={() => toggleType(option.id)}
                    className="w-4 h-4 mt-0.5 accent-primary cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-mono text-primary/80 group-hover:text-primary transition-colors">
                      {option.label}
                    </p>
                    <p className="text-[8px] font-mono text-primary/40 mt-0.5">
                      {option.desc}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Status Messages */}
          <AnimatePresence>
            {status === 'success' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-3 border border-green-400/30 bg-green-400/10 rounded flex items-center gap-2"
              >
                <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                <p className="text-[8px] font-mono text-green-400/80 tracking-widest uppercase">
                  Export successful
                </p>
              </motion.div>
            )}
            {status === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-3 border border-red-400/30 bg-red-400/10 rounded"
              >
                <p className="text-[8px] font-mono text-red-400/80 tracking-widest uppercase">
                  Export failed. Please try again.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-primary/20 bg-primary/5 flex gap-2 sticky bottom-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={loading || selectedTypes.length === 0}
            className="flex-1 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[9px] tracking-widest uppercase transition-all hud-corner glow-border flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            {loading ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}