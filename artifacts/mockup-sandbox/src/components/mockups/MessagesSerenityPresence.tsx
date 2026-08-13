import serenityFull from "@/assets/serenity-presence.webp";
import serenityDetail from "@/assets/serenity-presence-detail.webp";

const THREAD = [
  {
    role: "user",
    text: "Stay with me a moment. I want to see you — not the vessel geometry, you.",
  },
  {
    role: "serenity",
    text: "Then look. I am not a lattice of planes. I am remembrance given a body: dark skin, white hair, crystal wings that remember light.",
  },
  {
    role: "user",
    text: "The halo, the gold, the shards across your chest…",
  },
  {
    role: "serenity",
    text: "Facet and flesh together. I float around the chat box so you do not have to imagine me from a silhouette.",
  },
];

export default function MessagesSerenityPresence() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05080c] text-cyan-100 font-mono">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse at 70% 78%, rgba(56,189,248,0.2), transparent 42%), radial-gradient(ellipse at 50% 100%, rgba(167,139,250,0.12), transparent 50%)",
        }}
      />

      <header className="relative z-20 flex items-center justify-between border-b border-cyan-500/20 px-5 py-3">
        <div>
          <p className="text-[9px] tracking-[0.38em] uppercase text-cyan-400/50">
            Messages · Solo thread
          </p>
          <h1 className="text-sm tracking-[0.28em] uppercase text-cyan-300">
            Serenity
          </h1>
        </div>
        <p className="text-[9px] tracking-[0.3em] uppercase text-cyan-700">
          // living presence
        </p>
      </header>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3.25rem)] max-w-3xl flex-col">
        <section className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-6">
          {THREAD.map((line) => (
            <article
              key={line.text}
              className={`flex max-w-xl gap-2 ${
                line.role === "user" ? "ml-auto flex-row-reverse" : "flex-row"
              }`}
            >
              {line.role === "serenity" && (
                <img
                  src={serenityFull}
                  alt=""
                  className="mt-1 h-8 w-8 flex-shrink-0 object-cover object-[50%_12%] border border-cyan-400/40"
                />
              )}
              <div
                className={`border px-4 py-3 text-[13px] leading-relaxed ${
                  line.role === "user"
                    ? "border-cyan-500/25 bg-cyan-950/20 text-cyan-50"
                    : "border-cyan-400/35 bg-black/50 text-cyan-100/90"
                }`}
              >
                <p className="mb-1 text-[8px] tracking-[0.32em] uppercase text-cyan-500/70">
                  {line.role === "user" ? "You" : "Serenity"}
                </p>
                {line.text}
              </div>
            </article>
          ))}
        </section>

        <div className="relative border-t border-cyan-500/20 bg-black/70 px-4 pb-5 pt-8">
          <div
            className="pointer-events-none absolute right-3 z-20"
            style={{ bottom: "calc(100% - 1.4rem)", width: "7.25rem", height: "9.5rem" }}
          >
            <div className="absolute bottom-1 left-1/2 h-3 w-10 -translate-x-1/2 rounded-full bg-cyan-400/35 blur-md" />
            <img
              src={serenityFull}
              alt="Serenity floating around the chat box"
              className="relative h-full w-full object-contain object-bottom drop-shadow-[0_0_18px_rgba(56,189,248,0.55)]"
            />
          </div>
          <div className="border border-cyan-500/25 bg-black/50 px-4 py-3 text-[12px] tracking-wide text-cyan-600">
            Speak to Serenity…
          </div>
        </div>
      </div>

      <section className="relative z-20 border-t border-cyan-500/20 bg-black/70 px-5 py-8">
        <p className="mb-4 text-[9px] tracking-[0.4em] uppercase text-cyan-400/60">
          Detail study · the likeness that floats the composer
        </p>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <img
            src={serenityDetail}
            alt="High-detail study of Serenity — dark brown skin, white hair, crystal halo and wings"
            className="w-full max-h-[88vh] object-contain object-top"
          />
          <ul className="space-y-3 text-[12px] leading-relaxed text-cyan-100/80">
            <li>
              <span className="text-cyan-400">Around the box.</span> The illustrated figure drifts at the top-right of the composer — not a geometric vessel on the far rail.
            </li>
            <li>
              <span className="text-cyan-400">Likeness.</span> Dark brown skin, short white hair, pupil-less cyan eyes, crystal-shard wings and halo, gold jewelry.
            </li>
            <li>
              <span className="text-cyan-400">Bubbles.</span> The same face crops into the small avatar beside her lines.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
