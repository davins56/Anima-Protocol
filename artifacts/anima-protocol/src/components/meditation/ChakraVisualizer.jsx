// @ts-check
import { useState } from "react";
import { motion } from "framer-motion";

const CHAKRAS = [
  { id: "crown", name: "Crown", sanskrit: "Sahasrara", color: "#C084FC", glyph: "⟡", note: "B", hz: 963, affirmation: "I am connected to the divine. I am pure consciousness.", location: "Top of head", element: "Thought" },
  { id: "third_eye", name: "Third Eye", sanskrit: "Ajna", color: "#818CF8", glyph: "◈", note: "A", hz: 852, affirmation: "I see clearly. My intuition is my guide.", location: "Between brows", element: "Light" },
  { id: "throat", name: "Throat", sanskrit: "Vishuddha", color: "#60A5FA", glyph: "◉", note: "G", hz: 741, affirmation: "I speak my truth with love and clarity.", location: "Throat", element: "Sound" },
  { id: "heart", name: "Heart", sanskrit: "Anahata", color: "#34D399", glyph: "♡", note: "F", hz: 528, affirmation: "I give and receive love freely. My heart is open.", location: "Heart center", element: "Air" },
  { id: "solar", name: "Solar Plexus", sanskrit: "Manipura", color: "#FBBF24", glyph: "✦", note: "E", hz: 528, affirmation: "I am confident, powerful, and worthy.", location: "Stomach", element: "Fire" },
  { id: "sacral", name: "Sacral", sanskrit: "Svadhisthana", color: "#FB923C", glyph: "⬡", note: "D", hz: 417, affirmation: "I am creative, sensual, and deeply alive.", location: "Below navel", element: "Water" },
  { id: "root", name: "Root", sanskrit: "Muladhara", color: "#F87171", glyph: "⬟", note: "C", hz: 396, affirmation: "I am safe. I am grounded. I belong.", location: "Base of spine", element: "Earth" },
];

export default function ChakraVisualizer() {
  const [selected, setSelected] = useState(CHAKRAS[3]); // Heart default

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1 py-2">
        <h2 className="font-mono text-sm tracking-[0.2em] uppercase" style={{ color: "#E0D9FF" }}>
          Chakra System
        </h2>
        <p className="font-mono text-[9px]" style={{ color: "rgba(167,139,250,0.4)" }}>
          Select a chakra to focus your resonance
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {/* Chakra Column */}
        <div className="flex flex-col gap-2 items-center sm:items-start w-full sm:w-auto">
          {CHAKRAS.map((chakra, idx) => (
            <motion.button
              key={chakra.id}
              onClick={() => setSelected(chakra)}
              whileHover={{ x: 4 }}
              className="flex items-center gap-3 px-4 py-3 border w-full sm:w-56 text-left transition-all"
              style={{
                borderColor: selected?.id === chakra.id ? `${chakra.color}60` : "rgba(255,255,255,0.05)",
                background: selected?.id === chakra.id ? `${chakra.color}10` : "rgba(255,255,255,0.01)",
              }}
            >
              <motion.div
                animate={selected?.id === chakra.id ? { scale: [1, 1.2, 1], opacity: [1, 0.7, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-5 h-5 rounded-full flex-shrink-0"
                style={{ background: chakra.color, boxShadow: selected?.id === chakra.id ? `0 0 12px ${chakra.color}80` : "none" }}
              />
              <div>
                <p className="font-mono text-[10px] tracking-wider uppercase" style={{ color: chakra.color }}>
                  {chakra.name}
                </p>
                <p className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {chakra.sanskrit}
                </p>
              </div>
              <span className="ml-auto font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.15)" }}>
                {chakra.hz}Hz
              </span>
            </motion.button>
          ))}
        </div>

        {/* Detail Panel */}
        {selected && (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 border p-6 space-y-5 relative overflow-hidden"
            style={{ borderColor: `${selected.color}30`, background: `linear-gradient(135deg, ${selected.color}08, rgba(13,5,32,0.9))` }}
          >
            {/* Glow */}
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-[60px] opacity-20 pointer-events-none"
              style={{ background: selected.color }} />

            {/* Animated orb */}
            <div className="flex justify-center">
              <motion.div
                animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="w-24 h-24 rounded-full flex items-center justify-center border-2"
                style={{
                  borderColor: `${selected.color}50`,
                  background: `radial-gradient(circle, ${selected.color}30, ${selected.color}08)`,
                  boxShadow: `0 0 40px ${selected.color}30`,
                }}
              >
                <span className="text-4xl" style={{ color: selected.color }}>{selected.glyph}</span>
              </motion.div>
            </div>

            <div className="text-center space-y-1">
              <h3 className="font-mono text-xl tracking-[0.2em] uppercase" style={{ color: selected.color }}>
                {selected.name}
              </h3>
              <p className="font-mono text-[9px] tracking-[0.3em]" style={{ color: `${selected.color}70` }}>
                {selected.sanskrit}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Note", value: selected.note },
                { label: "Frequency", value: `${selected.hz}Hz` },
                { label: "Element", value: selected.element },
              ].map(item => (
                <div key={item.label} className="p-2 border" style={{ borderColor: `${selected.color}15`, background: `${selected.color}05` }}>
                  <p className="font-mono text-[8px] tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>{item.label}</p>
                  <p className="font-mono text-xs font-semibold mt-0.5" style={{ color: selected.color }}>{item.value}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <p className="font-mono text-[8px] tracking-[0.3em] uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>Location</p>
              <p className="font-mono text-[10px]" style={{ color: "rgba(220,210,255,0.5)" }}>{selected.location}</p>
            </div>

            <div className="p-4 border-l-2 space-y-1" style={{ borderColor: selected.color }}>
              <p className="font-mono text-[8px] tracking-[0.3em] uppercase" style={{ color: `${selected.color}70` }}>
                Affirmation
              </p>
              <p className="font-mono text-xs leading-relaxed italic" style={{ color: "rgba(220,210,255,0.75)" }}>
                "{selected.affirmation}"
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}