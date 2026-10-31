# Cortex AI — Frontend Product Requirements Document

**Status:** Ready for implementation  
**Product:** Cortex AI  
**Platform:** Responsive web application (desktop first; mobile supported)  
**Primary objective:** Deliver a dark, conversational AI workspace inspired by the usability of ChatGPT and Claude, connected to every capability already exposed by the Cortex backend.

## 1. Product vision

Cortex AI is a private, multimodal assistant. A signed-in user can create and manage conversations, chat with streaming responses, speak naturally in a real-time voice mode, attach supported media or documents, and use previously uploaded knowledge in later conversations.

The interface should feel familiar to ChatGPT without copying its branding, wording, artwork, or proprietary features. “ChatGPT-like” in this PRD means a high-quality conversational workflow: fast message composition, streamed answers, conversation navigation, attachments, voice interaction, and clear recovery from errors.

## 2. Scope and product boundary

### Included in the first release

- Dark-theme chat workspace with an expandable/collapsible Claude-style sidebar.
- Email/password account creation, login, logout, and authenticated sessions.
- Create, select, rename, edit, and delete conversations.
- Streaming text chat using the existing Cortex RAG and memory pipeline.
- Upload and use documents, images, video, and audio from the composer.
- Audio transcription with an editable transcript before sending as text.
- Full-screen voice mode using the existing WebSocket protocol, including persona selection, streamed spoken answers, and interruption.
- Uploaded-file library showing backend-provided summaries and Mermaid diagrams.
- Long-term-memory consolidation control.
- Responsive, accessible UI and clear loading/error states.

### Explicitly not promised by the current backend

Web browsing, image generation, code execution, collaborative shared chats, usage/billing plans, account recovery/email verification, and ChatGPT’s proprietary models/features are out of scope unless APIs are added. The UI must not display controls for capabilities that do not function.

## 3. Users and core journeys

| User | Goal | Successful outcome |
| --- | --- | --- |
| New user | Start using Cortex | Creates an account, signs in, and lands in a fresh chat. |
| Returning user | Continue work | Finds, opens, and continues a named conversation. |
| Research user | Ask about a file | Uploads a supported document, sees indexing status, and gets a grounded answer in chat. |
| Multimodal user | Discuss media | Attaches an image, video, or audio file and receives an appropriate response. |
| Voice user | Hold a spoken conversation | Opens voice mode, selects a persona, speaks, hears streaming responses, and can interrupt. |

## 4. Information architecture

```text
Application shell
├── Authentication
│   ├── Sign in
│   └── Create account
├── Workspace
│   ├── Sidebar
│   │   ├── New chat
│   │   ├── Conversation list and search
│   │   ├── File library
│   │   └── Account menu / logout
│   ├── Chat view
│   │   ├── Conversation header and actions
│   │   ├── Message timeline
│   │   └── Multimodal composer
│   └── Voice-mode overlay
└── Settings / profile (minimal first release)
```

## 5. Functional requirements

### 5.1 Authentication and sessions

1. Unauthenticated visitors must see sign-in and account-creation screens, not the workspace.
2. A user can register, sign in, sign out, and remain signed in after a refresh.
3. The client must never accept a manually editable `user_id` as identity. It must derive the user from an authenticated server session/token.
4. On logout, clear client state and redirect to sign-in.
5. Display friendly validation and failure messages without exposing server internals.

**Backend dependency:** This does not exist today. Add password hashing, a users table, registration/login/logout/session endpoints, and authorization middleware. Every user-scoped endpoint must obtain the authenticated user on the server rather than trusting `user_id` supplied by the browser.

### 5.2 Application shell and visual design

1. Use a dark-only theme for v1: near-black app background, raised charcoal panels, high-contrast text, and one restrained accent color.
2. Desktop layout: fixed sidebar, main conversation area, composer anchored at the bottom.
3. The sidebar has open and collapsed states. When collapsed, it becomes a narrow icon strip with tooltips; it must retain New Chat, expand, files, and account access.
4. Persist the sidebar state locally per user.
5. On small screens, the sidebar becomes an off-canvas drawer; it must be keyboard-dismissible and accessible.

### 5.3 Conversation management

1. New Chat creates an empty conversation and makes it active.
2. The first completed user message automatically creates a short title; the user may rename it.
3. Sidebar shows the user’s conversations ordered by most recently updated, with title, last activity, and active state.
4. A conversation menu supports Rename and Delete, with a confirmation before deletion.
5. A user can edit one of their text messages; this creates a new response from that point onward. The UI must explain that later messages are replaced.
6. The active conversation can be searched by title in the sidebar. Full-text message search is a later enhancement.

**Backend dependency:** Existing SQLite storage has messages keyed by `session_id`, but no conversation metadata or management API. Add a `conversations` table and authenticated CRUD endpoints: create, list, get messages, update title, delete, and update/branch after editing a message. Do not fake persistence with only browser storage.

### 5.4 Text chat

