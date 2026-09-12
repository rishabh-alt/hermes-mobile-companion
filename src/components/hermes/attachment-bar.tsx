import { Paperclip, X } from "lucide-react";
import {
  PromptInputButton,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { haptic } from "@/lib/hermes/haptics";

export function AttachmentAddButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label="Add files"
      onClick={() => {
        haptic("tap");
        attachments.openFileDialog();
      }}
    >
      <Paperclip />
    </PromptInputButton>
  );
}

export function AttachmentPreviews() {
  const attachments = usePromptInputAttachments();
  if (!attachments.files.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto px-3 pt-3">
      {attachments.files.map((file) => (
        <div
          key={file.id}
          className="relative flex shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-secondary/50 p-1.5 pr-7"
        >
          {file.mediaType?.startsWith("image/") ? (
            <img
              src={file.url}
              alt={file.filename ?? "attachment"}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <Paperclip className="ml-1 h-4 w-4 text-primary" />
          )}
          <span className="max-w-28 truncate text-[11px]">{file.filename ?? "file"}</span>
          <button
            aria-label="Remove attachment"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
            onClick={() => attachments.remove(file.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
