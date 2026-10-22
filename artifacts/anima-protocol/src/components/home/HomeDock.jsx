import { MessageCircle, Users, Globe, User, Images } from "lucide-react";

const ITEMS = [
  { id: "talk", label: "Talk", Icon: MessageCircle },
  { id: "people", label: "People", Icon: Users },
  { id: "world", label: "World", Icon: Globe },
  { id: "you", label: "You", Icon: User },
  { id: "moments", label: "Moments", Icon: Images },
];

export default function HomeDock({ onTalk, onPeople, onWorld, onYou, onMoments }) {
  const handlers = { talk: onTalk, people: onPeople, world: onWorld, you: onYou, moments: onMoments };
  // Moments (Photo Moments album) only shows when Home has a companion to open it for.
  const items = ITEMS.filter((item) => item.id !== "moments" || typeof onMoments === "function");

  return (
    <nav
      data-home-dock
      aria-label="Home"
      className="flex items-stretch border border-cyan-400/20 bg-black/70 backdrop-blur-md"
    >
      {items.map(({ id, label, Icon }) => (
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
