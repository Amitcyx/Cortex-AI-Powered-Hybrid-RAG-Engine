import { useState, useEffect, useRef } from "react";
import {
  X,
  Volume2,
  Check,
  Play,
  Square,
  Sparkles,
  Settings,
  Shield,
  Layers,
  Cpu,
} from "lucide-react";
import { fetchVoicePersonas, fetchIntroAudioBlob } from "../../api/voice";

const STORAGE_KEY = "cortex_voice_preference";

export default function SettingsModal({
  isOpen,
  onClose,
  selectedVoice = "default",
  onVoiceChange,
}) {
  const [activeTab, setActiveTab] = useState("voice");
  const [personas, setPersonas] = useState([]);
  const [activePreview, setActivePreview] = useState(null); // persona name playing
  const audioRef = useRef(null);

  // Load supported personas on mount
  useEffect(() => {
    if (isOpen) {
      fetchVoicePersonas().then(setPersonas);
    }
  }, [isOpen]);

  // Clean up audio playback on unmount or close
  const stopAudio = () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current = null;
      } catch {}
    }
    setActivePreview(null);
  };

  useEffect(() => {
    return () => stopAudio();
  }, []);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        stopAudio();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelectVoice = (name) => {
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {}
    onVoiceChange?.(name);
  };

  const handlePlayPreview = async (persona) => {
    if (activePreview === persona.name) {
      stopAudio();
      return;
    }
    stopAudio();

    try {
      setActivePreview(persona.name);
      const blob = await fetchIntroAudioBlob(persona.voice || persona.name);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setActivePreview(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setActivePreview(null);
        audioRef.current = null;
      };

      await audio.play();
    } catch {
      setActivePreview(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        stopAudio();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="settings-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-modal-header">
          <div className="flex items-center gap-2">
            <div className="settings-icon-badge">
              <Settings size={16} className="text-blue-400" />
            </div>
            <h2 id="settings-modal-title" className="settings-modal-title">
              Settings & Preferences
            </h2>
          </div>

          <button
            onClick={() => {
              stopAudio();
              onClose();
            }}
            className="modal-close-btn"
            title="Close Settings (Esc)"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body with Sidebar Tabs */}
        <div className="settings-modal-body">
          {/* Settings Navigation Tabs */}
          <div className="settings-nav-tabs">
            <button
              className={`settings-tab-btn ${activeTab === "voice" ? "active" : ""}`}
              onClick={() => setActiveTab("voice")}
            >
              <Volume2 size={16} />
              <span>Voice</span>
            </button>
            <button
              className={`settings-tab-btn ${activeTab === "system" ? "active" : ""}`}
              onClick={() => setActiveTab("system")}
            >
              <Layers size={16} />
              <span>System & RAG</span>
            </button>
          </div>

          {/* Tab Content Panel */}
          <div className="settings-content-panel">
            {activeTab === "voice" && (
              <div className="settings-section">
                <div className="settings-section-heading">
                  <h3 className="settings-section-title">Assistant Voice & Persona</h3>
                  <p className="settings-section-subtitle">
                    Select the voice tone Cortex AI uses during live voice sessions. This preference
                    is saved and applied automatically to all future voice chats.
                  </p>
                </div>

                {/* Voice Selection Cards */}
                <div className="voice-personas-grid">
                  {personas.map((p) => {
                    const isSelected = selectedVoice === p.name;
                    const isPlaying = activePreview === p.name;

                    return (
                      <div
                        key={p.name}
                        onClick={() => handleSelectVoice(p.name)}
                        className={`voice-persona-card ${isSelected ? "selected" : ""}`}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            handleSelectVoice(p.name);
                          }
                        }}
                      >
                        <div className="voice-persona-meta">
                          <div className="flex items-center gap-2">
                            <span className="voice-persona-label">{p.label}</span>
                            <span className="voice-persona-sub">({p.voice})</span>
                            {isSelected && (
                              <span className="voice-selected-pill">
                                <Check size={11} className="mr-0.5" /> Active
                              </span>
                            )}
                          </div>
                          <p className="voice-persona-desc">{p.description}</p>
                        </div>

                        {/* Preview Audio Play/Stop Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayPreview(p);
                          }}
                          className={`voice-preview-btn ${isPlaying ? "playing" : ""}`}
                          title={isPlaying ? "Stop preview" : `Preview ${p.label} voice`}
                          aria-label={`Preview ${p.label} voice`}
                        >
                          {isPlaying ? (
                            <Square size={13} className="text-purple-400 fill-purple-400" />
                          ) : (
                            <Play size={13} className="text-slate-300" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="settings-voice-tip">
                  <Sparkles size={14} className="text-blue-400 shrink-0" />
                  <span>
                    Compact Voice Mode uses this selected voice automatically. The live chat view stays
                    clean and minimal with no voice dropdowns cluttering the screen.
                  </span>
                </div>
              </div>
            )}

            {activeTab === "system" && (
              <div className="settings-section">
                <div className="settings-section-heading">
                  <h3 className="settings-section-title">System & Retrieval Engine</h3>
                  <p className="settings-section-subtitle">
                    Technical configuration and status for Cortex AI's hybrid RAG pipeline.
                  </p>
                </div>

                <div className="system-info-cards">
                  <div className="system-info-card">
                    <div className="system-info-icon">
                      <Cpu size={16} className="text-emerald-400" />
                    </div>
                    <div>
                      <div className="system-info-title">LLM & Vision Engine</div>
                      <div className="system-info-value">Groq Qwen 3.8 27B + NVIDIA Nemotron Omni</div>
                    </div>
                  </div>

                  <div className="system-info-card">
                    <div className="system-info-icon">
                      <Layers size={16} className="text-blue-400" />
                    </div>
                    <div>
                      <div className="system-info-title">Hybrid Retrieval (RRF + Cross-Encoder)</div>
                      <div className="system-info-value">ChromaDB (all-MiniLM-L6-v2) + BM25 + ms-marco</div>
                    </div>
                  </div>

                  <div className="system-info-card">
                    <div className="system-info-icon">
                      <Shield size={16} className="text-purple-400" />
                    </div>
                    <div>
                      <div className="system-info-title">Storage & Privacy</div>
                      <div className="system-info-value">Local SQLite + Local Vector Store (Zero data retention)</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-modal-footer">
          <button
            type="button"
            className="settings-done-btn"
            onClick={() => {
              stopAudio();
              onClose();
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
