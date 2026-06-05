import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Save, Loader, AlertCircle } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import WorldSettingsEditor from '@/components/scenario/WorldSettingsEditor';
import CharacterBaseBuilder from '@/components/scenario/CharacterBaseBuilder';
import ScenarioMetadata from '@/components/scenario/ScenarioMetadata';

export default function CreateScenario() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [estimatedDuration, setEstimatedDuration] = useState('2-4 hours');
  const [tags, setTags] = useState([]);
  const [worldSettings, setWorldSettings] = useState({});
  const [characterBases, setCharacterBases] = useState([]);
  const [isPublished, setIsPublished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    // Load existing scenario if editing
    const params = new URLSearchParams(window.location.search);
    const scenarioId = params.get('id');
    if (scenarioId) {
      loadScenario(scenarioId);
    }
  }, []);

  const loadScenario = async (id) => {
    try {
      const scenario = await base44.entities.SharedScenario.list().then(s => 
        s.find(sc => sc.id === id)
      );
      if (scenario) {
        setTitle(scenario.title);
        setDescription(scenario.description);
        setPrompt(scenario.prompt);
        setDifficulty(scenario.difficulty || 'intermediate');
        setEstimatedDuration(scenario.estimated_duration || '2-4 hours');
        setTags(scenario.tags || []);
        setWorldSettings(scenario.world_settings || {});
        setCharacterBases(scenario.character_bases || []);
        setIsPublished(scenario.is_published || false);
      }
    } catch (err) {
      console.error('Error loading scenario:', err);
    }
  };

  const validateScenario = () => {
    const newErrors = [];

    if (!title.trim()) newErrors.push('Scenario title is required');
    if (!description.trim()) newErrors.push('Description is required');
    if (!prompt.trim()) newErrors.push('Opening prompt is required');
    if (characterBases.length === 0) newErrors.push('At least one character base is required');
    if (title.length < 3) newErrors.push('Title must be at least 3 characters');
    if (description.length < 10) newErrors.push('Description must be at least 10 characters');
    if (prompt.length < 20) newErrors.push('Opening prompt must be at least 20 characters');

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSave = async (shouldPublish = false) => {
    if (!validateScenario()) return;

    setLoading(true);
    try {
      const scenarioData = {
        title: title.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        difficulty,
        estimated_duration: estimatedDuration,
        tags,
        world_settings: worldSettings,
        character_bases: characterBases,
        is_published: shouldPublish,
      };

      const params = new URLSearchParams(window.location.search);
      const scenarioId = params.get('id');

      if (scenarioId) {
        await base44.entities.SharedScenario.update(scenarioId, scenarioData);
      } else {
        const created = await base44.entities.SharedScenario.create(scenarioData);
        setSuccessMessage('Scenario created successfully!');
        setTimeout(() => navigate(`/scenario-hub`), 1500);
      }
    } catch (err) {
      setErrors(['Error saving scenario: ' + err.message]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">Create Scenario</h1>
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-2">
            Build your world, define characters, and share
          </p>
        </div>

        {/* Errors */}
        <AnimatePresence>
          {errors.length > 0 && (
            <div className="p-4 border border-red-400/30 bg-red-900/20 rounded space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <p className="font-mono text-[9px] text-red-400 tracking-widest uppercase">Validation Errors</p>
              </div>
              {errors.map((error, idx) => (
                <p key={idx} className="text-[9px] font-mono text-red-300 ml-6">
                  • {error}
                </p>
              ))}
            </div>
          )}
        </AnimatePresence>

        {/* Success */}
        {successMessage && (
          <div className="p-4 border border-green-400/30 bg-green-900/20 rounded">
            <p className="text-[9px] font-mono text-green-400 tracking-widest uppercase">{successMessage}</p>
          </div>
        )}

        {/* Metadata */}
        <ScenarioMetadata
          title={title}
          setTitle={setTitle}
          description={description}
          setDescription={setDescription}
          difficulty={difficulty}
          setDifficulty={setDifficulty}
          estimatedDuration={estimatedDuration}
          setEstimatedDuration={setEstimatedDuration}
          tags={tags}
          setTags={setTags}
        />

        {/* Opening Prompt */}
        <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
          <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">
            Opening Narrative Prompt *
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe how the story begins. This sets the tone and context for players..."
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
            rows="6"
          />
          <p className="text-[8px] text-primary/40 font-mono">{prompt.length} / 20 (min) characters</p>
        </div>

        {/* World Settings */}
        <WorldSettingsEditor
          worldSettings={worldSettings}
          setWorldSettings={setWorldSettings}
        />

        {/* Character Bases */}
        <CharacterBaseBuilder
          characterBases={characterBases}
          setCharacterBases={setCharacterBases}
        />

        {/* Publishing */}
        <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={e => setIsPublished(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="font-mono text-[9px] text-primary/70 tracking-widest uppercase">
              Publish to Scenario Hub
            </span>
          </label>
          <p className="text-[8px] text-primary/40 ml-7">
            {isPublished
              ? 'Your scenario will be visible to all users and appear on the Scenario Hub.'
              : 'Keep as draft for private use or later publishing.'}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={() => navigate(-1)}
            className="flex-1 px-4 py-3 border border-primary/20 text-primary/50 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            {loading && <Loader className="w-4 h-4 animate-spin" />}
            {loading ? 'Saving...' : 'Save Draft'}
          </button>
          {isPublished && (
            <button
              onClick={() => handleSave(true)}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-cyan-600/30 border border-cyan-400/60 text-cyan-400 hover:bg-cyan-600/50 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              {loading && <Loader className="w-4 h-4 animate-spin" />}
              {loading ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}