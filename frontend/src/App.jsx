import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import Sidebar from "./components/sidebar/Sidebar";
import ChatArea from "./components/chat/ChatArea";
import VoiceOverlay from "./components/voice/VoiceOverlay";
import AuthModal from "./components/auth/AuthModal";
import HealthBanner from "./components/common/HealthBanner";
import ToastContainer, { showToast } from "./components/common/Toast";
import { useAuth } from "./hooks/useAuth";
import { useConversations } from "./hooks/useConversations";
import { useChatStream } from "./hooks/useChatStream";
import { useHealth } from "./hooks/useHealth";
import { sendImageChat, sendVideoChat, sendAudioChat } from "./api/chat";
import { uploadDocument } from "./api/files";

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
  const [isVoiceOverlayOpen, setIsVoiceOverlayOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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
        createNewChat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createNewChat]);

  // Handle Text and Multi-Attachment Message Sending
  const handleSendMessage = useCallback(
    async ({ text, attachments = [], attachment }) => {
      if (isStreaming) return;
      const sessionId = activeSessionId;

      // Normalise attachments into an array
      const rawList = Array.isArray(attachments) && attachments.length > 0
        ? attachments
        : attachment
        ? [attachment]
        : [];

      let userText = text ? text.trim() : "";

      // Construct message-level attachments array
      const msgAttachments = rawList.map((att) => ({
        type: att.type,
        name: att.file?.name || (att.type === "audio" ? "recording.wav" : "attachment"),
        url: att.previewUrl || null,
      }));

      // Default prompt text if user provided none
      if (!userText && rawList.length > 0) {
        const names = rawList.map((a) => a.file?.name).filter(Boolean).join(", ");
        const firstType = rawList[0].type;
        if (rawList.length === 1) {
          userText =
            firstType === "image"
              ? "What can you tell me about this image?"
              : firstType === "audio"
              ? "Please respond to my voice recording."
              : firstType === "video"
              ? "What is happening in this video?"
              : `I've uploaded a file: ${rawList[0].file?.name || "document"}`;
        } else {
          userText = `I've uploaded ${rawList.length} files (${names || "documents & media"}). Please analyze them.`;
        }
      }

      // Add user turn
      const userMsg = {
        id: uuidv4(),
        role: "user",
        content: userText,
        ts: Date.now(),
        attachments: msgAttachments,
        // Legacy fallback fields for backward compatibility
        ...(rawList.length === 1 ? {
          mediaType: rawList[0].type,
          mediaName: rawList[0].file?.name || "attachment",
          mediaUrl: rawList[0].previewUrl,
        } : {}),
      };
      addMessage(sessionId, userMsg);

      // Clear draft for this session
      setSessionDrafts((prev) => ({
        ...prev,
        [currentDraftKey]: { text: "", attachments: [] },
      }));

      // Create placeholder AI message
      const aiMsgId = uuidv4();
      addMessage(sessionId, {
        id: aiMsgId,
        role: "assistant",
        content: "",
        isStreaming: true,
        ts: Date.now(),
      });

      try {
        const docFiles = rawList.filter((a) => a.type === "file");
        const imageFiles = rawList.filter((a) => a.type === "image");
        const videoFiles = rawList.filter((a) => a.type === "video");
        const audioFiles = rawList.filter((a) => a.type === "audio");

        // 1. Ensure any document files are indexed (composer indexes them inline)
        const unindexedDocs = docFiles.filter((a) => a.status !== "ready");
        if (unindexedDocs.length > 0) {
          for (let i = 0; i < unindexedDocs.length; i++) {
            const doc = unindexedDocs[i];
            await uploadDocument({ userId: currentUser.id, file: doc.file });
          }
        }

        // 2. Handle Multimodal Chat execution
        // Case A: Single Image without videos/audios
        if (imageFiles.length === 1 && videoFiles.length === 0 && audioFiles.length === 0 && docFiles.length === 0) {
          const res = await sendImageChat({
            userId: currentUser.id,
            sessionId,
            message: userText || "Describe this image.",
            imageFile: imageFiles[0].file,
          });
          updateMessage(sessionId, aiMsgId, { content: res.reply, isStreaming: false });
        }
        // Case B: Single Video
        else if (videoFiles.length === 1 && imageFiles.length === 0 && audioFiles.length === 0 && docFiles.length === 0) {
          const res = await sendVideoChat({
            userId: currentUser.id,
            sessionId,
            message: userText || "What is happening in this video?",
            videoFile: videoFiles[0].file,
          });
          updateMessage(sessionId, aiMsgId, { content: res.reply, isStreaming: false });
        }
        // Case C: Single Audio
        else if (audioFiles.length === 1 && imageFiles.length === 0 && videoFiles.length === 0 && docFiles.length === 0) {
          const audioItem = audioFiles[0];
          let audioExt = "webm";
          const mime = audioItem.file?.type || "";
          if (mime.includes("wav")) audioExt = "wav";
          else if (mime.includes("mp4")) audioExt = "mp4";
          else if (mime.includes("ogg")) audioExt = "ogg";
          else if (mime.includes("mpeg") || mime.includes("mp3")) audioExt = "mp3";

          const fileName = audioItem.file?.name || `recording.${audioExt}`;
          const res = await sendAudioChat({
            userId: currentUser.id,
            sessionId,
            message: userText || "",
            audioFile: audioItem.file,
            filename: fileName,
          });
          if (res.transcript) {
            updateMessage(sessionId, userMsg.id, {
              content: `🎙️ ${res.transcript}${userText ? `\n\n${userText}` : ""}`,
            });
          }
          updateMessage(sessionId, aiMsgId, { content: res.reply, isStreaming: false });
        }
        // Case D: Multiple images/media or documents uploaded -> use RAG-enabled Streaming Chat
        else {
          let enrichedPrompt = userText;
          if (rawList.length > 0) {
            const attachedSummary = rawList.map((a) => `- [${a.type}] ${a.file?.name || "file"}`).join("\n");
            enrichedPrompt = `${userText}\n\n[User attached the following ${rawList.length} items in this turn:\n${attachedSummary}]`;
          }

          await startStream({
            userId: currentUser.id,
            sessionId,
            message: enrichedPrompt,
            onToken: (token) => appendToMessage(sessionId, aiMsgId, token),
            onDone: (fullText) => {
              updateMessage(sessionId, aiMsgId, { content: fullText, isStreaming: false });
            },
            onError: (err) => {
              updateMessage(sessionId, aiMsgId, {
                content: `[error] Streaming failed: ${err}`,
                isStreaming: false,
                isError: true,
              });
              showToast(err, "error");
            },
          });
        }
      } catch (err) {
        updateMessage(sessionId, aiMsgId, {
          content: `[error] ${err.message || "An unexpected error occurred."}`,
          isStreaming: false,
          isError: true,
        });
        showToast(err.message || "Request failed", "error");
      }
    },
    [
      isStreaming,
      activeSessionId,
      currentUser.id,
      currentDraftKey,
      addMessage,
      updateMessage,
      appendToMessage,
      startStream,
    ]
  );

  // Handle Editing User Message & Branching
  const handleEditMessage = useCallback(
    async (messageId, newContent) => {
      if (isStreaming) return;
      truncateMessagesFrom(activeSessionId, messageId);

      // Send the edited turn
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

  // Handle messages added from Voice Overlay
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
        onSelectSession={(id) => {
          setActiveSessionId(id);
          if (isMobile) setIsSidebarOpen(false);
        }}
        onNewChat={() => {
          createNewChat();
          if (isMobile) setIsSidebarOpen(false);
        }}
        onDeleteSession={deleteSession}
        onRenameSession={renameSession}
        currentUser={currentUser}
        onOpenAuth={openAuthModal}
        onLogout={logout}
        isOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        isMobile={isMobile}
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
          onOpenVoiceMode={() => setIsVoiceOverlayOpen(true)}
          onEditMessage={handleEditMessage}
          onRetryMessage={handleRetryMessage}
          userId={currentUser?.id}
          draftText={currentDraft.text}
          onDraftTextChange={handleDraftTextChange}
          draftAttachments={currentDraft.attachments}
          onDraftAttachmentsChange={handleDraftAttachmentsChange}
        />
      </main>

      {/* Fullscreen ChatGPT-Style Voice Mode Overlay */}
      {isVoiceOverlayOpen && (
        <VoiceOverlay
          isOpen={isVoiceOverlayOpen}
          onClose={() => setIsVoiceOverlayOpen(false)}
          userId={currentUser?.id}
          sessionId={activeSessionId}
          onAddMessage={handleVoiceAddMessage}
        />
      )}

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
