
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

const API_BASE = "http://localhost:8080/api";

const MODELS = [
  { value: "qwen3:8b", label: "Qwen3 8B" },
  { value: "deepseek-r1:7b", label: "DeepSeek-R1 7B" },
];

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with HTTP ${response.status}`;

    try {
      const data = await response.json();
      message =
        data.detail ||
        data.message ||
        data.error ||
        data.title ||
        message;
    } catch {
      // Keep the default error message.
    }

    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function getChatTitle(content) {
  const title = content.trim();
  return title.length > 42 ? `${title.slice(0, 42)}…` : title;
}

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [model, setModel] = useState("qwen3:8b");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const chatEndRef = useRef(null);
  const abortRef = useRef(null);
  const activeIdRef = useRef(null);
  const loadingRef = useRef(false);

  const activeChat =
    conversations.find((chat) => chat.id === activeId) ?? null;

  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Load saved conversations from H2 through Spring Boot.
  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const saved = await apiRequest("/conversations");
        if (cancelled) return;

        const chats = Array.isArray(saved) ? saved : [];
        setConversations(chats);

        if (chats.length > 0) {
          const firstId = chats[0].id;
          activeIdRef.current = firstId;
          setActiveId(firstId);

          const selected = await apiRequest(
            `/conversations/${firstId}`
          );

          if (cancelled) return;

          setConversations((previous) =>
            previous.map((chat) =>
              chat.id === selected.id ? selected : chat
            )
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            `${err.message}. Make sure Spring Boot is running on port 8080.`
          );
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    loadConversations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Keep conversation updates centralized.
  const updateChat = useCallback((id, updater) => {
    setConversations((previous) =>
      previous.map((chat) =>
        chat.id === id ? updater(chat) : chat
      )
    );
  }, []);

  // Create a conversation in the database.
  async function newChat() {
    if (loadingRef.current) return;

    setError("");
    setMessage("");
    setMobileSidebarOpen(false);

    try {
      const chat = await apiRequest("/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "New chat" }),
      });

      setConversations((previous) => [
        chat,
        ...previous.filter((item) => item.id !== chat.id),
      ]);

      activeIdRef.current = chat.id;
      setActiveId(chat.id);
    } catch (err) {
      setError(`Could not create a new chat: ${err.message}`);
    }
  }

  // Open a saved conversation and fetch its messages.
  async function selectChat(id) {
    if (loadingRef.current || id === activeIdRef.current) {
      setMobileSidebarOpen(false);
      return;
    }

    setError("");
    setMessage("");
    setMobileSidebarOpen(false);
    activeIdRef.current = id;
    setActiveId(id);

    try {
      const chat = await apiRequest(`/conversations/${id}`);

      if (activeIdRef.current !== id) return;

      updateChat(id, () => chat);
    } catch (err) {
      if (activeIdRef.current === id) {
        setError(`Could not load this conversation: ${err.message}`);
      }
    }
  }

  // Send a message through Spring Boot and Ollama.
  async function sendMessage(event) {
    event?.preventDefault();

    const text = message.trim();

    if (!text || loadingRef.current) return;

    setError("");
    setLoading(true);
    loadingRef.current = true;
    setMessage("");

    const controller = new AbortController();
    abortRef.current = controller;

    let chatId = activeIdRef.current;

    try {
      // Create a saved conversation if none is selected.
      if (!chatId) {
        const chat = await apiRequest("/conversations", {
          method: "POST",
          body: JSON.stringify({ title: "New chat" }),
          signal: controller.signal,
        });

        chatId = chat.id;
        activeIdRef.current = chatId;
        setActiveId(chatId);
        setConversations((previous) => [chat, ...previous]);
      }

      const currentChat = conversations.find(
        (chat) => chat.id === chatId
      );

      const userMessage = {
        role: "user",
        content: text,
        model,
      };

      // Show the user's message immediately.
      setConversations((previous) =>
        previous.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                title:
                  !currentChat || currentChat.title === "New chat"
                    ? getChatTitle(text)
                    : chat.title,
                messages: [...(chat.messages ?? []), userMessage],
              }
            : chat
        )
      );

      const result = await apiRequest(
        `/conversations/${chatId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: text, model }),
          signal: controller.signal,
        }
      );

      // Show the model's response.
      setConversations((previous) =>
        previous.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [
                  ...(chat.messages ?? []),
                  {
                    role: "assistant",
                    content:
                      result.reply ??
                      "The model returned an empty response.",
                    model: result.model ?? model,
                  },
                ],
              }
            : chat
        )
      );

      // Fetch the authoritative saved conversation.
      const savedChat = await apiRequest(
        `/conversations/${chatId}`,
        { signal: controller.signal }
      );

      setConversations((previous) => [
        savedChat,
        ...previous.filter((chat) => chat.id !== chatId),
      ]);

      // Refresh sidebar titles and ordering.
      const updatedList = await apiRequest("/conversations", {
        signal: controller.signal,
      });

      setConversations((previous) => {
        const details = new Map(
          previous.map((chat) => [chat.id, chat])
        );

        return updatedList.map((chat) => {
          const existing = details.get(chat.id);

          return existing
            ? { ...chat, messages: existing.messages ?? [] }
            : chat;
        });
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(
          `${err.message}. Check that Spring Boot and Ollama are running.`
        );
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
      abortRef.current = null;
    }
  }

  // Delete a conversation from H2.
  async function deleteChat(id) {
    if (loadingRef.current) return;

    const previousChats = conversations;
    const remaining = conversations.filter((chat) => chat.id !== id);

    setError("");
    setConversations(remaining);

    if (activeIdRef.current === id) {
      const nextId = remaining[0]?.id ?? null;
      activeIdRef.current = nextId;
      setActiveId(nextId);
    }

    try {
      await apiRequest(`/conversations/${id}`, {
        method: "DELETE",
      });

      // Load the next conversation's messages if one exists.
      const nextId = activeIdRef.current;

      if (nextId) {
        const nextChat = await apiRequest(`/conversations/${nextId}`);

        if (activeIdRef.current === nextId) {
          updateChat(nextId, () => nextChat);
        }
      }
    } catch (err) {
      setConversations(previousChats);
      setError(`Could not delete the conversation: ${err.message}`);
    }
  }

  function applySuggestion(text) {
    setMessage(text);
    document.querySelector(".composer textarea")?.focus();
  }

  return (
    <div className="layout">
      {mobileSidebarOpen && (
        <button
          className="mobile-backdrop"
          type="button"
          aria-label="Close chat history"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside
        className={`sidebar ${
          mobileSidebarOpen ? "mobile-open" : ""
        }`}
        aria-label="Chat history"
      >
        <button
          className="brand"
          type="button"
          onClick={newChat}
          aria-label="PolyLLM home and new chat"
        >
          <span className="brand-icon">P</span>
          <span>PolyLLM</span>
        </button>

        <button
          className="new-chat"
          type="button"
          onClick={newChat}
          disabled={loading}
        >
          <span>＋</span>
          New chat
        </button>

        <div className="history-label">YOUR CHATS</div>

        <div className="history-list">
          {conversations.map((chat) => (
            <div
              key={chat.id}
              className={`history-item ${
                activeId === chat.id ? "selected" : ""
              }`}
            >
              <button
                className="history-title"
                type="button"
                onClick={() => selectChat(chat.id)}
                disabled={loading}
                title={chat.title}
              >
                <span className="history-symbol">◷</span>
                <span>{chat.title}</span>
              </button>

              <button
                className="delete-chat"
                type="button"
                title="Delete conversation"
                aria-label={`Delete ${chat.title}`}
                onClick={() => deleteChat(chat.id)}
                disabled={loading}
              >
                ×
              </button>
            </div>
          ))}

          {initializing && (
            <p className="empty-history">Loading your conversations…</p>
          )}

          {!initializing && conversations.length === 0 && (
            <p className="empty-history">
              Your conversations will appear here.
            </p>
          )}
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          Running locally on your Mac
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button
            className="mobile-brand"
            type="button"
            onClick={() => setMobileSidebarOpen((open) => !open)}
            aria-label="Toggle chat history"
            aria-expanded={mobileSidebarOpen}
          >
            <span>☰</span>
            PolyLLM
          </button>

          <div className="model-control">
            <span className="model-status" />

            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={loading}
              aria-label="Select AI model"
            >
              {MODELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className="conversation" aria-live="polite">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-mark">✳</div>

              <h1>What can I help you with?</h1>

              <p>
                Your private AI workspace, powered by local models.
              </p>

              <div className="suggestions">
                <button
                  type="button"
                  onClick={() =>
                    applySuggestion("Explain artificial intelligence simply.")
                  }
                >
                  <span>✦</span>
                  <strong>Learn something</strong>
                  <small>Explain a complex topic simply</small>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    applySuggestion(
                      "Write a Python program to check whether a number is prime."
                    )
                  }
                >
                  <span>⌘</span>
                  <strong>Write code</strong>
                  <small>Build and understand programs</small>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    applySuggestion("Help me brainstorm a useful AI project.")
                  }
                >
                  <span>↗</span>
                  <strong>Explore an idea</strong>
                  <small>Brainstorm your next project</small>
                </button>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((item, index) => (
                <article
                  className={`message-row ${item.role}`}
                  key={item.id ?? `${item.role}-${index}`}
                >
                  <div className="avatar">
                    {item.role === "user" ? "Y" : "P"}
                  </div>

                  <div className="message-body">
                    <div className="message-heading">
                      <strong>
                        {item.role === "user" ? "You" : "PolyLLM"}
                      </strong>

                      {item.model && (
                        <span className="message-model">
                          {item.model}
                        </span>
                      )}
                    </div>

                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.content ?? ""}
                      </ReactMarkdown>
                    </div>

                    {item.role === "assistant" && (
                      <button
                        className="copy-button"
                        type="button"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(item.content ?? "")
                            .catch(() =>
                              setError("Could not copy the answer.")
                            )
                        }
                      >
                        Copy answer
                      </button>
                    )}
                  </div>
                </article>
              ))}

              {loading && (
                <div className="message-row assistant">
                  <div className="avatar">P</div>
                  <div className="message-body">
                    <div className="message-heading">
                      <strong>PolyLLM</strong>
                      <span className="message-model">
                        {model}
                      </span>
                    </div>

                    <div
                      className="thinking"
                      role="status"
                      aria-label="Generating response"
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </section>

        <div className="composer-area">
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Message PolyLLM..."
              rows={1}
              disabled={loading}
              aria-label="Message PolyLLM"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(event);
                }
              }}
            />

            <button
              className="send-button"
              type="submit"
              disabled={loading || !message.trim()}
              aria-label="Send message"
            >
              ↑
            </button>
          </form>

          <p className="privacy-note">
            AI can make mistakes. Your local models run on your Mac.
          </p>
        </div>
      </main>
    </div>
  );
}
