// Sends content OUT of the app — to collaborators, beta readers, or just
// a plain file on disk. The point of this component is structural: it
// keeps the app from being the only place the work (or the relationship
// with it) can live.

import { useState } from 'react';

interface ShareExportProps {
  title: string;
  content: string;
  /** e.g. "scene", "lore-entry", "journal-entry", "serenity-conversation" */
  kind: string;
}

function downloadAsFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ShareExport({ title, content, kind }: ShareExportProps) {
  const [copied, setCopied] = useState(false);

  const filenameSafe = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadAsFile(`${filenameSafe || kind}.txt`, content);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: content });
      } catch {
        // user cancelled — no-op
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={handleShare}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        Share
      </button>
      <button
        onClick={handleDownload}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        Download .txt
      </button>
      <button
        onClick={handleCopy}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {copied ? 'Copied' : 'Copy text'}
      </button>
    </div>
  );
}
