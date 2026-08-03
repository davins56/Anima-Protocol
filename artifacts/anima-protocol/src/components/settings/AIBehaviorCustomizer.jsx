import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

export default function AIBehaviorCustomizer({ characterId, onSave }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [characterId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const configs = await base44.entities.AIBehaviorConfig.filter({
        character_id: characterId,
      });
      if (configs?.length > 0) {
        setConfig(configs[0]);
      } else {
        // Create default config
        const newConfig = await base44.entities.AIBehaviorConfig.create({
          character_id: characterId,
          response_style: 50,
          narrative_tone: 50,
          character_influence: 70,
          dialogue_depth: 60,
          worldbuilding_intensity: 40,
          relationship_influence: 60,
        });
        setConfig(newConfig);
      }
    } catch (err) {
      console.error("Error loading config:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSynthesizeTraits = async () => {
    if (!config) return;
    setSynthesizing(true);
    try {
      const result = await base44.functions.invoke(
        "synthesizeCharacterTraits",
        { character_id: characterId }
      );
      if (result?.data?.traits) {
        const updated = {
          ...config,
          synth_traits: {
            ...result.data.traits,
            last_researched: new Date().toISOString(),
          },
        };
        setConfig(updated);
      }
    } catch (err) {
      console.error("Error synthesizing traits:", err);
    } finally {
      setSynthesizing(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await base44.entities.AIBehaviorConfig.update(config.id, config);
      onSave?.(config);
    } catch (err) {
      console.error("Error saving config:", err);
    } finally {
      setSaving(false);
    }
  };

  const updateSlider = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading config...
          </p>
        </div>
      </div>
    );
  }

  if (!config) return null;

  const sliders = [
    {
      id: "response_style",
      label: "Response Style",
      min: "Verbose",
      max: "Concise",
      desc: "How much detail vs brevity",
    },
    {
      id: "narrative_tone",
      label: "Narrative Tone",
      min: "Poetic",
      max: "Direct",
      desc: "Elaborate prose vs plain speech",
    },
    {
      id: "character_influence",
      label: "Character Influence",
      min: "Independent",
      max: "Strict",
      desc: "How much to match personality",
    },
    {
      id: "dialogue_depth",
      label: "Dialogue Depth",
      min: "Simple",
      max: "Philosophical",
      desc: "Surface chat vs deep discussion",
    },
    {
      id: "worldbuilding_intensity",
      label: "World-Building",
      min: "Minimal",
      max: "Immersive",
      desc: "Lore/world detail injection level",
    },
    {
      id: "relationship_influence",
      label: "Relationship Influence",
      min: "Neutral",
      max: "Dynamic",
      desc: "How much relationship scores matter",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Sliders */}
      <div className="space-y-4">
        {sliders.map((slider) => (
          <motion.div
            key={slider.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border border-primary/15 bg-black/40 rounded"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-mono text-xs text-primary tracking-wider uppercase">
                  {slider.label}
                </h3>
                <p className="text-[8px] font-mono text-primary/40 mt-0.5">
                  {slider.desc}
                </p>
              </div>
              <span className="font-mono text-sm text-primary/70 w-12 text-right">
                {config[slider.id]}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[8px] font-mono text-primary/50 w-16 text-right">
                {slider.min}
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={config[slider.id]}
                onChange={(e) =>
                  updateSlider(slider.id, parseInt(e.target.value))
                }
                className="flex-1 accent-primary"
              />
              <span className="text-[8px] font-mono text-primary/50 w-16">
                {slider.max}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Synthesized Traits */}
      {config.synth_traits && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-4 border border-green-400/30 bg-green-400/5 rounded space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs text-green-400 tracking-wider uppercase">
              Synthesized Traits
            </h3>
            <button
              onClick={handleSynthesizeTraits}
              disabled={synthesizing}
              className="flex items-center gap-1 px-2.5 py-1 text-green-400/60 hover:text-green-400 border border-green-400/30 hover:border-green-400/50 font-mono text-[9px] tracking-widest uppercase transition-all disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              {synthesizing ? "Researching..." : "Re-research"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {config.synth_traits.dominant_emotions && (
              <div>
                <p className="text-[8px] font-mono text-green-400/60 tracking-widest uppercase mb-1">
                  Emotions
                </p>
                <div className="space-y-0.5">
                  {config.synth_traits.dominant_emotions.slice(0, 3).map((e, i) => (
                    <p key={i} className="text-[9px] font-mono text-green-400/70">
                      • {e}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {config.synth_traits.speech_patterns && (
              <div>
                <p className="text-[8px] font-mono text-green-400/60 tracking-widest uppercase mb-1">
                  Speech Patterns
                </p>
                <div className="space-y-0.5">
                  {config.synth_traits.speech_patterns.slice(0, 3).map((s, i) => (
                    <p key={i} className="text-[9px] font-mono text-green-400/70">
                      • {s}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {config.synth_traits.motivations && (
              <div className="col-span-2">
                <p className="text-[8px] font-mono text-green-400/60 tracking-widest uppercase mb-1">
                  Motivations
                </p>
                <div className="space-y-0.5">
                  {config.synth_traits.motivations.slice(0, 3).map((m, i) => (
                    <p key={i} className="text-[9px] font-mono text-green-400/70">
                      • {m}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-[8px] font-mono text-green-400/40">
            Last researched:{" "}
            {new Date(config.synth_traits.last_researched).toLocaleDateString()}
          </p>
        </motion.div>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        {!config.synth_traits && (
          <button
            onClick={handleSynthesizeTraits}
            disabled={synthesizing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-400/10 border border-green-400/40 text-green-400 hover:bg-green-400/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all"
          >
            {synthesizing ? (
              <>
                <Loader className="w-3 h-3 animate-spin" />
                Researching...
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3" />
                Research & Synthesize
              </>
            )}
          </button>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-xs tracking-widest uppercase transition-all"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}