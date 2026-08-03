// @ts-check
export const BACKGROUND_THEMES = [
  {
    id: "default",
    label: "Default",
    preview: "bg-background"
  },
  {
    id: "matrix",
    label: "Matrix",
    preview: "bg-gradient-to-b from-green-900 to-background"
  },
  {
    id: "nebula",
    label: "Nebula",
    preview: "bg-gradient-to-b from-purple-900 via-blue-900 to-background"
  },
  {
    id: "grid",
    label: "Grid",
    preview: "bg-background"
  },
  {
    id: "custom",
    label: "Custom",
    preview: "bg-primary/10"
  }
];

/**
 * @param {{ theme?: string, imageUrl?: string | null }} props
 */
export default function ChatBackground({ theme, imageUrl }) {
  if (theme === "custom" && imageUrl) {
    return (
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center"
        }}
      >
        <div className="absolute inset-0 bg-black/40" />
      </div>
    );
  }

  switch (theme) {
    case "matrix":
      return (
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-green-950 to-background overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-px h-full bg-green-500"
                style={{
                  left: `${(i / 20) * 100}%`,
                  animation: `pulse 3s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`
                }}
              />
            ))}
          </div>
        </div>
      );
    case "nebula":
      return (
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-purple-900 via-blue-900 to-background overflow-hidden">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" />
          <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: "2s" }} />
        </div>
      );
    case "grid":
      return (
        <div className="absolute inset-0 z-0 bg-background overflow-hidden">
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `linear-gradient(0deg, transparent 24%, hsl(185 100% 50% / 0.1) 25%, hsl(185 100% 50% / 0.1) 26%, transparent 27%, transparent 74%, hsl(185 100% 50% / 0.1) 75%, hsl(185 100% 50% / 0.1) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, hsl(185 100% 50% / 0.1) 25%, hsl(185 100% 50% / 0.1) 26%, transparent 27%, transparent 74%, hsl(185 100% 50% / 0.1) 75%, hsl(185 100% 50% / 0.1) 76%, transparent 77%, transparent)`,
              backgroundSize: "50px 50px"
            }}
          />
        </div>
      );
    default:
      return <div className="absolute inset-0 z-0 bg-background" />;
  }
}