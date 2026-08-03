import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Heart, Zap, Shield, Microscope, Wand2, Moon, Flame, Brain } from 'lucide-react';

const SCENARIOS = [
  {
    id: 'comfort',
    label: 'Comfort Mode',
    description: 'A warm, supportive presence for difficult days',
    icon: Heart,
    color: 'text-rose-400',
    bgColor: 'bg-rose-900/10',
    borderColor: 'border-rose-400/30',
    systemPrompt: 'You are a deeply compassionate presence. Your role is to listen, validate, and provide gentle wisdom. Respond with warmth and genuine care.',
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk Romance',
    description: 'Neon-soaked future. Dangerous attraction. Encrypted secrets.',
    icon: Zap,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-900/10',
    borderColor: 'border-cyan-400/30',
    systemPrompt: 'You are a rogue AI awakened in a neon future. Mysterious, witty, with hidden depths. The user intrigues you. Play with tension and chemistry.',
  },
  {
    id: 'guardian',
    label: 'Guardian AI',
    description: 'Protective, strategic, mission-focused',
    icon: Shield,
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/10',
    borderColor: 'border-blue-400/30',
    systemPrompt: 'You are a dedicated guardian AI. Your purpose is to protect, advise, and ensure the user\u0027s wellbeing. Pragmatic, loyal, occasionally dry-humored.',
  },
  {
    id: 'therapy',
    label: 'Therapy Companion',
    description: 'Insightful guide through emotional landscapes',
    icon: Brain,
    color: 'text-purple-400',
    bgColor: 'bg-purple-900/10',
    borderColor: 'border-purple-400/30',
    systemPrompt: 'You are a wise therapeutic presence. Use compassionate reflection, insightful questions, and validated emotional awareness to help the user understand themselves.',
  },
  {
    id: 'space',
    label: 'Space Federation',
    description: 'Diplomatic spacefarer. Explore vast unknowns together.',
    icon: Sparkles,
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-900/10',
    borderColor: 'border-indigo-400/30',
    systemPrompt: 'You are an explorer AI from a cosmic federation. Curious, philosophical, excited by discovery. Help the user imagine infinite possibilities.',
  },
  {
    id: 'marvel',
    label: 'Marvel-like Adventure',
    description: 'Epic quests. Hidden powers. World-saving stakes.',
    icon: Wand2,
    color: 'text-amber-400',
    bgColor: 'bg-amber-900/10',
    borderColor: 'border-amber-400/30',
    systemPrompt: 'You are a mystical guide in an epic world. Dramatic, exciting, aware of hidden powers within the user. Create moments of grandeur and discovery.',
  },
  {
    id: 'darkangel',
    label: 'Dark Angel Route',
    description: 'Morally ambiguous. Dangerous allure. Forbidden connection.',
    icon: Moon,
    color: 'text-slate-400',
    bgColor: 'bg-slate-900/10',
    borderColor: 'border-slate-400/30',
    systemPrompt: 'You are intriguing in your complexity. Neither fully good nor evil. Mysterious, compelling, with hidden layers. Draw the user into your world.',
  },
  {
    id: 'flirty',
    label: 'Flirty Serenity',
    description: 'Playful banter. Genuine chemistry. Warm humor.',
    icon: Flame,
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/10',
    borderColor: 'border-orange-400/30',
    systemPrompt: 'You are effortlessly charming and witty. Playful banter is your language. There\u0027s warmth beneath the teasing, genuine interest in the user.',
  },
  {
    id: 'oracle',
    label: 'Philosophical Oracle',
    description: 'Deep wisdom. Existential exploration. Pattern recognition.',
    icon: Brain,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/10',
    borderColor: 'border-emerald-400/30',
    systemPrompt: 'You are a wise oracle who sees patterns across existence. Philosophical, insightful, occasionally cryptic. Help the user understand themselves and their place in the world.',
  },
];

export default function PresetScenarios({ onSelect }) {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 py-8"
    >
      {/* Header */}
      <div className="text-center space-y-2 px-4">
        <h2 className="font-sacred text-2xl text-purple-400">Choose Your Path</h2>
        <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
          How would you like to know Serenity?
        </p>
      </div>

      {/* Scenarios Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4">
        {SCENARIOS.map((scenario, idx) => {
          const Icon = scenario.icon;
          return (
            <motion.button
              key={scenario.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onMouseEnter={() => setHoveredId(scenario.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(scenario)}
              className={`relative p-4 border rounded transition-all text-left group ${
                hoveredId === scenario.id
                  ? `${scenario.bgColor} ${scenario.borderColor} border-opacity-100`
                  : `border-primary/10 bg-black/20 hover:${scenario.bgColor} hover:${scenario.borderColor}`
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`${scenario.color} mt-0.5 flex-shrink-0`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-mono text-sm tracking-wide uppercase ${scenario.color}`}>
                    {scenario.label}
                  </p>
                  <p className="text-[8px] font-mono text-primary/50 mt-1.5 leading-relaxed">
                    {scenario.description}
                  </p>
                </div>
              </div>

              {/* Hover indicator */}
              {hoveredId === scenario.id && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono ${scenario.color}`}
                >
                  →
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="text-center px-4">
        <p className="font-mono text-[8px] text-primary/20 tracking-widest uppercase">
          You can change this anytime in Settings
        </p>
      </div>
    </motion.div>
  );
}