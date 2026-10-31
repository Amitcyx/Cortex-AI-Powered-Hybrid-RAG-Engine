import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import Sidebar from "./components/sidebar/Sidebar";
import ChatArea from "./components/chat/ChatArea";
import SettingsModal from "./components/settings/SettingsModal";
import AuthModal from "./components/auth/AuthModal";
import HealthBanner from "./components/common/HealthBanner";
import ToastContainer, { showToast } from "./components/common/Toast";
import { useAuth } from "./hooks/useAuth";
import { useConversations } from "./hooks/useConversations";
import { useChatStream } from "./hooks/useChatStream";
import { useHealth } from "./hooks/useHealth";
import { sendImageChat, sendVideoChat, sendAudioChat } from "./api/chat";
import { uploadDocument } from "./api/files";

const VOICE_PREF_KEY = "cortex_voice_preference";

export default function App() {
  const {
    currentUser,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    login,
    register,
    logout,
  } = useAuth();

  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    messages,
    createNewChat,
    deleteSession,
    renameSession,
    addMessage,
    updateMessage,
    appendToMessage,
    truncateMessagesFrom,
  } = useConversations(currentUser?.id);

  const { isStreaming, startStream, stopStream } = useChatStream();
  const isOnline = useHealth(25000);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // Compact Voice Mode state (PRD Section 1.0 & 7.2)
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [activeVoiceSessionId, setActiveVoiceSessionId] = useState(null);

  // Settings & Voice Preferences (PRD Section 10)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() => {
    try {
      return localStorage.getItem(VOICE_PREF_KEY) || "default";
    } catch {
      return "default";
    }
  });

  // Per-session drafts: { [sessionId]: { text: string, attachments: Array } }
  const [sessionDrafts, setSessionDrafts] = useState({});

  const currentDraftKey = activeSessionId || "draft-new";
  const currentDraft = sessionDrafts[currentDraftKey] || { text: "", attachments: [] };

  const handleDraftTextChange = useCallback((newText) => {
    setSessionDrafts((prev) => ({
      ...prev,
      [currentDraftKey]: {
        ...(prev[currentDraftKey] || { attachments: [] }),
        text: newText,
      },
    }));
  }, [currentDraftKey]);

  const handleDraftAttachmentsChange = useCallback((newAttachments) => {
    setSessionDrafts((prev) => {
      const currentDraft = prev[currentDraftKey] || { text: "", attachments: [] };
      const resolved =
        typeof newAttachments === "function"
          ? newAttachments(currentDraft.attachments || [])
          : newAttachments;
      return {
        ...prev,
        [currentDraftKey]: {
          ...currentDraft,
          attachments: resolved,
        },
      };
    });
  }, [currentDraftKey]);

  // Responsive check
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) setIsSidebarOpen(false);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key === "/") {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
      } else if (isMod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleNewChat();
      } else if (isMod && e.key === ",") {
        e.preventDefault();
        setIsSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Voice Mode Start & Stop Handlers
  const handleOpenVoiceMode = useCallback(() => {
    const currentId = activeSessionId || createNewChat();
    setActiveVoiceSessionId(currentId);
    setIsVoiceActive(true);
  }, [activeSessionId, createNewChat]);

  const handleCloseVoiceMode = useCallback(() => {
    setIsVoiceActive(false);
    setActiveVoiceSessionId(null);
  }, []);

  // Switching chats safely ends active voice session (PRD FR-07 & Section 7.2)
  const handleSelectSession = useCallback((id) => {
    if (isVoiceActive) {
      setIsVoiceActive(false);
      setActiveVoiceSessionId(null);
    }
    setActiveSessionId(id);
    if (isMobile) setIsSidebarOpen(false);
  }, [isVoiceActive, isMobile, setActiveSessionId]);

  const handleNewChat = useCallback(() => {
    if (isVoiceActive) {
      setIsVoiceActive(false);
      setActiveVoiceSessionId(null);
    }
    createNewChat();
    if (isMobile) setIsSidebarOpen(false);
  }, [isVoiceActive, isMobile, createNewChat]);

  // Central Send Message Handler
  const handleSendMessage = useCallback(
    async ({ text, attachments = [] }) => {
      if (isStreaming) return;

      const trimmedText = text?.trim() || "";
      const validAttachments = Array.isArray(attachments) ? attachments : [];

      if (!trimmedText && validAttachments.length === 0) return;

      let targetSessionId = activeSessionId;
      if (!targetSessionId) {
        targetSessionId = createNewChat();
      }

      // Clear draft for this session
      setSessionDrafts((prev) => {
        const next = { ...prev };
        delete next[targetSessionId];
        delete next["draft-new"];
        return next;
      });

      // 1. Process attachments
      const attachedImages = validAttachments.filter((a) => a.type === "image");
      const attachedVideos = validAttachments.filter((a) => a.type === "video");
      const attachedAudios = validAttachments.filter((a) => a.type === "audio");
      const attachedFiles = validAttachments.filter((a) => a.type === "file");

      // Upload files for RAG if needed
      for (const item of attachedFiles) {
        try {
          await uploadDocument({
            userId: currentUser?.id || "user_default",
            file: item.file,
          });
        } catch {
          // File may already have been uploaded in the background
        }
      }

      // 2. Optimistic User Message
      const userMsgId = uuidv4();
      const userMsg = {
        id: userMsgId,
        role: "user",
        content: trimmedText,
        attachments: validAttachments.map((a) => ({
          type: a.type,
          name: a.file?.name,
          previewUrl: a.previewUrl,
        })),
        ts: Date.now(),
      };
      addMessage(targetSessionId, userMsg);

      // 3. Create Placeholder Assistant Message
      const assistantMsgId = uuidv4();
      const assistantMsg = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        ts: Date.now(),
      };
      addMessage(targetSessionId, assistantMsg);

      // 4. Branch by Special Attachment Types
      try {
        if (attachedImages.length > 0) {
          const resp = await sendImageChat({
            userId: currentUser?.id || "user_default",
            sessionId: targetSessionId,
            message: trimmedText || "Analyze this image in detail.",
            imageFile: attachedImages[0].file,
          });
          updateMessage(targetSessionId, assistantMsgId, resp.response || "No response generated.");
          return;
        }

        if (attachedVideos.length > 0) {
          const resp = await sendVideoChat({
            userId: currentUser?.id || "user_default",
            sessionId: targetSessionId,
            message: trimmedText || "Analyze this video in detail.",
            videoFile: attachedVideos[0].file,
          });
          updateMessage(targetSessionId, assistantMsgId, resp.response || "No response generated.");
          return;
        }

        if (attachedAudios.length > 0) {
          const resp = await sendAudioChat({
            userId: currentUser?.id || "user_default",
            sessionId: targetSessionId,
            audioFile: attachedAudios[0].file,
          });
          updateMessage(
            targetSessionId,
            assistantMsgId,
            resp.response || "Audio transcribed and processed successfully."
          );
          return;
        }

        // 5. Standard Streaming Text / RAG Chat
        await startStream({
          userId: currentUser?.id || "user_default",
          sessionId: targetSessionId,
          message: trimmedText,
          onDelta: (deltaText) => {
            appendToMessage(targetSessionId, assistantMsgId, deltaText);
          },
          onDone: (fullText) => {
            updateMessage(targetSessionId, assistantMsgId, fullText);
          },
          onError: (err) => {
            updateMessage(
              targetSessionId,
              assistantMsgId,
              `⚠️ Error: ${err.message || "Failed to generate response. Please check your network and API keys."}`
            );
          },
        });
      } catch (err) {
        updateMessage(
          targetSessionId,
          assistantMsgId,
          `⚠️ Error: ${err.message || "Failed to send message. Please try again."}`
        );
      }
    },
    [
      isStreaming,
      activeSessionId,
      createNewChat,
      currentUser,
      addMessage,
      updateMessage,
      appendToMessage,
      startStream,
    ]
  );

  // Handle Editing Previous Message
  const handleEditMessage = useCallback(
    (msgId, newContent) => {
      if (isStreaming) return;
      truncateMessagesFrom(activeSessionId, msgId);
      handleSendMessage({ text: newContent });
    },
    [activeSessionId, isStreaming, truncateMessagesFrom, handleSendMessage]
  );

  // Handle Retrying Last Assistant Message
  const handleRetryMessage = useCallback(
    async (aiMsgId) => {
      if (isStreaming) return;
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUserMsg) return;

      truncateMessagesFrom(activeSessionId, aiMsgId);
      handleSendMessage({ text: lastUserMsg.content });
    },
    [activeSessionId, isStreaming, messages, truncateMessagesFrom, handleSendMessage]
  );

  // Handle messages added from Voice Mode (commits turns to active chat history)
  const handleVoiceAddMessage = useCallback(
    (msgData) => {
      addMessage(activeSessionId, {
        id: uuidv4(),
        role: msgData.role,
        content: msgData.content,
        voiceMsg: true,
        ts: Date.now(),
      });
    },
    [activeSessionId, addMessage]
  );

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={deleteSession}
        onRenameSession={renameSession}
        currentUser={currentUser}
        onOpenAuth={openAuthModal}
        onLogout={logout}
        isOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        isMobile={isMobile}
        onOpenSettings={() => setIsSettingsOpen(true)}
        selectedVoice={selectedVoice}
      />

      {/* Main Workspace Area */}
      <main className="app-main-workspace flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <HealthBanner isOnline={isOnline} />

        <ChatArea
          session={activeSession}
          messages={messages}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onSendMessage={handleSendMessage}
          isStreaming={isStreaming}
          onStopStreaming={stopStream}
          onOpenVoiceMode={handleOpenVoiceMode}
          isVoiceActive={isVoiceActive && activeVoiceSessionId === activeSessionId}
          onCloseVoiceMode={handleCloseVoiceMode}
          selectedVoice={selectedVoice}
          onAddMessage={handleVoiceAddMessage}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onEditMessage={handleEditMessage}
          onRetryMessage={handleRetryMessage}
          userId={currentUser?.id}
          draftText={currentDraft.text}
          onDraftTextChange={handleDraftTextChange}
          draftAttachments={currentDraft.attachments}
          onDraftAttachmentsChange={handleDraftAttachmentsChange}
        />
      </main>

      {/* Settings & Voice Preferences Modal (PRD Section 10) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        selectedVoice={selectedVoice}
        onVoiceChange={setSelectedVoice}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={closeAuthModal}
        onLogin={login}
        onRegister={register}
      />

      {/* Non-blocking Toast Container */}
      <ToastContainer />
    </div>
  );
}
