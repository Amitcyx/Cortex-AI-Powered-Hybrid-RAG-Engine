import { useState } from "react";
import { X, Sparkles, Lock, Mail, User, ArrowRight } from "lucide-react";
import { showToast } from "../common/Toast";

export default function AuthModal({ isOpen, onClose, onLogin, onRegister }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showToast("Please provide both email and password", "error");
      return;
    }

    setIsLoading(true);
    try {
      if (isRegister) {
        await onRegister(name, email, password);
        showToast(`Welcome to Cortex, ${name || email.split("@")[0]}!`, "success");
      } else {
        await onLogin(email, password);
        showToast("Signed in successfully", "success");
      }
      onClose();
    } catch (err) {
      showToast(err.message || "Authentication failed", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="auth-modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="auth-header">
          <div className="auth-logo-icon">
            <Sparkles size={20} className="text-white" />
          </div>
          <h2 className="auth-title">{isRegister ? "Create an account" : "Welcome back"}</h2>
          <p className="auth-subtitle">
            {isRegister
              ? "Start your private multimodal AI workspace"
              : "Sign in to access your conversations and files"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {isRegister && (
            <div className="auth-field">
              <label htmlFor="auth-name">Your Name</label>
              <div className="auth-input-wrapper">
                <User size={15} className="auth-field-icon" />
                <input
                  id="auth-name"
                  type="text"
                  placeholder="e.g. Amit Pol"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus={isRegister}
                />
              </div>
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">Email Address</label>
            <div className="auth-input-wrapper">
              <Mail size={15} className="auth-field-icon" />
              <input
                id="auth-email"
                type="email"
                required
                placeholder="amit@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={!isRegister}
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-input-wrapper">
              <Lock size={15} className="auth-field-icon" />
              <input
                id="auth-password"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="auth-submit-btn">
            <span>{isLoading ? "Processing..." : isRegister ? "Create Account" : "Sign In"}</span>
            <ArrowRight size={15} />
          </button>
        </form>

        <div className="auth-footer">
          <span>{isRegister ? "Already have an account?" : "Don't have an account yet?"}</span>
          <button
            type="button"
            className="auth-switch-btn"
            onClick={() => setIsRegister(!isRegister)}
          >
            {isRegister ? "Sign in" : "Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
