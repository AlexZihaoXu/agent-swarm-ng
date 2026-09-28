export function MessageReply({ author, text, onCancel }: { author: string; text: string; onCancel?: () => void }) {
  return (
    <div
      role="note"
      aria-label={`${onCancel ? 'Replying to' : 'In reply to'} ${author}`}
      className="flex min-w-0 items-start gap-2 border-l-2 border-current/40 pl-2 text-xs leading-4"
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{author}</span>
        <span className="block truncate opacity-75" title={text}>
          {text}
        </span>
      </div>
      {onCancel && (
        <button
          type="button"
          aria-label="Cancel reply"
          title="Cancel reply"
          onClick={onCancel}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg leading-none opacity-75 outline-none hover:bg-foreground/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring sm:size-6 sm:text-base"
        >
          ×
        </button>
      )}
    </div>
  );
}
