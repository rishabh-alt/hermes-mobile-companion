import { Brain, Copy, Paperclip, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ImageLightbox } from "@/components/hermes/image-lightbox";
import { useHermesConfig } from "@/lib/hermes/config";
import { haptic } from "@/lib/hermes/haptics";
import { visibleChatText } from "@/lib/hermes/transcript";
import type { HermesMessage, ToolCall } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

const REACTIONS = ["👍", "🔥", "🤔", "❌"];

function ReasoningBlock({ text, live }: { text: string; live?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2 rounded-xl bg-secondary/50">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground">
        <Brain className="h-3.5 w-3.5 text-primary" />
        {live ? <Shimmer>Thinking…</Shimmer> : <span>Thought process</span>}
        <span className="ml-auto text-[10px]">{open ? "hide" : "show"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-64 overflow-y-auto whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
        {text}
      </CollapsibleContent>
    </Collapsible>
  );
}

function toolArgSummary(input: unknown): string {
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? input.slice(0, 56) : "";
  }
  const record = input as Record<string, unknown>;
  for (const key of ["command", "cmd", "path", "file", "query", "q", "url", "name", "action"]) {
    const val = record[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim().replace(/\s+/g, " ").slice(0, 56);
    }
  }
  const firstEntry = Object.entries(record)[0];
  if (!firstEntry) return "";
  const [k, v] = firstEntry;
  const formatted = typeof v === "string" ? v : JSON.stringify(v);
  return `${k}: ${formatted}`.slice(0, 56);
}

function ToolBlock({ call, expandedByDefault }: { call: ToolCall; expandedByDefault: boolean }) {
  const isTerminal = /^(bash|shell|terminal|run|exec)/i.test(call.name);
  const summary = toolArgSummary(call.input);
  const output =
    call.output === undefined
      ? undefined
      : typeof call.output === "string"
        ? call.output
        : JSON.stringify(call.output, null, 2);
  return (
    <div className="mb-1.5">
      <Tool
        key={`${call.id}-${expandedByDefault ? "exp" : "cmp"}`}
        className="border-border/70 bg-secondary/35"
        defaultOpen={expandedByDefault}
      >
        <ToolHeader
          type={`tool-${call.name}` as `tool-${string}`}
          state={call.state}
          title={summary ? `${call.name} · ${summary}` : call.name}
          className="px-3 py-2 text-xs"
        />
        <ToolContent>
          <ToolInput input={call.input} />
          {(output !== undefined || call.errorText) && (
            <ToolOutput
              errorText={call.errorText}
              output={
                output === undefined ? undefined : (
                  <pre
                    className={cn(
                      "max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs",
                      isTerminal && "rounded-lg bg-black/40 p-3 font-mono",
                    )}
                  >
                    {output}
                  </pre>
                )
              }
            />
          )}
        </ToolContent>
      </Tool>
    </div>
  );
}

function Attachments({ message }: { message: HermesMessage }) {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  if (!message.attachments?.length) return null;
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2">
        {message.attachments.map((a) =>
          a.mediaType.startsWith("image/") ? (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                haptic("tap");
                setPreview({ src: a.url, alt: a.name });
              }}
              aria-label={`View ${a.name}`}
              className="group relative overflow-hidden rounded-xl border border-border/70 text-left focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <img
                src={a.url}
                alt={a.name}
                loading="lazy"
                className="max-h-48 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </button>
          ) : (
            <a
              key={a.id}
              href={a.url}
              download={a.name}
              className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs"
            >
              <Paperclip className="h-3.5 w-3.5 text-primary" />
              <span className="max-w-40 truncate">{a.name}</span>
            </a>
          ),
        )}
      </div>
      {preview && (
        <ImageLightbox
          open={Boolean(preview)}
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
          src={preview.src}
          alt={preview.alt}
        />
      )}
    </>
  );
}

interface Props {
  message: HermesMessage;
  live?: boolean | undefined;
  highlighted?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onReact?: ((emoji: string) => void) | undefined;
}

export function MessageBubble({ message, live, highlighted, onRetry, onReact }: Props) {
  const { config } = useHermesConfig();
  const [showActions, setShowActions] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const isUser = message.role === "user";
  const expandedTools = config.toolDetail === "expanded";

  const toggleSpeak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const cleanText = visibleChatText(message.text).trim();
    if (!cleanText) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <Message
      from={isUser ? "user" : "assistant"}
      className={cn(
        "[&>div]:max-w-[92%]",
        highlighted && "rounded-2xl bg-primary/10 p-1.5 ring-1 ring-primary/50",
      )}
    >
      <div className="min-w-0">
        <MessageContent
          onContextMenu={(e) => {
            e.preventDefault();
            haptic("tap");
            setShowActions((v) => !v);
          }}
          className={cn(
            "min-w-0",
            isUser
              ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground"
              : "bg-transparent px-0 text-foreground",
          )}
        >
          <Attachments message={message} />
          {message.reasoning && <ReasoningBlock text={message.reasoning} live={live} />}
          {message.tools?.map((call) => (
            <ToolBlock key={call.id} call={call} expandedByDefault={expandedTools} />
          ))}
          {message.text ? (
            isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm">
                {visibleChatText(message.text)}
              </p>
            ) : (
              <MessageResponse>{visibleChatText(message.text)}</MessageResponse>
            )
          ) : live && !message.reasoning && !message.tools?.length ? (
            <Shimmer className="text-sm">Hermes is working…</Shimmer>
          ) : null}
          {message.error && (
            <p className="mt-2 rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
              {message.error}
            </p>
          )}
        </MessageContent>

        {!isUser && !live && message.text.trim() && !showActions && (
          <div className="mt-1 flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
              onClick={toggleSpeak}
            >
              {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}

        {!!message.reactions?.length && (
          <div className={cn("mt-1 flex gap-1", isUser && "justify-end")}>
            {message.reactions.map((r) => (
              <span key={r} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                {r}
              </span>
            ))}
          </div>
        )}

        {showActions && (
          <MessageActions className={cn("mt-1", isUser && "justify-end")}>
            <MessageAction label="Copy" tooltip="Copy">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(visibleChatText(message.text));
                  haptic("done");
                  setShowActions(false);
                }}
              >
                <Copy />
              </Button>
            </MessageAction>
            {!isUser && message.text.trim() && (
              <MessageAction
                label={speaking ? "Stop" : "Speak"}
                tooltip={speaking ? "Stop reading" : "Read aloud"}
              >
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    haptic("tap");
                    toggleSpeak();
                    setShowActions(false);
                  }}
                >
                  {speaking ? <VolumeX /> : <Volume2 />}
                </Button>
              </MessageAction>
            )}
            {onRetry && !isUser && (
              <MessageAction label="Retry" tooltip="Retry">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setShowActions(false);
                    onRetry();
                  }}
                >
                  <RotateCcw />
                </Button>
              </MessageAction>
            )}
            {REACTIONS.map((emoji) => (
              <Button
                key={emoji}
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  haptic("tap");
                  onReact?.(emoji);
                  setShowActions(false);
                }}
              >
                <span className="text-sm">{emoji}</span>
              </Button>
            ))}
          </MessageActions>
        )}
      </div>
    </Message>
  );
}
