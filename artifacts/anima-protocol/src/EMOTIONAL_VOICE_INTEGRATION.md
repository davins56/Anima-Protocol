# Emotional Voice Synthesis Integration Guide

## Components Created

### 1. **EmotionalVoiceAdapter** (`components/voice/EmotionalVoiceAdapter.jsx`)
- `emotionToVoiceParams()` - Maps 8 emotions to ElevenLabs voice parameters
- `useEmotionalVoice()` - React hook for managing emotional voice state
- `EmotionalVoiceIndicator` - Visual component showing voice parameter adjustments

### 2. **enhanceVoiceWithEmotion** (`functions/enhanceVoiceWithEmotion.js`)
- Backend function integrating character emotions with ElevenLabs API
- Adjusts: stability, similarity_boost, style, speaker_boost
- Falls back to standard TTS if emotional synthesis fails

### 3. **Updated useElevenLabsTTS** (`hooks/useElevenLabsTTS.js`)
- Now accepts `characterEmotion` and `emotionIntensity` parameters
- Routes through emotional TTS when emotion is provided
- Graceful fallback to standard TTS

## Emotion-to-Voice Mapping

| Emotion | Stability | Style | Pace | Effect |
|---------|-----------|-------|------|--------|
| **Joyful** | Low (0.4-0.6) | High (25-50) | Fast (1.1-1.2x) | Upbeat, expressive |
| **Calm** | High (0.7-0.85) | Low (5-15) | Slow (0.9-1.0x) | Steady, relaxed |
| **Sad** | Medium (0.65-0.8) | Medium (30-50) | Slow (0.8-0.9x) | Melancholic, drawn |
| **Angry** | Low (0.3-0.5) | Very High (50-70) | Fast (1.2-1.35x) | Sharp, aggressive |
| **Anxious** | Low (0.4-0.55) | High (40-60) | Fast (1.15-1.25x) | Jittery, rushed |
| **Peaceful** | High (0.75-0.95) | Very Low (10-15) | Slow (0.82-0.98x) | Serene, grounded |
| **Hopeful** | Medium (0.55-0.7) | Medium (20-35) | Normal-Fast (1.05-1.13x) | Positive, forward |
| **Conflicted** | Low (0.45-0.65) | Medium-High (35-55) | Normal (1.0-1.08x) | Wavering, uncertain |

## Integration Steps

### 1. Update Chat.jsx (in sections, page is large)

Import the emotional adapter:
```javascript
import { useEmotionalVoice } from "@/components/voice/EmotionalVoiceAdapter";
```

Get active character's emotion:
```javascript
const activeCharEmotion = activeSession?.character_id
  ? characterEmotions[activeSession.character_id]
  : null;
```

Pass emotion to TTS hook:
```javascript
const elTTS = useElevenLabsTTS(activeCharEmotion?.emotion, activeCharEmotion?.intensity);
```

### 2. Add Emotional Voice Indicator to Chat Header

In `components/chat/ChatHeader.jsx`, add:
```javascript
import EmotionalVoiceIndicator from "@/components/voice/EmotionalVoiceAdapter";

// Inside component, after mood display:
{characterEmotions[activeCharId] && (
  <EmotionalVoiceIndicator 
    emotion={characterEmotions[activeCharId].emotion}
    intensity={characterEmotions[activeCharId].intensity}
  />
)}
```

### 3. Update speakMessage() Function

In Chat.jsx's `speakMessage()`:
```javascript
const speakMessage = useCallback((content, charName) => {
  const char = characters.find((c) => c.name === charName);
  const voiceId = char?.elevenlabs_voice_id;
  
  // Get character's current emotional state
  const charEmotion = characterEmotions[char?.id];
  
  // Pass emotion to TTS
  if (voiceId && elTTS.isEnabled) {
    elTTS.speak(content, voiceId, charEmotion?.emotion, charEmotion?.intensity);
  } else if (tts.isEnabled) {
    tts.speak(content);
  }
}, [characters, elTTS, tts, characterEmotions]);
```

## Voice Parameter Behavior

### Stability (0.0 - 1.0)
- **Low (0.3-0.5)**: High variation, more emotional expression (angry, anxious)
- **High (0.7-0.95)**: Consistent, stable delivery (calm, peaceful)
- Used to vary pitch, tone, and intonation

### Style (0-100)
- **Low (5-15)**: Neutral, professional
- **Medium (20-40)**: Noticeable emotional coloring
- **High (50-70)**: Very expressive, exaggerated
- Adds exaggeration to emotional nuances

### Similarity Boost (0.0 - 1.0)
- Higher values maintain character similarity
- Lower values allow more emotional deviation
- Calm/peaceful: High similarity (0.8)
- Sad/conflicted: Lower similarity (0.7) for emotional vulnerability

### Speaker Boost
- Always enabled for emotional synthesis
- Amplifies character-specific vocal characteristics

## Testing Emotional Synthesis

Use test card for Stripe: `4242 4242 4242 4242`

Test emotions by triggering character state changes in chat:
- Happy moment → Character emotion changes to "joyful"
- Argument → Character emotion changes to "angry"
- Reflection → Character emotion changes to "calm"
- Listen for voice parameter changes in TTS output

## Performance Considerations

- Emotional synthesis adds ~200-500ms latency (ElevenLabs API call)
- Fallback to standard TTS if latency > 5s
- Cache voice parameters per emotion to reduce API calls
- Browser caches audio blobs locally

## Future Enhancements

1. **Prosody Patterns**: Add pitch curves for different emotions
2. **Multi-character Emotion**: Blend voices when characters interact
3. **Emotion Transitions**: Smooth transitions between emotional states
4. **Custom Voice Profiles**: Per-character emotional voice tuning
5. **Real-time Adjustment**: Slider controls for manual voice tweaking