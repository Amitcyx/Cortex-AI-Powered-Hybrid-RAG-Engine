import { Mic, MicOff, Zap, PhoneOff, Settings, Volume2, VolumeX } from "lucide-react";

export default function VoiceControls({
  phase,
  isMuted,
  onToggleMute,
  onInterrupt,
  onToggleRecord,
  onExit,
  personas = [],
  selectedPersona,
  onSelectPersona,
}) {
  const isSpeaking = phase === "speaking";

  return (
    <div className="voice-controls-bar">
      {/* Persona Selection */}
      <div className="voice-persona-dropdown-wrapper">
        <select
          value={selectedPersona}
          onChange={(e) => onSelectPersona(e.target.value)}
          className="voice-persona-select"
          aria-label="Select voice persona"
        >
          {personas.map((p) => (
            <option key={p.name || p.id} value={p.name || p.id}>
              {p.label || p.name} ({p.voice || "Voice"})
            </option>
          ))}
        </select>
      </div>

      {/* Center Action Controls */}
      <div className="voice-action-group">
        {/* Main Microphone Talk / Stop Button */}
        {phase === "listening" ? (
          <button
            type="button"
            onClick={onToggleRecord}
            className="voice-ctrl-btn listening-active-btn"
            title="Stop listening & process speech"
            aria-label="Stop recording"
          >
            <span className="voice-rec-dot animate-ping" />
            <Mic size={18} className="text-red-400" />
            <span>Done</span>
          </button>
        ) : phase === "speaking" ? (
          <button
            type="button"
            onClick={onInterrupt}
            className="voice-ctrl-btn interrupt-btn"
            title="Interrupt AI speaking (Space)"
            aria-label="Interrupt AI"
          >
            <Zap size={18} className="text-amber-400" />
            <span>Interrupt</span>
          </button>
        ) : phase === "thinking" ? (
          <button
            type="button"
            disabled
            className="voice-ctrl-btn opacity-80 cursor-wait"
            title="Thinking..."
          >
            <span className="animate-spin inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full" />
            <span>Thinking...</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleRecord}
            className="voice-ctrl-btn talk-btn"
            title="Start talking (Tap orb or press Space)"
            aria-label="Start speaking"
          >
            <Mic size={18} className="text-blue-400" />
            <span>Speak</span>
          </button>
        )}

        {/* Mute Speaker Toggle */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`voice-ctrl-btn ${isMuted ? "muted" : ""}`}
          title={isMuted ? "Unmute audio" : "Mute audio"}
          aria-label={isMuted ? "Unmute audio" : "Mute audio"}
        >
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>

        {/* Exit Voice Mode */}
        <button
          type="button"
          onClick={onExit}
          className="voice-ctrl-btn exit-btn"
          title="Exit Voice Mode (Esc)"
          aria-label="Exit Voice Mode"
        >
          <PhoneOff size={18} />
          <span>Exit</span>
        </button>
      </div>
    </div>
  );
}
