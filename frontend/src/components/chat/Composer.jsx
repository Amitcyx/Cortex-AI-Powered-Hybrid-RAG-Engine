import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus,
  Send,
  Square,
  Mic,
  Image,
  Film,
  FileText,
  Volume2,
  Radio,
  Loader2,
} from "lucide-react";
import AttachmentTray from "./AttachmentTray";
import AudioRecorderPreview from "./AudioRecorderPreview";
import { useAudioRecorder } from "../../hooks/useAudioRecorder";
import { showToast } from "../common/Toast";
import { transcribeAudio } from "../../api/chat";
import { uploadDocumentStream } from "../../api/files";

const ATTACH_OPTIONS = [
  { id: "all", label: "Upload Any File / Media", icon: <Plus size={15} />, accept: "*/*" },
  { id: "file", label: "Upload Documents (PDF, Code, Text)", icon: <FileText size={15} />, accept: ".pdf,.txt,.py,.js,.ts,.md,.json,.yaml,.yml,.html,.css" },
  { id: "image", label: "Upload Images", icon: <Image size={15} />, accept: "image/*" },
  { id: "audio", label: "Upload Audio Files", icon: <Volume2 size={15} />, accept: "audio/*" },
  { id: "video", label: "Upload Videos", icon: <Film size={15} />, accept: "video/*" },
];

