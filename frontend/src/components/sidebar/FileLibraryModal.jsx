import { useState, useEffect } from "react";
import { X, Database, FileText, ChevronRight, ChevronDown, Sparkles, RefreshCw } from "lucide-react";
import { fetchUserFiles } from "../../api/files";
import MermaidDiagram from "../common/MermaidDiagram";

export default function FileLibraryModal({ isOpen, onClose, userId }) {
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedFileId, setExpandedFileId] = useState(null);

  const loadFiles = async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const data = await fetchUserFiles(userId);
      setFiles(data);
    } catch (err) {
      console.error("Failed to load user files:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen, userId]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="file-library-modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="file-library-header">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-blue-400" />
            <h2 className="text-base font-semibold text-white">Knowledge Base & Files</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadFiles} className="file-library-refresh-btn" title="Refresh list">
              <RefreshCw size={14} className={isLoading ? "animate-spin text-blue-400" : ""} />
            </button>
            <button onClick={onClose} className="modal-close-btn" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <p className="text-xs text-zinc-400 px-6 py-2 border-b border-zinc-800">
          Documents indexed into Cortex RAG memory are available to inform your chat and voice answers.
        </p>

        <div className="file-library-body">
          {isLoading && files.length === 0 ? (
            <div className="file-library-empty">Loading indexed knowledge base...</div>
          ) : files.length === 0 ? (
            <div className="file-library-empty">
              <FileText size={32} className="text-zinc-600 mb-2" />
              <p className="text-sm text-zinc-400">No documents uploaded yet.</p>
              <p className="text-xs text-zinc-500 mt-1">Upload PDFs, code, or text files from the chat composer.</p>
            </div>
          ) : (
            <div className="file-list-container">
              {files.map((file, idx) => {
                const isExpanded = expandedFileId === (file.id || idx);
                return (
                  <div key={file.id || idx} className="file-record-card">
                    <div
                      className="file-record-header"
                      onClick={() => setExpandedFileId(isExpanded ? null : (file.id || idx))}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={15} className="text-blue-400 shrink-0" />
                        <span className="file-record-name truncate font-medium text-sm text-zinc-200">
                          {file.filename}
                        </span>
                        <span className="file-record-badge">{file.filetype || "document"}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {file.mermaid_diagram && (
                          <span className="file-diagram-chip">
                            <Sparkles size={11} /> Diagram
                          </span>
                        )}
                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="file-record-details">
                        {file.summary && (
                          <div className="file-summary-section">
                            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                              AI Summary
                            </h4>
                            <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-900/60 p-3 rounded-md border border-zinc-800/80">
                              {file.summary}
                            </p>
                          </div>
                        )}

                        {file.mermaid_diagram && (
                          <div className="file-diagram-section mt-3">
                            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                              Extracted Architecture Diagram
                            </h4>
                            <MermaidDiagram chart={file.mermaid_diagram} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
