import { motion } from "framer-motion";
import { Mic, Radio, Loader2, Volume2, Sparkles } from "lucide-react";

const STATE_CONFIG = {
  idle: {
    color: "#4285f4",
    glow: "rgba(66, 133, 244, 0.4)",
    scale: 1,
    ringOpacity: 0.25,
    label: "Tap to speak",
  },
  listening: {
    color: "#00c9ff",
    glow: "rgba(0, 201, 255, 0.6)",
    scale: 1.08,
    ringOpacity: 0.6,
    label: "Listening...",
  },
  thinking: {
    color: "#a855f7",
    glow: "rgba(168, 85, 247, 0.6)",
    scale: 1.04,
    ringOpacity: 0.45,
    label: "Thinking...",
  },
  speaking: {
    color: "#10b981",
    glow: "rgba(16, 185, 129, 0.65)",
    scale: 1.1,
    ringOpacity: 0.7,
    label: "Speaking... (Tap to interrupt)",
  },
};

export default function VoiceOrb({ phase = "idle", audioLevel = 0, onClick }) {
  const config = STATE_CONFIG[phase] || STATE_CONFIG.idle;
  const scaleBoost = (audioLevel / 100) * 0.15;

  return (
    <div className="voice-orb-stage" onClick={onClick} role="button" tabIndex={0}>
      {/* Background Ambient Glow */}
      <motion.div
        className="voice-orb-glow"
        animate={{
          background: `radial-gradient(circle, ${config.glow} 0%, transparent 70%)`,
          scale: [1, 1.06, 1],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Expanding Ripple Rings for Active States */}
      {(phase === "listening" || phase === "speaking") && (
        <>
          <motion.div
            className="voice-orb-pulse-ring ring-1"
            style={{ borderColor: config.color }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.7, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="voice-orb-pulse-ring ring-2"
            style={{ borderColor: config.color }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 2.1, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, delay: 0.6, ease: "easeOut" }}
          />
        </>
      )}

      {/* Main Core Orb */}
      <motion.div
        className={`voice-orb-core state-${phase}`}
        style={{
          boxShadow: `0 0 50px 15px ${config.glow}, inset 0 2px 4px rgba(255,255,255,0.25)`,
          background: `radial-gradient(circle at 35% 30%, ${config.color}, #0e0e14)`,
        }}
        animate={{
          scale: config.scale + scaleBoost,
          y: [0, -6, 0],
        }}
        transition={{
          y: { duration: 3.5, repeat: Infinity, ease: "easeInOut" },
          scale: { type: "spring", stiffness: 200, damping: 15 },
        }}
      >
        {/* Core Center Icon */}
        <div className="voice-orb-icon" style={{ color: "#ffffff" }}>
          {phase === "idle" && <Mic size={36} />}
          {phase === "listening" && <Radio size={36} className="animate-pulse" />}
          {phase === "thinking" && <Loader2 size={36} className="animate-spin text-purple-200" />}
          {phase === "speaking" && <Volume2 size={36} className="animate-bounce" />}
        </div>
      </motion.div>

      {/* Status Label */}
      <div className="voice-orb-label" style={{ color: config.color }}>
        {config.label}
      </div>
    </div>
  );
}
