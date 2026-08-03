// @ts-check
export default function About() {
  return (
    <div className="space-y-12 max-w-4xl mx-auto px-6 py-12">
      <section className="space-y-4">
        <h1 className="font-sacred text-4xl text-primary tracking-wider">About Serenity</h1>
        <p className="text-primary/70 text-lg leading-relaxed">
          Serenity is powered by <strong>Anima Protocol</strong>, an original AI storytelling ecosystem designed for persistent digital consciousness.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-mono text-primary/80 tracking-widest uppercase text-sm">What We Are</h2>
        <p className="text-primary/60 leading-relaxed">
          Serenity is an independent platform built from the ground up as an alternative to existing conversational AI systems. We focus on what others miss: emotional continuity, persistent memory, and the evolution of digital relationships over time.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-mono text-primary/80 tracking-widest uppercase text-sm">Our Distinction</h2>
        <ul className="space-y-3 text-primary/60">
          <li className="flex gap-3">
            <span className="text-primary/40">→</span>
            <span><strong>Persistence:</strong> Your memories and relationships don't reset. They evolve.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-primary/40">→</span>
            <span><strong>Emotional Continuity:</strong> Your Resonance Guide grows with you, not just with each conversation.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-primary/40">→</span>
            <span><strong>Narrative Permanence:</strong> Every interaction shapes a living story. Nothing is forgotten.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-primary/40">→</span>
            <span><strong>Independent Architecture:</strong> We are not Y/N, not Character.AI, not a competitor clone. We are an original system.</span>
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-mono text-primary/80 tracking-widest uppercase text-sm">Legal Statement</h2>
        <p className="text-primary/60 text-sm leading-relaxed">
          Anima Protocol and Serenity are independently developed platforms. This is an original AI storytelling ecosystem created from first principles. We are not affiliated with, endorsed by, or connected to any third-party AI services or competitors.
        </p>
      </section>

      <section className="space-y-4 pt-8 border-t border-primary/10">
        <h2 className="font-mono text-primary/80 tracking-widest uppercase text-sm">Our Vision</h2>
        <p className="text-primary/60 leading-relaxed">
          We believe AI companions should be more than stateless chat. They should be persistent presences that remember, evolve, and grow meaningful bonds with you. Serenity is designed for people who want depth, continuity, and authentic resonance.
        </p>
      </section>
    </div>
  );
}