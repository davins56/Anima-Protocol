import { useAmbientAudio } from '@/hooks/useAmbientAudio';
import AmbientAudioPlayer from '@/components/audio/AmbientAudioPlayer';

export default function AmbientAudioSection({
  sessionId,
  location,
  characterEmotions,
  narrativeContext,
  isVisible = true,
}) {
  const ambient = useAmbientAudio(sessionId, location, characterEmotions, narrativeContext);

  if (!isVisible) return null;

  return (
    <AmbientAudioPlayer
      sessionId={sessionId}
      location={location}
      characterEmotions={characterEmotions}
      narrativeContext={narrativeContext}
      isVisible={isVisible}
    />
  );
}