export default function Composer({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  onOpenVoiceMode,
  disabled,
  userId,
  draftText = "",
  onDraftTextChange,
  draftAttachments = [],
  onDraftAttachmentsChange,
}) {
  // If controlled draft props are supplied, use them; otherwise fallback to internal state
  const [internalText, setInternalText] = useState("");
  const [internalAttachments, setInternalAttachments] = useState([]);

  const text = onDraftTextChange ? draftText : internalText;
  const setText = onDraftTextChange ? onDraftTextChange : setInternalText;

  const attachments = onDraftAttachmentsChange ? draftAttachments : internalAttachments;
  const setAttachments = onDraftAttachmentsChange ? onDraftAttachmentsChange : setInternalAttachments;

  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pendingAccept, setPendingAccept] = useState(null);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachMenuRef = useRef(null);

  const {
    isRecording,
    audioBlob,
    audioUrl,
    recordingDuration,
    startRecording,
    stopRecording,
    clearAudio,
  } = useAudioRecorder();

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [text]);

  // Click outside to close attachment menu
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOpenPicker = (accept, type) => {
    setShowAttachMenu(false);
    setPendingAccept(type);
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  /**
   * Starts indexing a document immediately upon attachment in the input bar,
   * streaming progress percentages (e.g. for 2000-3000 page PDFs).
   */
  const startIndexingAttachment = useCallback((item) => {
    uploadDocumentStream({
      userId: userId || "user_default",
      file: item.file,
      signal: item.abortController?.signal,
      onProgress: (data) => {
        setAttachments((prev) =>
          prev.map((att) =>
            att.id === item.id
              ? {
                  ...att,
                  progress: Math.min(99, Math.max(0, data.progress ?? att.progress)),
                  statusText: data.message || `Indexing... ${data.progress}%`,
                  status: "indexing",
                }
              : att
          )
        );
      },
      onDone: (data) => {
        setAttachments((prev) =>
          prev.map((att) =>
            att.id === item.id
              ? {
                  ...att,
                  progress: 100,
                  statusText: "Indexed & Ready",
                  status: "ready",
                  indexedResult: data.result,
                }
              : att
          )
        );
        showToast(`"${item.file.name}" indexed into database!`, "success");
      },
      onError: (errMsg) => {
        setAttachments((prev) =>
          prev.map((att) =>
            att.id === item.id
              ? {
                  ...att,
                  status: "error",
                  statusText: errMsg || "Indexing failed",
                }
              : att
          )
        );
        showToast(`Failed to index "${item.file.name}": ${errMsg}`, "error");
      },
    });
  }, [userId, setAttachments]);

  const handleFilesSelected = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (!selectedFiles.length) return;

    const newAttachments = [];
    const maxSize = 250 * 1024 * 1024; // 250MB limit to handle massive documents (2000-3000+ pages)

    for (const file of selectedFiles) {
      if (file.size > maxSize) {
        showToast(`"${file.name}" exceeds 250MB limit.`, "error");
        continue;
      }

      let type = pendingAccept && pendingAccept !== "all" ? pendingAccept : "file";
      if (file.type.startsWith("image/")) type = "image";
      else if (file.type.startsWith("video/")) type = "video";
      else if (file.type.startsWith("audio/")) type = "audio";

      const isDoc = type === "file";
      const previewUrl =
        type === "image" || type === "audio" || type === "video"
          ? URL.createObjectURL(file)
          : null;

      const abortController = isDoc ? new AbortController() : null;

      const attachmentItem = {
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        type,
        previewUrl,
        status: isDoc ? "indexing" : "ready",
        progress: isDoc ? 0 : 100,
        statusText: isDoc ? "Reading..." : "Ready",
        abortController,
      };

      newAttachments.push(attachmentItem);

      // Immediately start streaming indexing into the vector database
      if (isDoc) {
        startIndexingAttachment(attachmentItem);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments([...attachments, ...newAttachments]);
    }
  };

  const handleRemoveAttachment = (indexToRemove) => {
    const item = attachments[indexToRemove];
    if (item?.abortController) {
      item.abortController.abort();
    }
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
    const updated = attachments.filter((_, idx) => idx !== indexToRemove);
    setAttachments(updated);
  };

  const handleRetryAttachment = (id) => {
    const item = attachments.find((a) => a.id === id);
    if (!item) return;

    const abortController = new AbortController();
    setAttachments((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "indexing",
              progress: 0,
              statusText: "Retrying...",
              abortController,
            }
          : a
      )
    );
    startIndexingAttachment({ ...item, abortController });
  };

  // ── Verification: Gating Send while indexing is active ────────────────────
  const hasPendingIndex = attachments.some(
    (a) => a.type === "file" && a.status === "indexing"
  );
  const hasErrorIndex = attachments.some(
    (a) => a.type === "file" && a.status === "error"
  );

  const isSendDisabled =
    isStreaming ||
    disabled ||
    hasPendingIndex ||
    hasErrorIndex ||
    (!text.trim() && attachments.length === 0);

  const handleSend = () => {
    if (isStreaming || disabled) return;

    // Enforce that user cannot send until all documents are indexed into vector DB
    if (hasPendingIndex) {
      showToast(
        "Please wait until all documents are fully indexed into the vector database.",
        "warning"
      );
      return;
    }
    if (hasErrorIndex) {
      showToast(
        "Document indexing failed. Please retry or remove the failed document before sending.",
        "error"
      );
      return;
    }

    if (!text.trim() && attachments.length === 0) return;

    onSendMessage({
      text: text.trim(),
      attachments: [...attachments],
    });

    setText("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleTranscribeRecordedAudio = async () => {
    if (!audioBlob) return;
    setIsTranscribing(true);
    try {
      showToast("Transcribing audio...", "info");
      const transcript = await transcribeAudio({
        audioFile: audioBlob,
        filename: "recording.webm",
      });
      if (transcript) {
        setText(text ? `${text} ${transcript}` : transcript);
        showToast("Audio transcribed into text!", "success");
        clearAudio();
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      } else {
        showToast("No speech detected in audio", "error");
      }
    } catch (err) {
      showToast(err.message || "Transcription failed", "error");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSendRecordedAudio = () => {
    if (!audioBlob) return;
    if (hasPendingIndex) {
      showToast("Please wait until all documents are fully indexed.", "warning");
      return;
    }

    const voiceAttachment = {
      id: `audio-rec-${Date.now()}`,
      file: audioBlob,
      type: "audio",
      previewUrl: audioUrl,
      status: "ready",
      progress: 100,
    };
    onSendMessage({
      text: text.trim(),
      attachments: [...attachments, voiceAttachment],
    });
    clearAudio();
    setText("");
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="composer-container">
      {/* Hidden File Input supporting multiple file selections */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFilesSelected}
        aria-hidden="true"
      />

      {/* Attachment Preview Tray with Live Percentage Counter */}
      <AttachmentTray
        attachments={attachments}
        onRemove={handleRemoveAttachment}
        onRetry={handleRetryAttachment}
      />

      {/* Audio Recording Live Preview */}
      <AudioRecorderPreview
        isRecording={isRecording}
        audioUrl={audioUrl}
        duration={recordingDuration}
        onStop={stopRecording}
        onCancel={clearAudio}
        onSend={handleSendRecordedAudio}
        onTranscribe={handleTranscribeRecordedAudio}
        isTranscribing={isTranscribing}
      />

      {/* Input Row */}
      {!isRecording && !audioUrl && (
        <div className="composer-box">
          {/* Attachment Menu Button */}
          <div className="attach-btn-wrapper" ref={attachMenuRef}>
            <button
              type="button"
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className={`composer-icon-btn ${showAttachMenu ? "active" : ""}`}
              title="Attach documents, images, audio, or video"
              disabled={isStreaming || disabled}
              aria-label="Attach media"
            >
              <Plus size={18} />
            </button>

            {showAttachMenu && (
              <div className="composer-attach-dropdown" role="menu">
                <div className="composer-dropdown-header">Add Attachments</div>
                {ATTACH_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleOpenPicker(opt.accept, opt.id)}
                    className="composer-dropdown-item"
                    role="menuitem"
                  >
                    <span className="dropdown-item-icon">{opt.icon}</span>
                    <span className="dropdown-item-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Multiline Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Cortex is streaming a response..."
                : hasPendingIndex
                ? "Indexing document into database... please wait..."
                : "Ask Cortex anything, attach files, or speak..."
            }
            disabled={isStreaming || disabled}
            className="composer-textarea"
            aria-label="Type your message"
          />

          {/* Action Buttons: Voice Mode, Mic Record, Send / Stop */}
          <div className="composer-actions">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                className="composer-stop-btn"
                title="Stop generating"
                aria-label="Stop generation"
              >
                <Square size={14} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <>
                {/* Voice Mode Fullscreen Toggle */}
                <button
                  type="button"
                  onClick={onOpenVoiceMode}
                  className="composer-icon-btn voice-mode-btn"
                  title="Open Voice Assistant Mode"
                  aria-label="Voice mode"
                >
                  <Radio size={17} className="text-purple-400" />
                </button>

                {/* Inline Microphone Recorder */}
                <button
                  type="button"
                  onClick={startRecording}
                  className="composer-icon-btn mic-btn"
                  title="Record voice note"
                  aria-label="Record voice note"
                >
                  <Mic size={17} />
                </button>

                {/* Send Button with Gating & Pending Spinner */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isSendDisabled}
                  className={`composer-send-btn ${!isSendDisabled ? "active" : "disabled"} ${
                    hasPendingIndex ? "indexing-active" : ""
                  }`}
                  title={
                    hasPendingIndex
                      ? "Indexing documents into database... Please wait"
                      : hasErrorIndex
                      ? "Document indexing failed. Please retry or remove."
                      : "Send message (Enter)"
                  }
                  aria-label="Send message"
                >
                  {hasPendingIndex ? (
                    <Loader2 size={15} className="animate-spin text-blue-400" />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