1. The composer accepts text, supports Enter to send and Shift+Enter for a new line, and disables sending empty text.
2. Sending uses `POST /chat/stream` for the active conversation. The UI renders assistant tokens progressively and provides Stop generation.
3. Each message shows its role, timestamp, and Markdown-safe content. Code blocks require copy controls. Never render raw model HTML.
4. While an answer is streaming, prevent a duplicate send for that same conversation, but allow cancel.
5. Preserve the current draft and pending attachments if the user changes panels accidentally.
6. Recover gracefully from network/provider failures: retain the user’s message, mark the failed response, and offer Retry.

**Existing API:** `POST /chat/stream` with `session_id` and `message`; `POST /chat` is a non-streaming fallback.

**Required backend correction before frontend integration:** `/chat/stream` currently queues `done` both through `on_done` and after `stream_chat` returns. Emit and persist one completion only, otherwise the UI can receive/save duplicate assistant messages.

### 5.5 Attachments and files

The composer has one attachment button and a visible attachment tray. It accepts the following types only when the matching endpoint supports them:

| Attachment | UX behavior | Current API |
| --- | --- | --- |
| PDF, text, code, Markdown, JSON, YAML | Upload to the knowledge base; show progress, indexing result, summary, and Mermaid diagram when available. | `POST /upload` |
| Image | Show thumbnail; ask accompanying prompt; send as a chat turn. | `POST /chat/image` |
| Video | Show file card/duration if available; ask accompanying prompt; send as a chat turn. | `POST /chat/video` |
| Audio file | Upload, show transcript and response. | `POST /chat/audio` |
| Recorded audio | Transcribe first; put the editable text in the composer; submit it as a standard text message only after user confirmation. | `POST /chat/audio` or voice WebSocket |

Requirements:

1. Validate client-side extension, MIME type, and file size before upload, while treating server validation as authoritative.
2. Show upload, indexing, transcription, processing, success, and error states.
3. File Library lists `GET /files` results and presents filename, type, date, summary, and Mermaid diagram safely.
4. An uploaded document becomes available to the user’s later RAG-backed text and voice chats; the UI must state this clearly after a successful index.
5. The UI must not claim that images or video uploads are indexed for later RAG: the current backend uses them for the immediate vision turn only.

**Backend hardening required:** General `/upload`, image, video, and audio routes need server-side size limits, MIME/extension validation, filename sanitization, error cleanup, and authorization. The current `/upload` path uses the original filename in a filesystem path and allows unbounded uploads.

### 5.6 Voice mode

1. Voice Mode opens as a focused overlay with Exit, microphone state, live transcript, assistant transcript, playback state, selected persona, and clear error feedback.
2. On entry, connect to `WS /voice/stream`, send a `start` event containing the authenticated user and active conversation ID, and await `ready`.
3. Capture microphone audio only after the user grants browser permission. The primary interaction is press/tap to talk; voice activity detection may improve it but must not block manual stop.
4. Send captured chunks as `audio` messages and a final `stop` message. Display `user_transcript`, render `assistant_delta` incrementally, queue/play ordered `assistant_audio` WAV chunks, and show `turn_done` as the finalized answer.
5. An Interrupt button sends `interrupt`, stops browser playback immediately, and shows the interrupted state.
6. Fetch personas from `GET /speech/personas`; selecting one sends the `persona` WebSocket event and updates only after `persona_updated`.
7. Reconnect once after an unexpected disconnection, then provide a clear Retry/Exit action. Do not silently lose recorded audio.
8. The WebSocket must be closed when leaving voice mode or logging out.

### 5.7 Memory and source transparency

1. In the conversation header menu, provide “Update memory from this chat.” It calls `POST /memory/consolidate` and shows how many facts were extracted.
2. Explain that relevant uploaded files, remembered facts, and prior media may inform answers; do not fabricate citations because the current API does not return per-answer source attribution.
3. A 404/no-history response from consolidation is shown as a non-destructive notice.

### 5.8 Health and operational states

1. On launch, call `GET /health` with a short timeout. If unavailable, show an unobtrusive service-status banner and disable sending.
2. Provide specific messages for authentication failure, unavailable API, model rate-limit, unsupported file, oversized file, microphone denial, disconnected voice session, and failed generation.
3. Use request cancellation (`AbortController`) for streaming text and clean up listeners/audio URLs on unmount.

## 6. Technical architecture

### Recommended free stack

| Area | Choice | Reason |
| --- | --- | --- |
| App | React 18 + Vite + TypeScript | Existing project direction; fast frontend development. |
| Styling | Tailwind CSS | Consistent dark visual system with little custom CSS. |
| Accessible primitives | shadcn/ui + Radix UI | Free, customizable dialogs, menus, drawers, tooltips, and controls. |
| Icons | Lucide React | Free, consistent icon library. |
| Client state | Zustand | Small store for active conversation, draft, sidebar, and UI state. |
| Server state | TanStack Query | Caching, retries, invalidation, and mutation states for APIs. |
| Forms/validation | React Hook Form + Zod | Reliable authentication, rename, and attachment forms. |
| Markdown | react-markdown + remark-gfm + DOMPurify | Safe rendered responses with tables/code support. |
| Motion | Framer Motion | Optional, reduced-motion-aware panel and overlay transitions. |
| Tests | Vitest + React Testing Library + Playwright | Unit, integration, and end-to-end coverage. |

