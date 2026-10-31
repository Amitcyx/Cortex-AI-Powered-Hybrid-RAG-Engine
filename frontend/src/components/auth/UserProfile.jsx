import { useState, useEffect } from "react";
import { LogOut, LogIn, Sparkles, X } from "lucide-react";

export default function UserProfile({ currentUser, onOpenAuth, onLogout, isCollapsed }) {
  const [showModal, setShowModal] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showModal]);

  const initials = currentUser?.name
    ? currentUser.name.slice(0, 2).toUpperCase()
    : currentUser?.email?.slice(0, 2).toUpperCase() || "U";

  return (
    <div className="user-profile-wrapper">
      <button
        className={`user-profile-btn ${isCollapsed ? "collapsed" : ""}`}
        onClick={() => setShowModal(true)}
        title={isCollapsed ? currentUser?.name || currentUser?.email || "Account" : undefined}
        aria-label="User account menu"
      >
        <div
          className="user-avatar"
          style={{ background: currentUser?.avatarColor || "linear-gradient(135deg, #4285f4, #9b51e0)" }}
        >
          {initials}
        </div>

        {!isCollapsed && (
          <div className="user-info">
            <span className="user-name">{currentUser?.name || "Cortex User"}</span>
            <span className="user-email">{currentUser?.email || "Signed in"}</span>
          </div>
        )}
      </button>

      {/* Centered Modal Dialog */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="user-profile-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close-btn user-profile-modal-close"
              onClick={() => setShowModal(false)}
              aria-label="Close"
            >
              <X size={16} />
            </button>

            <div className="user-profile-modal-content">
              <div
                className="user-profile-modal-avatar"
                style={{
                  background:
                    currentUser?.avatarColor || "linear-gradient(135deg, #4285f4, #9b51e0)",
                }}
              >
                {initials}
              </div>

              <h3 className="user-profile-modal-name">
                {currentUser?.name || "Cortex User"}
              </h3>
              <p className="user-profile-modal-email">
                {currentUser?.email || "Default Workspace User"}
              </p>

              <div className="user-profile-modal-badge">
                <Sparkles size={13} className="text-blue-400" />
                <span>
                  {currentUser?.id !== "user_default"
                    ? "Signed in Account"
                    : "Local Guest Account"}
                </span>
              </div>
            </div>

            <div className="user-profile-modal-actions">
              {currentUser?.id !== "user_default" ? (
                <button
                  className="user-profile-logout-btn"
                  onClick={() => {
                    setShowModal(false);
                    onLogout();
                  }}
                >
                  <LogOut size={16} />
                  <span>Log out</span>
                </button>
              ) : (
                <button
                  className="user-profile-login-btn"
                  onClick={() => {
                    setShowModal(false);
                    onOpenAuth();
                  }}
                >
                  <LogIn size={16} />
                  <span>Sign in / Register</span>
                </button>
              )}

              <button
                className="user-profile-cancel-btn"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
