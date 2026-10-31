import { useState, useRef, useEffect } from "react";
import { MessageSquare, Edit2, Trash2, Check, X } from "lucide-react";

export default function ConversationItem({
  session,
  isActive,
  isCollapsed,
  onSelect,
  onRename,
  onDelete,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setEditTitle(session.title);
  }, [session.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSaveRename = (e) => {
    e?.stopPropagation();
    if (editTitle.trim() && editTitle.trim() !== session.title) {
      onRename(session.id, editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleCancelRename = (e) => {
    e?.stopPropagation();
    setEditTitle(session.title);
    setIsEditing(false);
  };

  const handleDelete = (e) => {
    e?.stopPropagation();
    onDelete(session.id);
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className={`sidebar-chat-item ${isActive ? "active" : ""} ${isCollapsed ? "collapsed" : ""}`}
      onClick={() => onSelect(session.id)}
      title={isCollapsed ? session.title : undefined}
      role="listitem"
    >
      <MessageSquare size={16} className="sidebar-chat-icon shrink-0" />

      {/* When sidebar is expanded and not editing */}
      {!isCollapsed && !isEditing && (
        <>
          <span className="sidebar-chat-title" title={session.title}>
            {session.title || "Untitled Chat"}
          </span>

          {/* Secondary actions shown ONLY on hover in expanded mode */}
          <div className="sidebar-item-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="sidebar-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              title="Rename conversation"
              aria-label="Rename"
            >
              <Edit2 size={13} />
            </button>
            <button
              className="sidebar-action-btn delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              title="Delete conversation"
              aria-label="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}

      {/* Inline editing input when expanded */}
      {!isCollapsed && isEditing && (
        <div className="sidebar-rename-box" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveRename(e);
              if (e.key === "Escape") handleCancelRename(e);
            }}
            className="sidebar-rename-input"
            aria-label="Edit title"
          />
          <button onClick={handleSaveRename} className="sidebar-rename-btn save" title="Save">
            <Check size={12} />
          </button>
          <button onClick={handleCancelRename} className="sidebar-rename-btn cancel" title="Cancel">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="modal-backdrop-subtle" onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}>
          <div className="delete-confirm-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-white">Delete chat?</h4>
            <p className="text-xs text-zinc-400 mt-1">This will permanently delete this conversation.</p>
            <div className="delete-confirm-actions">
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                className="confirm-btn cancel"
              >
                Cancel
              </button>
              <button onClick={handleDelete} className="confirm-btn delete">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
