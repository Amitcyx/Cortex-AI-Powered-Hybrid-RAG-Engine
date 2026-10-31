import { useState, useMemo } from "react";
import {
  MessageSquarePlus,
  Sparkles,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Volume2,
} from "lucide-react";
import ConversationSearch from "./ConversationSearch";
import ConversationItem from "./ConversationItem";
import FileLibraryModal from "./FileLibraryModal";
import UserProfile from "../auth/UserProfile";

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  currentUser,
  onOpenAuth,
  onLogout,
  isOpen,
  onToggleSidebar,
  isMobile,
  onOpenSettings,
  selectedVoice = "default",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isFileLibraryOpen, setIsFileLibraryOpen] = useState(false);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobile && isOpen && (
        <div className="sidebar-mobile-backdrop" onClick={onToggleSidebar} />
      )}

      <aside
        className={`sidebar ${isOpen ? "open" : "collapsed"} ${isMobile ? "mobile" : ""}`}
        aria-label="Sidebar navigation"
      >
        {/* Sidebar Header */}
        <div className="sidebar-header">
          <div
            className="sidebar-brand"
            onClick={!isOpen ? onToggleSidebar : undefined}
            title={!isOpen ? "Expand sidebar" : undefined}
            role={!isOpen ? "button" : undefined}
          >
            <div className="sidebar-logo-icon">
              <Sparkles size={18} className="text-white" />
            </div>
            {isOpen && (
              <div className="sidebar-brand-text">
                <span className="sidebar-brand-title">Cortex</span>
                <span className="sidebar-brand-subtitle">Hybrid RAG Engine</span>
              </div>
            )}
          </div>

          {isOpen && (
            <button
              onClick={onToggleSidebar}
              className="sidebar-toggle-btn"
              title="Collapse sidebar (Ctrl+/)"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={17} />
            </button>
          )}
        </div>

        {/* Primary Action: New Chat */}
        <div className="sidebar-new-chat-wrapper">
          <button
            onClick={onNewChat}
            className={`new-chat-btn ${!isOpen ? "collapsed" : ""}`}
            title="Start new conversation (Ctrl+Shift+O)"
            aria-label="New chat"
          >
            <MessageSquarePlus size={17} className="shrink-0" />
            {isOpen && <span>New Chat</span>}
          </button>
        </div>

        {/* Search Bar (Expanded only) */}
        {isOpen && (
          <div className="sidebar-search-wrapper">
            <ConversationSearch
              query={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery("")}
              isCollapsed={!isOpen}
            />
          </div>
        )}

        {/* Conversation List */}
        <div className="sidebar-chats-container" role="list">
          {isOpen && (
            <div className="sidebar-section-title">
              <span>Conversations ({filteredSessions.length})</span>
            </div>
          )}

          {filteredSessions.length === 0 ? (
            isOpen && (
              <div className="sidebar-empty-chats">
                {searchQuery ? "No matching chats" : "No conversations yet"}
              </div>
            )
          ) : (
            filteredSessions.map((session) => (
              <ConversationItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isCollapsed={!isOpen}
                onSelect={onSelectSession}
                onRename={onRenameSession}
                onDelete={onDeleteSession}
              />
            ))
          )}
        </div>

        {/* Primary Action: Knowledge & File Library */}
        <div className="sidebar-files-section">
          <button
            className={`sidebar-files-btn ${!isOpen ? "collapsed" : ""}`}
            onClick={() => setIsFileLibraryOpen(true)}
            title="Knowledge Base & Uploaded Files"
            aria-label="Files and Knowledge Base"
          >
            <Database size={17} className="shrink-0 text-blue-400" />
            {isOpen && <span>Knowledge & Files</span>}
          </button>
        </div>

        {/* Settings Action: Voice & Preferences (PRD Section 10) */}
        <div className="sidebar-settings-section">
          <button
            className={`sidebar-settings-btn ${!isOpen ? "collapsed" : ""}`}
            onClick={onOpenSettings}
            title="Settings (Voice & Preferences)"
            aria-label="Settings"
          >
            <Settings size={17} className="shrink-0 text-slate-400" />
            {isOpen && (
              <div className="sidebar-action-label-row">
                <span>Settings</span>
                <span className="sidebar-voice-pill">
                  <Volume2 size={11} className="inline mr-1" />
                  {selectedVoice.charAt(0).toUpperCase() + selectedVoice.slice(1)}
                </span>
              </div>
            )}
          </button>
        </div>

        {/* Sidebar Footer: User Account */}
        <div className="sidebar-footer">
          <UserProfile
            currentUser={currentUser}
            onOpenAuth={onOpenAuth}
            onLogout={onLogout}
            isCollapsed={!isOpen}
          />
        </div>
      </aside>

      {/* File Library Modal */}
      <FileLibraryModal
        isOpen={isFileLibraryOpen}
        onClose={() => setIsFileLibraryOpen(false)}
        userId={currentUser?.id}
      />
    </>
  );
}
