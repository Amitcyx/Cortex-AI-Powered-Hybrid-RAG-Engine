import { Search, X } from "lucide-react";

export default function ConversationSearch({ query, onChange, onClear, isCollapsed }) {
  if (isCollapsed) return null;

  return (
    <div className="sidebar-search-box">
      <Search size={14} className="sidebar-search-icon" />
      <input
        type="text"
        placeholder="Search conversations..."
        value={query}
        onChange={(e) => onChange(e.target.value)}
        className="sidebar-search-input"
        aria-label="Search conversations"
      />
      {query && (
        <button onClick={onClear} className="sidebar-search-clear-btn" aria-label="Clear search">
          <X size={12} />
        </button>
      )}
    </div>
  );
}
