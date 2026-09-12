import { Brain, Copy, Paperclip, RotateCcw, Terminal } from "lucide-react";
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
import { haptic } from "@/lib/hermes/haptics";
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

function ToolBlock({ call }: { call: ToolCall }) {
  const isTerminal = /^(bash|shell|terminal|run|exec)/i.test(call.name);
  const output =
    call.output === undefined
      ? undefined
      : typeof call.output === "string"
        ? call.output
        : JSON.stringify(call.output, null, 2);
  return (
    <Tool className="mb-2 border-border/70 bg-secondary/40" defaultOpen={false}>
      <ToolHeader
        type={`tool-${call.name}` as `tool-${string}`}
        state={call.state}
        title={call.name}
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
  );
}

function Attachments({ message }: { message: HermesMessage }) {
  if (!message.attachments?.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {message.attachments.map((a) =>
        a.mediaType.startsWith("image/") ? (
          <img
            key={a.id}
            src={a.url}
            alt={a.name}
            loading="lazy"
            className="max-h-48 rounded-xl border border-border/70 object-cover"
          />
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
  );
}

interface Props {
  message: HermesMessage;
  live?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  onReact?: ((emoji: string) => void) | undefined;
}

export function MessageBubble({ message, live, onRetry, onReact }: Props) {
  const [showActions, setShowActions] = useState(false);
  const isUser = message.role === "user";

  return (
    <Message from={isUser ? "user" : "assistant"} className="[&>div]:max-w-[92%]">
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
            <ToolBlock key={call.id} call={call} />
          ))}
          {message.text ? (
            isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
            ) : (
              <MessageResponse>{message.text}</MessageResponse>
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
                  navigator.clipboard?.writeText(message.text);
                  haptic("done");
                  setShowActions(false);
                }}
              >
                <Copy />
              </Button>
            </MessageAction>
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
