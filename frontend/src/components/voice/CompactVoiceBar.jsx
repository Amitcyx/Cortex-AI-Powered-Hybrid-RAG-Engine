import { useEffect, useCallback } from "react";
import { Mic, MicOff, X, Sparkles } from "lucide-react";
import CompactVoiceOrb from "./CompactVoiceOrb";

/**
 * CompactVoiceBar - Session-scoped compact voice companion embedded inside the active chat.
 * Fulfills CORTEX AI Compact Voice Mode PRD (31 Oct 2026):
 * - Keeps chat completely visible.
 * - Minimal live UI: compact orb, single status label, subtle secondary transcript,
 *   and essential controls (Mute + End).
 * - No secondary selectors in live view (voice selector is managed in Sidebar -> Settings).
 * - Closes on Escape.
 */
export default function CompactVoiceBar({
  phase = "listening", // "listening" | "thinking" | "speaking" | "idle" | "error" | "muted"
  audioLevel = 0,
  isMuted = false,
  userTranscript = "",
  assistantText = "",
  errorMessage = "",
  personaLabel = "Default",
  onToggleMute,
  onStartListening,
  onSubmitSpeech,
  onInterrupt,
  onClose,
}) {
  const currentPhase = isMuted ? "muted" : phase;

  const handleOrbClick = useCallback(() => {
    if (currentPhase === "speaking") {
      onInterrupt?.();
    } else if (currentPhase === "listening") {
      // Tapping while listening immediately submits speech (or user can pause to auto-submit via VAD)
      onSubmitSpeech?.();
    } else if (currentPhase === "muted") {
      onToggleMute?.();
    } else {
      onStartListening?.();
    }
  }, [currentPhase, onInterrupt, onSubmitSpeech, onToggleMute, onStartListening]);

  // Keyboard shortcut listener (Escape to close, Space to talk/interrupt)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      } else if (
        e.key === " " &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA" &&
        !e.target.isContentEditable
      ) {
        e.preventDefault();
        handleOrbClick();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handleOrbClick]);

  // Determine concise status copy matching PRD Section 9
  const getStatusText = () => {
    if (errorMessage) {
      return errorMessage.length > 55 ? `${errorMessage.slice(0, 55)}...` : errorMessage;
    }
    switch (currentPhase) {
      case "listening":
        return "Listening (speak or tap to send)";
      case "thinking":
        return "Thinking…";
      case "speaking":
        return "Speaking (tap to interrupt)";
      case "muted":
        return "Microphone off";
      default:
        return "Tap orb to speak";
    }
  };

  // Secondary lightweight transcript line (PRD UI-05)
  const displayTranscript = currentPhase === "speaking"
    ? assistantText
    : userTranscript;

  return (
    <div
      className={`compact-voice-bar phase-${currentPhase}`}
      role="region"
      aria-label="Active voice companion"
    >
      {/* Left: Small Reactive Orb */}
      <div className="compact-voice-orb-wrapper">
        <CompactVoiceOrb
          phase={currentPhase}
          audioLevel={audioLevel}
          isMuted={isMuted}
          onClick={handleOrbClick}
        />
      </div>

      {/* Middle: Concise Status & Subtle Transcript */}
      <div className="compact-voice-content">
        <div className="compact-voice-status-row">
          <div className="compact-voice-status-badge">
            <span className={`compact-status-dot dot-${currentPhase}`} />
            <span className="compact-voice-status-label">{getStatusText()}</span>
          </div>

          <span className="compact-voice-persona-hint" title={`Active Voice Persona: ${personaLabel}`}>
            <Sparkles size={11} className="inline text-blue-400 mr-1" />
            {personaLabel}
          </span>
        </div>

        {/* Lightweight, secondary transcript line */}
        {displayTranscript && (
          <div className="compact-voice-transcript truncate" title={displayTranscript}>
            “{displayTranscript}”
          </div>
        )}
      </div>

      {/* Right: Essential Session Controls (PRD UI-07) */}
      <div className="compact-voice-actions">
        {/* Mute/Unmute microphone control */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`compact-voice-action-btn ${isMuted ? "active-muted" : ""}`}
          title={isMuted ? "Unmute microphone (Space)" : "Mute microphone"}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? (
            <MicOff size={16} className="text-red-400" />
          ) : (
            <Mic size={16} className="text-slate-300" />
          )}
        </button>

        {/* End / Close voice mode */}
        <button
          type="button"
          onClick={onClose}
          className="compact-voice-action-btn close-btn"
          title="End voice session (Esc)"
          aria-label="End voice session"
        >
          <X size={16} className="text-slate-300" />
        </button>
      </div>
    </div>
  );
}
