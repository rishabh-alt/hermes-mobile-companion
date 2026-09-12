import { Camera, Cpu, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { MessageBubble } from "@/components/hermes/message-list";
import { ModelSheet } from "@/components/hermes/model-sheet";
import { AttachmentAddButton, AttachmentPreviews } from "@/components/hermes/attachment-bar";
import hermesMark from "@/assets/hermes-mark.png";
import { Button } from "@/components/ui/button";
import { fetchModels, HermesError, streamChat } from "@/lib/hermes/client";
import { useHermesConfig } from "@/lib/hermes/config";
import { haptic } from "@/lib/hermes/haptics";
import { setMessages, updateSession, useSession } from "@/lib/hermes/sessions";
import { pullSession } from "@/lib/hermes/session-sync";
import { isMissing } from "@/lib/hermes/rest";
import { normalizePromptEvent } from "@/lib/hermes/rpc";
import { useHermesRpc } from "@/lib/hermes/useRpc";
import { createClientId } from "@/lib/hermes/ids";
import type { Attachment, HermesMessage, ToolCall } from "@/lib/hermes/types";
import { AppShell } from "@/components/hermes/app-shell";
import { Link } from "@tanstack/react-router";

type Status = "idle" | "submitted" | "streaming" | "error";

const newId = () => createClientId();

async function toAttachment(file: {
  url: string;
  filename?: string;
  mediaType?: string;
}): Promise<Attachment> {
  const blob = await fetch(file.url).then((r) => r.blob());
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    id: newId(),
    name: file.filename ?? "attachment",
    mediaType: file.mediaType || blob.type || "application/octet-stream",
    url: dataUrl,
  };
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const { config, configured, update } = useHermesConfig();
  const { session } = useSession(sessionId);
  const [status, setStatus] = useState<Status>("idle");
  const [live, setLive] = useState<HermesMessage | null>(null);
  const [modelSheet, setModelSheet] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const { rpc: rpcRef, state: rpcState } = useHermesRpc(config, configured && config.wsEnabled);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  const activeModel = session?.model || config.model;
  const messages = useMemo(() => session?.messages ?? [], [session]);

  useEffect(() => {
    if (!configured || activeModel) return;
    let cancelled = false;
    fetchModels(config)
      .then((models) => {
        const first = models[0]?.id;
        if (!cancelled && first) {
          updateSession(sessionId, { model: first });
          update({ model: first });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeModel, config, configured, sessionId, update]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, [sessionId]);

  // A conversation tapped under "On your Mac" has no local copy yet — pull it.
  useEffect(() => {
    if (!configured) return;
    if (session && session.messages.length > 0) return;
    let cancelled = false;
    setPulling(true);
    setPullError(null);
    pullSession(config, sessionId)
      .catch((err: unknown) => {
        if (cancelled || isMissing(err)) return;
        setPullError((err as Error)?.message ?? "Couldn't reach your Mac.");
      })
      .finally(() => {
        if (!cancelled) setPulling(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, configured, config.baseUrl, config.token]);

  const run = useCallback(
    async (history: HermesMessage[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("submitted");

      const assistant: HermesMessage = {
        id: newId(),
        role: "assistant",
        text: "",
        createdAt: Date.now(),
        model: activeModel,
      };
      setLive(assistant);

      let text = "";
      let reasoning = "";
      let tools: ToolCall[] = [];
      const push = () => {
        setStatus("streaming");
        setLive({
          ...assistant,
          text,
          reasoning: reasoning || undefined,
          tools: tools.length ? tools : undefined,
        });
      };

      /** Live gateway transport — the same one Hermes Desktop speaks. */
      const viaGateway = (model: string) =>
        new Promise<void>((resolve, reject) => {
          const rpc = rpcRef.current;
          if (!rpc || rpc.state !== "open") {
            reject(new Error("gateway-stream-unavailable"));
            return;
          }
          const prompt = history[history.length - 1];
          let settled = false;
          let grace: ReturnType<typeof setTimeout> | null = null;
          let off = () => {};

          const finish = (err?: Error) => {
            if (settled) return;
            settled = true;
            if (grace) clearTimeout(grace);
            off();
            if (err) reject(err);
            else resolve();
          };

          off = rpc.onEvent((raw) => {
            const event = normalizePromptEvent(raw, sessionId);
            if (!event) return;
            if (grace) {
              clearTimeout(grace);
              grace = null;
            }
            switch (event.kind) {
              case "text":
                text += event.delta;
                push();
                break;
              case "reasoning":
                reasoning += event.delta;
                push();
                break;
              case "tool": {
                const existing = tools.find((t) => t.id === event.id);
                const next: ToolCall = {
                  id: event.id,
                  name: event.name,
                  input: event.input ?? existing?.input,
                  rawInput: JSON.stringify(event.input ?? existing?.input ?? {}),
                  output: event.output ?? existing?.output,
                  errorText: event.error ?? existing?.errorText,
                  state: event.error
                    ? "output-error"
                    : event.done
                      ? "output-available"
                      : "input-available",
                };
                tools = existing
                  ? tools.map((t) => (t.id === next.id ? next : t))
                  : [...tools, next];
                push();
                break;
              }
              case "error":
                finish(new Error(event.message));
                break;
              case "done":
                finish();
                break;
              case "status":
                push();
                break;
            }
          });

          controller.signal.addEventListener("abort", () => {
            void rpc.interrupt(sessionId).catch(() => undefined);
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            finish(abortError);
          });

          rpc
            .submitPrompt({
              session_id: sessionId,
              text: prompt?.text ?? "",
              ...(model ? { model } : {}),
              ...(prompt?.attachments?.length ? { attachments: prompt.attachments } : {}),
            })
            .then(() => {
              // Some gateways close the turn without a final event.
              grace = setTimeout(() => finish(), 1200);
            })
            .catch((err: Error) => finish(err));
        });

      const attempt = (model: string) =>
        streamChat({
          config,
          model,
          messages: history,
          signal: controller.signal,
          handlers: {
            onText: (delta) => {
              text += delta;
              push();
            },
            onReasoning: (delta) => {
              reasoning += delta;
              push();
            },
            onTools: (next) => {
              tools = next;
              push();
            },
          },
        });

      const start = async (model: string) => {
        if (!config.wsEnabled) return attempt(model);
        try {
          await viaGateway(model);
        } catch (err) {
          const e = err as Error;
          const unsupported =
            /gateway-stream-unavailable|not connected|Method not found|Unknown method|timed out/i.test(
              e?.message ?? "",
            );
          if (!unsupported || controller.signal.aborted || e?.name === "AbortError") throw err;
          text = "";
          reasoning = "";
          tools = [];
          await attempt(model);
        }
      };

      try {
        try {
          await start(activeModel);
        } catch (err) {
          const canFallback =
            config.fallbackModel &&
            config.fallbackModel !== activeModel &&
            !controller.signal.aborted &&
            (err as Error)?.name !== "AbortError";
          if (!canFallback) throw err;
          text = "";
          reasoning = "";
          tools = [];
          await attempt(config.fallbackModel);
        }
        const finished: HermesMessage = {
          ...assistant,
          text,
          reasoning: reasoning || undefined,
          tools: tools.length ? tools : undefined,
        };
        setMessages(sessionId, [...history, finished]);
        setStatus("idle");
        haptic("done");
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        const finished: HermesMessage = {
          ...assistant,
          text,
          reasoning: reasoning || undefined,
          tools: tools.length ? tools : undefined,
          error: aborted
            ? undefined
            : err instanceof HermesError
              ? err.message
              : ((err as Error)?.message ?? "Something went wrong"),
        };
        setMessages(sessionId, [...history, finished]);
        setStatus(aborted ? "idle" : "error");
        if (!aborted) haptic("error");
      } finally {
        setLive(null);
        abortRef.current = null;
      }
    },
    [activeModel, config, sessionId],
  );

  const send = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text && !message.files.length) return;
    if (!configured) return;
    haptic("send");

    const attachments = await Promise.all(
      message.files.map((f) =>
        toAttachment(f as { url: string; filename?: string; mediaType?: string }),
      ),
    );
    const user: HermesMessage = {
      id: newId(),
      role: "user",
      text,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now(),
    };
    const history = [...messages, user];
    setMessages(sessionId, history);
    void run(history);
  };

  const retry = () => {
    const trimmed = [...messages];
    while (trimmed.length && trimmed[trimmed.length - 1]!.role === "assistant") trimmed.pop();
    if (!trimmed.length) return;
    setMessages(sessionId, trimmed);
    void run(trimmed);
  };

  const react = (id: string, emoji: string) => {
    setMessages(
      sessionId,
      messages.map((m) =>
        m.id === id
          ? {
              ...m,
              reactions: m.reactions?.includes(emoji)
                ? m.reactions.filter((r) => r !== emoji)
                : [...(m.reactions ?? []), emoji],
            }
          : m,
      ),
    );
  };

  const busy = status === "submitted" || status === "streaming";
  const shown = live ? [...messages, live] : messages;

  return (
    <AppShell
      activeSessionId={sessionId}
      title={session?.title ?? "New chat"}
      subtitle={
        <span className="flex items-center gap-1.5">
          {rpcState === "open" && <Radio className="h-3 w-3 text-primary" />}
          {activeModel || "no model selected"}
        </span>
      }
      right={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Model and route"
          onClick={() => setModelSheet(true)}
        >
          <Cpu />
        </Button>
      }
    >
      <div className="flex h-full flex-col">
        {!configured && (
          <div className="mx-3 mt-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm">
            <p className="font-medium">Hermes isn't connected yet.</p>
            <p className="mt-1 text-muted-foreground">
              Add your gateway address and token so this app can talk to your Mac.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/settings">Open settings</Link>
            </Button>
          </div>
        )}

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-4 px-3 py-4">
            {shown.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                <img
                  src={hermesMark}
                  alt="Hermes"
                  width={512}
                  height={512}
                  className="h-16 w-16 object-contain opacity-90"
                />
                <p className="text-base font-medium">Hermes is listening</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Ask anything, run a tool, or send a photo from your phone straight to the agent on
                  your Mac.
                </p>
              </div>
            ) : (
              shown.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  live={live?.id === message.id}
                  onRetry={live?.id === message.id ? undefined : retry}
                  onReact={(emoji) => react(message.id, emoji)}
                />
              ))
            )}
            {pulling && messages.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">Loading this conversation…</p>
            )}
            {pullError && <p className="px-1 text-sm text-destructive">{pullError}</p>}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="safe-bottom border-t border-border/70 bg-background/90 px-3 pt-3 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-3xl">
            <PromptInput
              onSubmit={send}
              accept="image/*,application/pdf,audio/*,text/*"
              multiple
              maxFileSize={20 * 1024 * 1024}
              className="rounded-2xl"
            >
              <PromptInputTextarea
                autoFocus
                placeholder={configured ? "Message Hermes…" : "Connect Hermes to start"}
                disabled={!configured}
              />
              <AttachmentPreviews />
              <PromptInputFooter className="justify-between">
                <div className="flex items-center gap-1">
                  <PromptInputButton
                    aria-label="Take a photo"
                    onClick={() => cameraRef.current?.click()}
                  >
                    <Camera />
                  </PromptInputButton>
                  <AttachmentAddButton />
                  <PromptInputButton aria-label="Model" onClick={() => setModelSheet(true)}>
                    <Cpu />
                    <span className="max-w-24 truncate text-[11px]">
                      {activeModel ? activeModel.split("/").pop() : "Select model"}
                    </span>
                  </PromptInputButton>
                </div>
                <PromptInputSubmit
                  {...(busy
                    ? ({ status: "streaming" } as const)
                    : status === "error"
                      ? ({ status: "error" } as const)
                      : {})}
                  disabled={!configured}
                  onStop={() => {
                    haptic("error");
                    abortRef.current?.abort();
                  }}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const attachment = await toAttachment({
            url: URL.createObjectURL(file),
            filename: file.name,
            mediaType: file.type,
          });
          const user: HermesMessage = {
            id: newId(),
            role: "user",
            text: "",
            attachments: [attachment],
            createdAt: Date.now(),
          };
          const history = [...messages, user];
          setMessages(sessionId, history);
          void run(history);
        }}
      />

      <ModelSheet
        open={modelSheet}
        onOpenChange={setModelSheet}
        config={config}
        active={activeModel}
        fallback={config.fallbackModel}
        onSelect={(model) => {
          updateSession(sessionId, { model });
          update({ model });
        }}
        onSelectFallback={(model) => update({ fallbackModel: model })}
        onUpdateConfig={(patch) => update(patch)}
      />
    </AppShell>
  );
}
