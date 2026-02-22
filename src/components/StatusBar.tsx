interface StatusBarProps {
  currentDirectory: string;
  aiModel: string;
  sessionName: string;
}

export function StatusBar(props: StatusBarProps) {
  return (
    <div class="status-bar">
      <div class="status-item">
        <span class="status-label">Directory:</span>
        <span class="status-value">{props.currentDirectory}</span>
      </div>
      <div class="status-item">
        <span class="status-label">Model:</span>
        <span class="status-value">{props.aiModel || "Not configured"}</span>
      </div>
      <div class="status-item">
        <span class="status-label">Session:</span>
        <span class="status-value">{props.sessionName}</span>
      </div>
    </div>
  );
}
