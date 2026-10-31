import { useState } from "react";
import { Brain, Check, RefreshCw, X, Sparkles } from "lucide-react";
import { consolidateMemory } from "../../api/chat";
import { showToast } from "../common/Toast";

export default function MemoryConsolidateModal({ isOpen, onClose, userId, sessionId }) {
  const [isLoading, setIsLoading] = useState(false);
  const [facts, setFacts] = useState(null);

  if (!isOpen) return null;

  const handleConsolidate = async () => {
    setIsLoading(true);
    try {
      const res = await consolidateMemory({ userId, sessionId });
      setFacts(res?.facts_extracted || []);
      showToast("Memory successfully consolidated!", "success");
    } catch (err) {
      showToast(err.message || "No facts could be extracted from this conversation.", "info");
      setFacts([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="memory-modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="memory-modal-header">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Update Long-term Memory</h3>
          </div>
          <button onClick={onClose} className="modal-close-btn" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <p className="text-xs text-zinc-400 mt-2">
          Cortex will review the dialogue in this chat, extract persistent facts about your
          preferences, projects, and goals, and store them into vector memory.
        </p>

        {facts !== null ? (
          <div className="memory-facts-box">
            <div className="flex items-center gap-1 text-xs font-semibold text-emerald-400 mb-2">
              <Check size={13} />
              <span>Extracted Facts ({facts.length})</span>
            </div>
            {facts.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">
                No new long-term facts discovered in this conversation.
              </p>
            ) : (
              <ul className="memory-facts-list">
                {facts.map((fact, i) => (
                  <li key={i} className="memory-fact-item">
                    <Sparkles size={11} className="text-purple-400 shrink-0 mt-0.5" />
                    <span>{typeof fact === "string" ? fact : JSON.stringify(fact)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="memory-action-section mt-4">
            <button
              onClick={handleConsolidate}
              disabled={isLoading}
              className="memory-consolidate-btn"
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
              <span>{isLoading ? "Consolidating memory..." : "Extract & Save Facts"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
