import { useState, useEffect, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";

function loadUserSessions(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(`cortex_sessions_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  const initial = [{ id: uuidv4(), title: "New Chat", messages: [], updatedAt: Date.now() }];
  try {
    localStorage.setItem(`cortex_sessions_${userId}`, JSON.stringify(initial));
  } catch {}
  return initial;
}

export function useConversations(userId) {
  const [sessions, setSessions] = useState(() => loadUserSessions(userId));
  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id || uuidv4());

  // Reload when user changes
  useEffect(() => {
    if (!userId) return;
    const loaded = loadUserSessions(userId);
    setSessions(loaded);
    setActiveSessionId(loaded[0]?.id || uuidv4());
  }, [userId]);

  // Persist sessions
  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(`cortex_sessions_${userId}`, JSON.stringify(sessions));
    } catch {}
  }, [sessions, userId]);

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  }, [sessions, activeSessionId]);

  const messages = useMemo(() => {
    return activeSession?.messages || [];
  }, [activeSession]);

  const createNewChat = useCallback(() => {
    const newSession = {
      id: uuidv4(),
      title: "New Chat",
      messages: [],
      updatedAt: Date.now(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    return newSession.id;
  }, []);

  const deleteSession = useCallback((sessionId) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        const fresh = [{ id: uuidv4(), title: "New Chat", messages: [], updatedAt: Date.now() }];
        setActiveSessionId(fresh[0].id);
        return fresh;
      }
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  }, [activeSessionId]);

  const renameSession = useCallback((sessionId, newTitle) => {
    if (!newTitle?.trim()) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, title: newTitle.trim(), updatedAt: Date.now() } : s
      )
    );
  }, []);

  const addMessage = useCallback((sessionId, msg) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const updatedMsgs = [...s.messages, msg];
        // Auto-title from first user message if title is default
        let title = s.title;
        if (s.title === "New Chat" && msg.role === "user" && msg.content) {
          title = msg.content.slice(0, 32).trim() || "New Chat";
        }
        return {
          ...s,
          title,
          messages: updatedMsgs,
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  const updateMessage = useCallback((sessionId, messageId, updates) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: s.messages.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  const appendToMessage = useCallback((sessionId, messageId, delta) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, content: (m.content || "") + delta } : m
          ),
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  // Message editing with branching (truncates subsequent messages and starts fresh)
  const truncateMessagesFrom = useCallback((sessionId, messageId) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const index = s.messages.findIndex((m) => m.id === messageId);
        if (index === -1) return s;
        return {
          ...s,
          messages: s.messages.slice(0, index),
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    messages,
    createNewChat,
    deleteSession,
    renameSession,
    addMessage,
    updateMessage,
    appendToMessage,
    truncateMessagesFrom,
  };
}
