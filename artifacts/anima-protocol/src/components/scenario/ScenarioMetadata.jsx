import { useState } from 'react';
import { X } from 'lucide-react';

const SUGGESTION_TAGS = [
  'romance', 'adventure', 'mystery', 'fantasy', 'sci-fi', 'horror',
  'slice-of-life', 'drama', 'comedy', 'angst', 'wholesome', 'dark'
];

export default function ScenarioMetadata({
  title, setTitle,
  description, setDescription,
  difficulty, setDifficulty,
  estimatedDuration, setEstimatedDuration,
  tags, setTags
}) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = (tag) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag) => {
    setTags(tags.filter(t => t !== tag));
  };

  return (
    <div className="space-y-4 p-4 border border-primary/20 bg-black/40 rounded-lg">
      <h2 className="font-mono text-sm text-primary tracking-wide">Scenario Details</h2>

      {/* Title */}
      <div className="space-y-2">
        <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">Title *</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Your scenario name..."
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors rounded"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">Description *</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What's your scenario about? Describe the setting, tone, and what players can expect..."
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
          rows="3"
        />
      </div>

      {/* Difficulty & Duration */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">Difficulty</label>
          <select
            value={difficulty}
            onChange={e => setDifficulty(e.target.value)}
            className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-2.5 py-2 focus:outline-none focus:border-primary/50 transition-colors rounded"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">Duration</label>
          <input
            type="text"
            value={estimatedDuration}
            onChange={e => setEstimatedDuration(e.target.value)}
            placeholder="e.g. 2-4 hours"
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-2.5 py-2 focus:outline-none focus:border-primary/50 transition-colors rounded"
          />
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">Tags</label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <button
              key={tag}
              onClick={() => handleRemoveTag(tag)}
              className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border border-primary/30 text-primary/70 hover:text-primary text-[8px] font-mono rounded transition-all"
            >
              {tag}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {showTagInput ? (
            <input
              autoFocus
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleAddTag(tagInput.toLowerCase());
                  setShowTagInput(false);
                }
              }}
              onBlur={() => setShowTagInput(false)}
              placeholder="Custom tag..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
            />
          ) : (
            <div className="flex flex-wrap gap-1">
              {SUGGESTION_TAGS.filter(t => !tags.includes(t)).map(tag => (
                <button
                  key={tag}
                  onClick={() => handleAddTag(tag)}
                  className="px-2 py-0.5 bg-black/60 border border-primary/15 text-primary/40 hover:text-primary/60 hover:border-primary/30 text-[8px] font-mono rounded transition-all"
                >
                  + {tag}
                </button>
              ))}
              <button
                onClick={() => setShowTagInput(true)}
                className="px-2 py-0.5 bg-black/60 border border-primary/15 text-primary/40 hover:text-primary/60 hover:border-primary/30 text-[8px] font-mono rounded transition-all"
              >
                + Custom
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}