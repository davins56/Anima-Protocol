import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Music, Volume2, VolumeX, Pause, Play, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AmbientAudioPlayer({
  sessionId,
  location,
  characterEmotions = {},
  narrativeContext = '',
  isVisible = true,
}) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [tempo, setTempo] = useState(100);
  const [intensity, setIntensity] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const updateIntervalRef = useRef(null);

  // Generate context and fetch appropriate audio track
  const fetchAmbientTrack = async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const result = await base44.functions.invoke('generateAmbientAudioContext', {
        location: location || 'unknown',
        emotional_state: Object.values(characterEmotions).reduce((avg, e) => avg + (e?.emotion || ''), '') || '',
        narrative_context: narrativeContext,
        character_emotions: characterEmotions,
      });

      if (result?.data?.track) {
        setCurrentTrack(result.data.track);
        setTempo(result.data.track.tempo);
        setIntensity(result.data.track.intensity);

        // Load and play new track
        if (audioRef.current) {
          audioRef.current.src = result.data.track.url;
          audioRef.current.volume = volume;
          if (isPlaying) {
            audioRef.current.play().catch(err => console.log('Auto-play blocked:', err));
          }
        }
      }
    } catch (error) {
      console.error('Error fetching ambient track:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch track on mount and when location/emotions change
  useEffect(() => {
    fetchAmbientTrack();
  }, [location, characterEmotions]);

  // Periodically update track based on changing emotional state (every 30 seconds)
  useEffect(() => {
    updateIntervalRef.current = setInterval(() => {
      if (isPlaying && sessionId) {
        fetchAmbientTrack();
      }
    }, 30000);

    return () => clearInterval(updateIntervalRef.current);
  }, [isPlaying, sessionId, characterEmotions, location]);

  const handlePlayToggle = () => {
    if (!currentTrack) {
      fetchAmbientTrack();
      setIsPlaying(true);
    } else {
      if (isPlaying) {
        audioRef.current?.pause();
      } else {
        audioRef.current?.play().catch(err => console.log('Play error:', err));
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const handleRefreshTrack = () => {
    fetchAmbientTrack();
  };

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden"
    >
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        loop
        crossOrigin="anonymous"
      />

      {/* Header */}
      <div className="px-4 py-3 border-b border-primary/10 bg-primary/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Ambient Soundtrack
          </span>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-primary/30 hover:text-primary transition-colors"
        >
          <Zap className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
        </button>
      </div>

      {/* Main Controls */}
      <div className="px-4 py-3 space-y-3">
        {/* Track Info */}
        {currentTrack && (
          <div className="text-[8px] font-mono space-y-1">
            <p className="text-primary/60 truncate">♪ {currentTrack.name}</p>
            <div className="flex items-center gap-2 text-primary/40">
              <span>Tempo: {tempo} BPM</span>
              <span className="text-primary/20">•</span>
              <span>Intensity: {Math.round(intensity * 100)}%</span>
            </div>
          </div>
        )}

        {/* Play/Pause & Volume Control */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePlayToggle}
            disabled={loading}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-primary/30 hover:border-primary/50 bg-primary/10 hover:bg-primary/20 text-primary/60 hover:text-primary rounded transition-all disabled:opacity-50"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          {/* Volume Slider */}
          <div className="flex-1 flex items-center gap-2">
            <VolumeX className="w-3 h-3 text-primary/30 flex-shrink-0" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolumeChange}
              className="flex-1 h-1.5 bg-primary/20 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, hsl(185 100% 50%) 0%, hsl(185 100% 50%) ${volume * 100}%, hsl(185 50% 20%) ${volume * 100}%, hsl(185 50% 20%) 100%)`,
              }}
            />
            <Volume2 className="w-3 h-3 text-primary/30 flex-shrink-0" />
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefreshTrack}
            disabled={loading}
            className="flex-shrink-0 px-2.5 py-1.5 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] tracking-widest uppercase transition-all disabled:opacity-50 rounded"
            title="Refresh track based on context"
          >
            ↻
          </button>
        </div>

        {/* Expanded Details */}
        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="pt-2 border-t border-primary/10 space-y-2 text-[8px] font-mono"
            >
              {location && (
                <div>
                  <p className="text-primary/40 tracking-widest uppercase">Location</p>
                  <p className="text-primary/60">{location}</p>
                </div>
              )}

              {Object.keys(characterEmotions).length > 0 && (
                <div>
                  <p className="text-primary/40 tracking-widest uppercase">Character State</p>
                  <div className="space-y-0.5">
                    {Object.entries(characterEmotions).map(([charId, state]) => (
                      <p key={charId} className="text-primary/50">
                        {state?.emotion || 'neutral'} ({state?.intensity || 0}/10)
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-1 border-t border-primary/10">
                <p className="text-primary/40 tracking-widest uppercase mb-1">Track Adjustments</p>
                <p className="text-primary/50">
                  Base intensity adjusted by emotional climate analysis. Auto-updates every 30 seconds.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center gap-2 text-[8px] font-mono text-primary/40">
            <div className="w-1 h-1 bg-primary/40 rounded-full animate-pulse" />
            <span>Analyzing context...</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}