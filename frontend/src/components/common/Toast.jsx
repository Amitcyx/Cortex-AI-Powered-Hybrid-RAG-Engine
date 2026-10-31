import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

let toastEmitter = null;

export function showToast(message, type = "info", duration = 3500) {
  toastEmitter?.(message, type, duration);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    toastEmitter = (message, type = "info", duration = 3500) => {
      const id = Math.random().toString(36).substr(2, 9);
      const newToast = { id, message, type };
      setToasts((prev) => [...prev, newToast]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    };

    return () => {
      toastEmitter = null;
    };
  }, []);

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`}>
          <div className="toast-icon">
            {toast.type === "success" && <CheckCircle2 size={16} className="text-emerald-400" />}
            {toast.type === "error" && <AlertCircle size={16} className="text-rose-400" />}
            {toast.type === "info" && <Info size={16} className="text-blue-400" />}
          </div>
          <span className="toast-message">{toast.message}</span>
          <button onClick={() => removeToast(toast.id)} className="toast-close-btn" aria-label="Close">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
