export interface ToastMsg {
  message: string;
  kind: "info" | "success" | "error" | "warn";
}

export function Toast({ toast, onClose }: { toast: ToastMsg; onClose: () => void }) {
  const icon =
    toast.kind === "success" ? "✓" : toast.kind === "error" ? "✕" : toast.kind === "warn" ? "⚠" : "ℹ";
  return (
    <div className={`toast toast-${toast.kind}`} onClick={onClose} role="status">
      <span className="toast-icon">{icon}</span>
      <span>{toast.message}</span>
    </div>
  );
}
