import { Show } from "solid-js";

interface ResetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ResetDialog(props: ResetDialogProps) {
  const handleOverlayClick = (e: MouseEvent) => {
    // Close when clicking outside the dialog
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal reset-dialog">
          <h2 class="modal-title">Factory Reset</h2>

          <div class="reset-warning">
            <p><strong>Warning:</strong> This action cannot be undone!</p>
            <p>Factory reset will:</p>
            <ul>
              <li>Delete all files and directories you created</li>
              <li>Remove all sessions and their data</li>
              <li>Clear AI configuration and API keys</li>
              <li>Reset theme preferences</li>
              <li>Restore default filesystem</li>
            </ul>
          </div>

          <div class="modal-actions">
            <button
              class="btn btn-secondary"
              onClick={props.onClose}
            >
              Cancel
            </button>
            <button
              class="btn btn-danger"
              onClick={props.onConfirm}
            >
              Reset Everything
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
