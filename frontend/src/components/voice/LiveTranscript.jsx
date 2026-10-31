import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function LiveTranscript({
  history = [],
  userTranscript = "",
  assistantText = "",
  phase,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, userTranscript, assistantText]);

  const recentHistory = history.slice(-4);

  return (
    <div className="voice-transcript-area">
      <div className="voice-transcript-scroll">
        {recentHistory.length === 0 && !userTranscript && !assistantText && (
          <div className="voice-transcript-empty">
            <p>Start speaking or tap the orb to begin your conversation.</p>
          </div>
        )}

        {/* Previous Turns */}
        {recentHistory.map((item, idx) => (
          <div
            key={idx}
            className={`voice-transcript-turn ${item.role === "user" ? "user" : "assistant"}`}
          >
            <span className="voice-turn-author">{item.role === "user" ? "You" : "Cortex"}</span>
            <div className="voice-turn-body">
              {item.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
              ) : (
                <p>{item.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Live In-Progress User Turn */}
        {userTranscript && (
          <div className="voice-transcript-turn user live">
            <span className="voice-turn-author">You</span>
            <div className="voice-turn-body">
              <p>{userTranscript}</p>
            </div>
          </div>
        )}

        {/* Live In-Progress Assistant Turn */}
        {assistantText && (
          <div className="voice-transcript-turn assistant live">
            <span className="voice-turn-author">Cortex</span>
            <div className="voice-turn-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistantText}</ReactMarkdown>
              {phase === "speaking" && <span className="streaming-cursor" />}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