All listed libraries are free/open source. Hosting and LLM-provider usage may still carry costs.

### Frontend organization

```text
frontend/src/
├── app/             # routing, providers, app shell
├── components/      # reusable UI components
├── features/
│   ├── auth/
│   ├── conversations/
│   ├── chat/
│   ├── attachments/
│   ├── files/
│   └── voice/
├── lib/             # API client, SSE parser, WebSocket/audio helpers
├── stores/          # Zustand UI stores only
├── styles/
└── test/
```

### API contract rules

1. All API calls pass through one typed client. No component calls `fetch` directly.
2. The authenticated identity comes from an HTTP-only secure cookie or short-lived access token with refresh flow; never local storage for long-lived credentials.
3. Replace request-body/query `user_id` with server-derived identity on every protected route.
4. CORS must use the deployed frontend origin(s), not `*`, in production.
5. The frontend only uses an endpoint after its success/error contract is defined and tested.

## 7. Non-functional requirements

- **Accessibility:** Keyboard navigation, visible focus, semantic labels, tooltips for collapsed sidebar icons, focus traps in dialogs/overlay, contrast meeting WCAG AA, and `prefers-reduced-motion` support.
- **Security:** No provider key in the client; authenticated and authorized server requests; safe Markdown rendering; validated files; secure session handling.
- **Performance:** Initial app shell should load quickly on a normal broadband connection; avoid blocking UI while uploads/transcription/generation run; virtualize the conversation list if it becomes large.
- **Privacy:** Clearly label microphone activation and file upload; stop capture on leaving voice mode; do not log user content in browser analytics.
- **Browser support:** Current Chrome, Edge, Firefox, and Safari. Voice capability must degrade gracefully where `MediaRecorder`/audio playback differs.

## 8. Delivery plan and dependencies

### Phase 0 — Backend foundation (required)

1. Add authentication and authorization.
2. Add conversation CRUD, messages retrieval, rename/delete, and edited-message branching/replacement.
3. Correct streaming completion duplication.
4. Harden all upload endpoints and define limits.
5. Define a versioned API schema/OpenAPI contract for the frontend.

### Phase 1 — Core workspace

1. Scaffold the TypeScript Vite app and dark design system.
2. Build auth, app shell, responsive collapsible sidebar, and conversation CRUD UI.
3. Implement streaming text chat, safe Markdown, cancellation, retries, and loading/error states.

### Phase 2 — Multimodal and knowledge

1. Implement attachment tray and each supported route.
2. Implement file library, indexing feedback, summaries, and Mermaid rendering.
3. Add memory consolidation action.

### Phase 3 — Voice mode and quality

1. Implement the WebSocket voice overlay, microphone capture, audio queue, personas, interruption, and reconnection.
2. Complete accessibility, responsive testing, security review, and end-to-end tests.

## 9. Acceptance criteria

A release is acceptable only when all of the following pass in a staging environment with valid provider credentials:

1. A new user can register, log in, create two chats, rename one, delete one, log out, log back in, and see only their own remaining chat.
2. A streamed text answer appears once, can be cancelled, and remains correctly persisted after refresh.
3. Editing a user message produces the defined replacement/branch behavior without leaving misleading later messages.
4. Each supported attachment type reaches its correct backend endpoint and displays a clear result or actionable failure state.
5. A supported document indexes successfully and affects a relevant later text query; an image/video is not falsely labelled as indexed knowledge.
6. A user can enter voice mode, select a persona, record a turn, see both transcripts, hear ordered response audio, interrupt it, and exit cleanly.
7. The sidebar works in expanded, icon-strip, and mobile drawer modes using mouse, keyboard, and touch.
8. No API keys are shipped to the browser; protected endpoints reject unauthenticated/cross-user access.
9. Automated unit/integration tests pass, and Playwright covers the core paths above against a test backend.
10. There are no known console errors, unhandled promise rejections, duplicate final messages, or leaked microphone/WebSocket resources in the tested flows.

## 10. Risks and decisions to make before coding

- Authentication method: use local email/password for the first release, or choose an external identity provider. The recommendation is local password auth with Argon2/bcrypt hashing and HTTP-only sessions to avoid a paid dependency.
- File limits and supported document formats must be explicitly set. The current ingestion implementation extracts text only from PDFs and code/text-like extensions; Office files are not currently supported.
- “Every ChatGPT feature” cannot be literal with the current APIs. This PRD implements every existing Cortex backend feature and the core ChatGPT-style product features listed above. Additional capabilities require corresponding backend work and a separate scope decision.
- “No errors” is a quality goal, not a guarantee. The acceptance criteria enforce testing and graceful error handling so failures are contained and understandable rather than hidden.
