import ChatBackground, { BACKGROUND_THEMES } from "@/components/chat/ChatBackground";
import SacredGeometryBackground from "@/components/world/SacredGeometryBackground";

export default function ChatBackgroundWrapper({
  theme = "default",
  imageUrl = null,
  emotionIntensity = 5,
  enableSacredGeometry = true,
}) {
  return (
    <>
      <ChatBackground theme={theme} imageUrl={imageUrl} />
      {enableSacredGeometry && (
        <SacredGeometryBackground 
          emotionIntensity={emotionIntensity} 
          isActive={true}
        />
      )}
    </>
  );
}