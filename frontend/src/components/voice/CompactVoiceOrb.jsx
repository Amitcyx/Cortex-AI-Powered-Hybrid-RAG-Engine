import { memo } from "react";
import { Mic, MicOff, Radio, Loader2, Volume2, AlertCircle } from "lucide-react";

/**
 * CompactVoiceOrb - Lightweight reactive orb for Compact Voice Mode.
 * Designed for low CPU / integrated graphics: uses pure CSS gradients, transforms,
 * and opacity rather than heavy canvas or WebGL. Respects prefers-reduced-motion.
 */
function CompactVoiceOrb({
  phase = "listening", // "listening" | "thinking" | "speaking" | "muted" | "idle" | "error"
  audioLevel = 0,     // 0 - 100 smoothed audio energy
  isMuted = false,
  onClick,
  disabled = false,
}) {
  const currentPhase = isMuted ? "muted" : phase;

  // Compute slight bounded scale boost from audio level (max +15% scale to prevent jitter)
  const scaleBoost = currentPhase === "speaking" || currentPhase === "listening"
    ? (audioLevel / 100) * 0.15
    : 0;

  const getAriaLabel = () => {
    switch (currentPhase) {
      case "listening":
        return "Voice listening. Click to pause.";
      case "speaking":
        return "Assistant speaking. Click to interrupt.";
      case "thinking":
        return "Assistant thinking...";
      case "muted":
        return "Microphone muted. Click to unmute.";
      case "error":
        return "Voice error. Click to retry.";
      default:
        return "Voice idle. Click to speak.";
    }
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={`compact-voice-orb-btn phase-${currentPhase}`}
      style={{
        transform: `scale(${1 + scaleBoost})`,
      }}
      title={getAriaLabel()}
      aria-label={getAriaLabel()}
      disabled={disabled}
    >
      {/* Outer ambient glow ring */}
      <span className="compact-voice-orb-glow" />

      {/* Ripple ring for active speech/listening */}
      {(currentPhase === "listening" || currentPhase === "speaking") && (
        <span className="compact-voice-orb-pulse" />
      )}

      {/* Core gradient sphere */}
      <span className="compact-voice-orb-core">
        {currentPhase === "listening" && <Radio size={16} className="orb-icon pulse-icon" />}
        {currentPhase === "thinking" && <Loader2 size={16} className="orb-icon spin-icon" />}
        {currentPhase === "speaking" && <Volume2 size={16} className="orb-icon speak-icon" />}
        {currentPhase === "muted" && <MicOff size={16} className="orb-icon muted-icon" />}
        {currentPhase === "error" && <AlertCircle size={16} className="orb-icon error-icon" />}
        {currentPhase === "idle" && <Mic size={16} className="orb-icon idle-icon" />}
      </span>
    </button>
  );
}

export default memo(CompactVoiceOrb);
