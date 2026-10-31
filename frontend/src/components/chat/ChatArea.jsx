import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Brain,
  PanelLeftOpen,
  ArrowDown,
  FileText,
  Image,
  Volume2,
  Film,
  Settings,
} from "lucide-react";
import Message from "./Message";
import Composer from "./Composer";
import MemoryConsolidateModal from "./MemoryConsolidateModal";
import CompactVoiceBar from "../voice/CompactVoiceBar";
import { useVoiceSession } from "../../hooks/useVoiceSession";

const CAPABILITIES = [
  { id: "docs", icon: <FileText size={15} className="text-blue-400" />, title: "Document", desc: "Upload PDFs, code or docs to ask questions" },
  { id: "vision", icon: <Image size={15} className="text-emerald-400" />, title: "Vision & Media", desc: "Attach images and video for deep visual analysis" },
  { id: "voice", icon: <Volume2 size={15} className="text-purple-400" />, title: "Speech & Audio", desc: "Speak in real-time or upload audio recordings" },
  { id: "memory", icon: <Brain size={15} className="text-amber-400" />, title: "Persistent Memory", desc: "Consolidates knowledge across conversations" },
];

/**
 * CompactVoiceCompanion - Encapsulates active session-scoped voice lifecycle inside ChatArea.
 */
function CompactVoiceCompanion({
  userId,
  sessionId,
  selectedVoice = "default",
  onAddMessage,
  onClose,
}) {
  const {
    phase,
    audioLevel,
    isMuted,
    userTranscript,
    assistantText,
    errorMessage,
    startListening,
    stopListening,
    submitSpeech,
    interrupt,
    toggleMute,
  } = useVoiceSession({
    userId,
    sessionId,
    persona: selectedVoice,
    autoStart: true,
    onAddMessage,
  });

  return (
    <CompactVoiceBar
      phase={phase}
      audioLevel={audioLevel}
      isMuted={isMuted}
      userTranscript={userTranscript}
      assistantText={assistantText}
      errorMessage={errorMessage}
      personaLabel={
        selectedVoice
          ? selectedVoice.charAt(0).toUpperCase() + selectedVoice.slice(1)
          : "Default"
      }
      onToggleMute={toggleMute}
      onStartListening={startListening}
      onSubmitSpeech={submitSpeech}
      onInterrupt={interrupt}
      onClose={onClose}
    />
  );
}

export default function ChatArea({
  session,
  messages,
  isSidebarOpen,
  onToggleSidebar,
  onSendMessage,
  isStreaming,
  onStopStreaming,
  onOpenVoiceMode,
  isVoiceActive = false,
  onCloseVoiceMode,
  selectedVoice = "default",
  onAddMessage,
  onOpenSettings,
  onEditMessage,
  onRetryMessage,
  userId,
  draftText = "",
  onDraftTextChange,
  draftAttachments = [],
  onDraftAttachmentsChange,
}) {
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);

  const scrollContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isUserScrollingRef = useRef(false);

  // Smooth scroll to bottom
  const scrollToBottom = (smooth = true) => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  };

  // Auto-scroll when new messages arrive or when streaming
  useEffect(() => {
    if (!isUserScrollingRef.current) {
      scrollToBottom(!isStreaming);
    }
  }, [messages, isStreaming, isVoiceActive]);

  // Handle manual scroll to detect if user is browsing history
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    const isNearBottom = distanceFromBottom < 100;
    isUserScrollingRef.current = !isNearBottom;
    setShowScrollBtn(!isNearBottom);
  };

  const handleStarterPrompt = (promptText) => {
    onSendMessage({ text: promptText });
  };

  return (
    <div className="chat-workspace">
      {/* Top Conversation Header */}
      <header className="chat-header">
        <div className="chat-header-left">
          {!isSidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="chat-sidebar-open-btn"
              title="Open sidebar (Ctrl+/)"
              aria-label="Open sidebar"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          <h1 className="chat-header-title truncate" title={session?.title}>
            {session?.title || "New Conversation"}
          </h1>
        </div>

        <div className="chat-header-right">
          <button
            onClick={() => setIsMemoryModalOpen(true)}
            className="chat-memory-action-btn"
            title="Update persistent long-term memory from this chat"
          >
            <Brain size={14} className="text-purple-400" />
            <span className="hidden sm:inline">Update Memory</span>
          </button>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="chat-settings-action-btn"
              title="Settings & Voice Preferences"
              aria-label="Settings"
            >
              <Settings size={15} className="text-slate-300" />
            </button>
          )}
        </div>
      </header>

      {/* Main Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="chat-scroll-container"
      >
        <div className="chat-messages-inner">
          {messages.length === 0 ? (
            /* Empty State: Welcome & Starter Cards */
            <div className="chat-welcome-container">
              <div className="chat-welcome-badge">
                <Sparkles size={16} className="text-blue-400" />
                <span>Next-Gen Private Multimodal AI</span>
              </div>

              <h2 className="chat-welcome-title">How can Cortex help you today?</h2>
              <p className="chat-welcome-subtitle">
                Chat, analyze files, transcribe audio, or start a natural voice conversation.
              </p>

              <div className="chat-capabilities-grid">
                {CAPABILITIES.map((cap) => (
                  <div
                    key={cap.id}
                    onClick={() => {
                      if (cap.id === "voice") {
                        onOpenVoiceMode?.();
                      } else {
                        handleStarterPrompt(`Tell me more about ${cap.title.toLowerCase()}`);
                      }
                    }}
                    className="capability-card"
                    role="button"
                    tabIndex={0}
                  >
                    <div className="capability-icon-wrapper">{cap.icon}</div>
                    <h3 className="capability-card-title">{cap.title}</h3>
                    <p className="capability-card-desc">{cap.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Message Timeline */
            messages.map((msg, index) => (
              <Message
                key={msg.id || index}
                message={msg}
                isLastTurn={index === messages.length - 1}
                isStreaming={isStreaming && index === messages.length - 1}
                onEditMessage={onEditMessage}
                onRetryMessage={onRetryMessage}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Floating Scroll to Bottom FAB */}
      {showScrollBtn && (
        <button
          onClick={() => {
            isUserScrollingRef.current = false;
            scrollToBottom(true);
          }}
          className="chat-scroll-bottom-fab"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} />
        </button>
      )}

      {/* In-Chat Compact Voice Mode (PRD Section 6.1, UI-01, UI-02, UI-08) */}
      {isVoiceActive && (
        <div className="chat-compact-voice-container">
          <CompactVoiceCompanion
            key={`voice-${session?.id}`}
            userId={userId}
            sessionId={session?.id}
            selectedVoice={selectedVoice}
            onAddMessage={onAddMessage}
            onClose={onCloseVoiceMode}
          />
        </div>
      )}

      {/* Anchored Composer Input Bar */}
      <div className="chat-composer-anchor">
        <Composer
          onSendMessage={onSendMessage}
          isStreaming={isStreaming}
          onStopStreaming={onStopStreaming}
          onOpenVoiceMode={onOpenVoiceMode}
          userId={userId}
          draftText={draftText}
          onDraftTextChange={onDraftTextChange}
          draftAttachments={draftAttachments}
          onDraftAttachmentsChange={onDraftAttachmentsChange}
        />
      </div>

      {/* Memory Consolidation Modal */}
      <MemoryConsolidateModal
        isOpen={isMemoryModalOpen}
        onClose={() => setIsMemoryModalOpen(false)}
        userId={userId}
        sessionId={session?.id}
      />
    </div>
  );
}
