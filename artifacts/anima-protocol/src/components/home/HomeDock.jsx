import { MessageCircle, Users, Globe, User } from "lucide-react";

const ITEMS = [
  { id: "talk", label: "Talk", Icon: MessageCircle },
  { id: "people", label: "People", Icon: Users },
  { id: "world", label: "World", Icon: Globe },
  { id: "you", label: "You", Icon: User },
];

export default function HomeDock({ onTalk, onPeople, onWorld, onYou }) {
  const handlers = { talk: onTalk, people: onPeople, world: onWorld, you: onYou };

  return (
    <nav
      data-home-dock
      aria-label="Home"
      className="flex items-stretch border border-cyan-400/20 bg-black/70 backdrop-blur-md"
    >
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={handlers[id]}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-3 text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-400/5 transition-colors"
        >
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.6} />
          <span className="font-mono text-[8px] tracking-[0.2em] uppercase">{label}</span>
        </button>
      ))}
    </nav>
  );
}
