export function AiThinking({ label = 'Đang suy nghĩ' }: { label?: string }) {
  return (
    <div className="ai-thinking" role="status" aria-live="polite">
      <span className="ai-thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </div>
  );
}
