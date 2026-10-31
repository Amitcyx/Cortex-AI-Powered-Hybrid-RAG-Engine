import { Mic, Square, Trash2, Send, FileText, Loader2 } from "lucide-react";
import AudioPlayer from "../common/AudioPlayer";

export default function AudioRecorderPreview({
  isRecording,
  audioUrl,
  duration,
  onStop,
  onCancel,
  onSend,
  onTranscribe,
  isTranscribing,
}) {
  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!isRecording && !audioUrl) return null;

  return (
    <div className="audio-record-preview-bar">
      {isRecording ? (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="audio-recording-indicator">
              <span className="audio-recording-dot" />
              <Mic size={15} className="text-red-400" />
            </div>
            <span className="text-xs font-mono font-semibold text-red-400">
              Recording: {formatDuration(duration)}
            </span>
          </div>

          <button onClick={onStop} className="audio-stop-rec-btn" title="Stop recording">
            <Square size={13} fill="currentColor" />
            <span>Stop</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex-1 min-w-0">
            <AudioPlayer src={audioUrl} label="Voice Message Preview" />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onCancel} className="audio-cancel-rec-btn" title="Discard recording">
              <Trash2 size={14} />
            </button>

            {onTranscribe && (
              <button
                onClick={onTranscribe}
                disabled={isTranscribing}
                className="audio-transcribe-btn"
                title="Transcribe speech to editable text"
              >
                {isTranscribing ? (
                  <Loader2 size={13} className="animate-spin text-blue-400" />
                ) : (
                  <FileText size={13} className="text-blue-400" />
                )}
                <span>{isTranscribing ? "Transcribing..." : "Transcribe"}</span>
              </button>
            )}

            <button onClick={onSend} className="audio-send-rec-btn" title="Send voice message">
              <Send size={14} />
              <span>Send</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
