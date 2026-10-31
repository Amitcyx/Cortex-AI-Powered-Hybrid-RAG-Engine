import { AlertTriangle, RefreshCw } from "lucide-react";

export default function HealthBanner({ isOnline }) {
  if (isOnline) return null;

  return (
    <div className="health-banner" role="alert">
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-amber-400 shrink-0" />
        <span>Backend service unreachable. Please ensure the Cortex FastAPI server is running.</span>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="health-retry-btn"
        title="Refresh connection"
      >
        <RefreshCw size={12} />
        <span>Retry</span>
      </button>
    </div>
  );
}
