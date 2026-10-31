import {
  FileText,
  Image,
  Film,
  Volume2,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCw,
} from "lucide-react";

export default function AttachmentTray({ attachments = [], onRemove, onRetry }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="attachment-tray">
      <div className="attachment-cards-container">
        {attachments.map((item, idx) => {
          const isDoc = item.type === "file";
          const isIndexing = isDoc && item.status === "indexing";
          const isReady = isDoc && item.status === "ready";
          const isError = isDoc && item.status === "error";

          return (
            <div
              key={item.id || idx}
              className={`attachment-card ${isIndexing ? "indexing" : ""} ${isReady ? "ready" : ""} ${isError ? "error" : ""}`}
            >
              {/* Left Icon Badge */}
              {item.type === "image" && item.previewUrl ? (
                <div className="attachment-preview-img-wrapper">
                  <img src={item.previewUrl} alt={item.file?.name || "Preview"} className="attachment-preview-img" />
                </div>
              ) : item.type === "image" ? (
                <div className="attachment-icon-badge image">
                  <Image size={16} />
                </div>
              ) : null}

              {item.type === "video" && (
                <div className="attachment-icon-badge video">
                  <Film size={16} />
                </div>
              )}

              {item.type === "audio" && (
                <div className="attachment-icon-badge audio">
                  <Volume2 size={16} />
                </div>
              )}

              {isDoc && (
                <div className={`attachment-icon-badge doc ${isIndexing ? "pulse" : ""}`}>
                  {isIndexing ? (
                    <Loader2 size={15} className="animate-spin text-blue-400" />
                  ) : isReady ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : isError ? (
                    <AlertCircle size={15} className="text-rose-400" />
                  ) : (
                    <FileText size={15} />
                  )}
                </div>
              )}

              {/* Meta & Progress Details */}
              <div className="attachment-meta">
                <span className="attachment-name truncate" title={item.file?.name}>
                  {item.file?.name || "Uploaded file"}
                </span>

                {isDoc ? (
                  <div className="attachment-status-line">
                    {isIndexing ? (
                      <div className="attachment-indexing-row">
                        <span className="attachment-status-text truncate" title={item.statusText || "Indexing..."}>
                          {item.statusText || "Indexing..."}
                        </span>
                        <span className="attachment-percent-counter">
                          {item.progress ?? 0}%
                        </span>
                      </div>
                    ) : isReady ? (
                      <span className="attachment-ready-badge">
                        <CheckCircle2 size={10} className="inline mr-1" />
                        Indexed & In DB
                      </span>
                    ) : isError ? (
                      <span className="attachment-error-badge" title={item.statusText || "Failed"}>
                        <AlertCircle size={10} className="inline mr-1" />
                        Failed
                      </span>
                    ) : (
                      <span className="attachment-type">RAG Document</span>
                    )}

                    {/* Visual Progress Bar while indexing */}
                    {isIndexing && (
                      <div className="attachment-progress-track">
                        <div
                          className="attachment-progress-bar-fill"
                          style={{ width: `${Math.max(5, Math.min(100, item.progress ?? 0))}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="attachment-type">{item.type.toUpperCase()}</span>
                )}
              </div>

              {/* Actions: Retry (if error) and Remove */}
              <div className="attachment-card-actions">
                {isError && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(item.id)}
                    className="attachment-action-btn retry"
                    title="Retry indexing"
                    aria-label="Retry indexing"
                  >
                    <RotateCw size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="attachment-remove-btn"
                  title="Remove attachment"
                  aria-label={`Remove ${item.file?.name || "attachment"}`}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
