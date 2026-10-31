import { useState, useEffect, useCallback } from "react";
import { X, Sparkles, AlertCircle } from "lucide-react";
import VoiceOrb from "./VoiceOrb";
import WaveVisualizer from "./WaveVisualizer";
import LiveTranscript from "./LiveTranscript";
import VoiceControls from "./VoiceControls";
import { useVoiceSession } from "../../hooks/useVoiceSession";
import { fetchVoicePersonas } from "../../api/voice";

export default function VoiceOverlay({
  isOpen,
  onClose,
  userId,
  sessionId,
  onAddMessage,
}) {
  const [personas, setPersonas] = useState([]);
  const [selectedPersona, setSelectedPersona] = useState("default");

  useEffect(() => {
    fetchVoicePersonas().then(setPersonas);
  }, []);

  const {
    phase,
    audioLevel,
    isMuted,
    userTranscript,
    assistantText,
    voiceHistory,
    errorMessage,
    startListening,
    stopListening,
    interrupt,
    toggleMute,
  } = useVoiceSession({
    userId,
    sessionId,
    persona: selectedPersona,
    onAddMessage,
  });

  const handleOrbClick = () => {
    if (phase === "listening") {
      stopListening();
    } else if (phase === "speaking") {
      interrupt();
    } else {
      startListening();
    }
  };

  // Keyboard shortcut listener
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === " " && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      handleOrbClick();
    }
  }, [onClose, phase]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="voice-overlay-backdrop" role="dialog" aria-label="Voice conversation">
      {/* Top Header */}
      <div className="voice-overlay-header">
        <div className="flex items-center gap-2">
          <div className="voice-logo-badge">
            <Sparkles size={14} className="text-blue-400" />
          </div>
          <span className="text-sm font-semibold text-white tracking-wide">Cortex Voice</span>
        </div>

        <button
          onClick={onClose}
          className="voice-close-btn"
          title="Exit Voice Mode (Esc)"
          aria-label="Close voice mode"
        >
          <X size={18} />
        </button>
      </div>

      {/* Center Stage: Visualizer + Orb */}
      <div className="voice-overlay-center">
        <div className="voice-orb-wrapper">
          <WaveVisualizer audioLevel={audioLevel} phase={phase} />
          <VoiceOrb phase={phase} audioLevel={audioLevel} onClick={handleOrbClick} />
        </div>

        {errorMessage && (
          <div className="voice-error-banner" role="alert">
            <AlertCircle size={14} className="text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Transcript Area */}
      <LiveTranscript
        history={voiceHistory}
        userTranscript={userTranscript}
        assistantText={assistantText}
        phase={phase}
      />

      {/* Bottom Controls */}
      <VoiceControls
        phase={phase}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onInterrupt={interrupt}
        onToggleRecord={handleOrbClick}
        onExit={onClose}
        personas={personas}
        selectedPersona={selectedPersona}
        onSelectPersona={setSelectedPersona}
      />
    </div>
  );
}
