import { For } from "solid-js";
import { sessionState, switchSession, deleteSession, createSession } from "../stores/sessions";

export function TabBar() {
  // Convert sessions object to array for iteration
  const getSessions = () => {
    return Object.values(sessionState.sessions);
  };

  const handleTabClick = (sessionId: string) => {
    if (sessionState.active !== sessionId) {
      switchSession(sessionId);
    }
  };

  const handleCloseTab = (e: MouseEvent, sessionId: string) => {
    e.stopPropagation(); // Prevent tab click from firing
    try {
      deleteSession(sessionId);
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  };

  const handleNewTab = () => {
    const sessions = getSessions();
    const existingNames = new Set(sessions.map(s => s.name));
    let counter = sessions.length + 1;
    let newName = `session-${counter}`;
    while (existingNames.has(newName)) {
      counter++;
      newName = `session-${counter}`;
    }
    createSession(newName);
  };

  // Check if we should show close button (more than 1 session)
  const canCloseTab = () => getSessions().length > 1;

  return (
    <div class="tab-bar">
      <For each={getSessions()}>
        {(session) => (
          <div
            class={`tab ${sessionState.active === session.id ? "active" : ""}`}
            onClick={() => handleTabClick(session.id)}
          >
            <span class="tab-name">{session.name}</span>
            {canCloseTab() && (
              <button
                class="tab-close"
                onClick={(e) => handleCloseTab(e, session.id)}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        )}
      </For>
      <button class="tab-new" onClick={handleNewTab} title="New session">
        +
      </button>
    </div>
  );
}
