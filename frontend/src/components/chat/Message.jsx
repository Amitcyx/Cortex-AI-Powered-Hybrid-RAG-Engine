import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  Edit2,
  RotateCcw,
  Sparkles,
  User,
  Film,
  FileText,
  Volume2,
  Image as ImageIcon,
} from "lucide-react";
import AudioPlayer from "../common/AudioPlayer";
import MermaidDiagram from "../common/MermaidDiagram";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

// Custom code block renderer with copy button & syntax highlighting
export default function Message({
  message,
  onEditMessage,
  onRetryMessage,
  isLastTurn,
  isStreaming,
}) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isUser = message.role === "user";
  const isError = message.isError || message.content?.startsWith("[error]");

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      onEditMessage?.(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const renderers = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match ? match[1] : "";
      const codeString = String(children).replace(/\n$/, "");

      // If Mermaid chart code block and not streaming
      if (lang === "mermaid" && !message.isStreaming) {
        return <MermaidDiagram chart={codeString} />;
      }

      if (inline) {
        return (
          <code className="inline-code" {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="code-block-wrapper">
          <div className="code-block-header">
            <span className="code-lang-tag">{lang || "code"}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(codeString);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="code-copy-btn"
              title="Copy code"
            >
              <Copy size={12} />
              <span>Copy</span>
            </button>
          </div>
          <SyntaxHighlighter
            language={lang || "text"}
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              padding: "14px",
              background: "#0d0d12",
              fontSize: "13px",
              fontFamily: "'JetBrains Mono', monospace",
              borderRadius: "0 0 8px 8px",
            }}
            wrapLongLines={true}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      );
    },
  };

  // Compile all attachments (supporting both array message.attachments and legacy mediaUrl)
  const allAttachments = [];
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    allAttachments.push(...message.attachments);
  } else if (message.mediaType) {
    allAttachments.push({
      type: message.mediaType,
      name: message.mediaName || "Attachment",
      url: message.mediaUrl,
    });
  }

  return (
    <div className={`message-row ${isUser ? "user" : "assistant"} ${isError ? "error" : ""}`}>
      {/* Avatar */}
      <div className={`message-avatar ${isUser ? "user" : "assistant"}`}>
        {isUser ? <User size={15} /> : <Sparkles size={15} className="text-blue-400" />}
      </div>

      {/* Content Container */}
      <div className="message-content-wrapper">
        <div className="message-header">
          <span className="message-author">{isUser ? "You" : "Cortex AI"}</span>
          <span className="message-time">
            {new Date(message.ts || Date.now()).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {message.voiceMsg && (
            <span className="message-voice-badge">
              <Volume2 size={11} /> Voice
            </span>
          )}
        </div>

        {/* Multi-Attachments Grid / Cards */}
        {allAttachments.length > 0 && (
          <div className="message-attachments-container">
            {allAttachments.map((att, idx) => (
              <div key={idx} className="message-attachment-item">
                {att.type === "image" && att.url && (
                  <div className="message-media-card image">
                    <img src={att.url} alt={att.name || "Attached Image"} />
                  </div>
                )}

                {att.type === "video" && att.url && (
                  <div className="message-media-card video">
                    <video src={att.url} controls />
                  </div>
                )}

                {att.type === "audio" && att.url && (
                  <div className="message-media-card audio">
                    <AudioPlayer src={att.url} label={att.name || "Audio Note"} />
                  </div>
                )}

                {att.type === "file" && (
                  <div className="message-file-badge">
                    <FileText size={14} className="text-blue-400" />
                    <span>{att.name || "Uploaded Document (RAG)"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Text Body or Edit Mode */}
        {isEditing ? (
          <div className="message-edit-container">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="message-edit-textarea"
              rows={3}
            />
            <div className="message-edit-actions">
              <button onClick={() => setIsEditing(false)} className="edit-btn cancel">
                Cancel
              </button>
              <button onClick={handleSaveEdit} className="edit-btn save">
                Save & Branch
              </button>
            </div>
          </div>
        ) : (
          <div className="message-body">
            {isUser ? (
              <p className="message-user-text">{message.content}</p>
            ) : (
              <div className="message-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={renderers}>
                  {message.content || (message.isStreaming ? "Thinking..." : "")}
                </ReactMarkdown>
                {message.isStreaming && <span className="streaming-cursor" />}
              </div>
            )}
          </div>
        )}

        {/* Message Action Toolbar */}
        {!message.isStreaming && !isEditing && (
          <div className="message-toolbar">
            <button onClick={handleCopy} className="msg-action-btn" title="Copy text">
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>

            {isUser && onEditMessage && (
              <button
                onClick={() => setIsEditing(true)}
                className="msg-action-btn"
                title="Edit message & regenerate from this point"
              >
                <Edit2 size={12} />
              </button>
            )}

            {!isUser && isLastTurn && onRetryMessage && (
              <button
                onClick={() => onRetryMessage(message.id)}
                className="msg-action-btn"
                title="Retry response"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
