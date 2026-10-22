import { Cpu, Download, Mic, MicOff, Radio, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { PromptTemplateSheet } from "@/components/hermes/prompt-template-sheet";
import {
  AttachmentAddButton,
  AttachmentCameraButton,
  AttachmentPreviews,
} from "@/components/hermes/attachment-bar";
import hermesMark from "@/assets/hermes-mark.png";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { playCompletionChime } from "@/lib/hermes/chime";
import { HermesError } from "@/lib/hermes/client";
import { useHermesConfig } from "@/lib/hermes/config";
import { clearSessionDraft, getSessionDraft, setSessionDraft } from "@/lib/hermes/drafts";
import {
  downloadTextFile,
  formatSessionJson,
  formatSessionMarkdown,
  messageMatchesQuery,
  safeExportFilename,
} from "@/lib/hermes/export";
import { haptic } from "@/lib/hermes/haptics";
import { setMessages, updateSession, useSession } from "@/lib/hermes/sessions";
import { mergePulledMessages, pullSession } from "@/lib/hermes/session-sync";
import { sessionLabel } from "@/lib/hermes/session-title";
import { respondToApproval, type ApprovalRequest } from "@/lib/hermes/approval";
import { followHostWatch } from "@/lib/hermes/watch";
import { fetchActiveSessionPrompts, fetchModelOptions, isMissing } from "@/lib/hermes/rest";
import { lockSessionRuntime, streamGatewaySession } from "@/lib/hermes/session-api";
import { answerClarify, type ClarifyRequest } from "@/lib/hermes/clarify";
import { steerRun, stopRun, transcriptText } from "@/lib/hermes/steer";
import { normalizePromptEvent } from "@/lib/hermes/rpc";
import { createRunGuard, profileRunBoundary } from "@/lib/hermes/run-guard";
import { useHermesRpc } from "@/lib/hermes/useRpc";
import { createClientId } from "@/lib/hermes/ids";
import {
  formatDateDivider,
  formatTimeGap,
  injectGapContextIntoText,
  shouldShowDateDivider,
} from "@/lib/hermes/timestamps";
import type { Attachment, HermesMessage, ReasoningLevel, ToolCall } from "@/lib/hermes/types";
import { importGatewaySession } from "@/lib/hermes/sessions";
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

function isTextLikeAttachment(attachment: Attachment): boolean {
  const mime = attachment.mediaType.toLowerCase();
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/typescript" ||
    mime === "application/xml" ||
    mime === "application/x-yaml"
  ) {
    return true;
  }
  return /\.(txt|md|markdown|json|csv|tsv|ts|tsx|js|jsx|py|sh|yaml|yml|toml|html|css|sql|log|xml)$/i.test(
    attachment.name,
  );
}

function decodeAttachmentText(attachment: Attachment): string | null {
  if (!isTextLikeAttachment(attachment)) return null;
  const comma = attachment.url.indexOf(",");
  if (!attachment.url.startsWith("data:") || comma < 0) return null;
  const header = attachment.url.slice(5, comma);
  const body = attachment.url.slice(comma + 1);
  try {
    if (header.includes(";base64")) {
      const binary = atob(body);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return decoded.slice(0, 64_000);
    }
    return decodeURIComponent(body).slice(0, 64_000);
  } catch {
    return null;
  }
}

function decodePdfSnippet(attachment: Attachment): string | null {
  const isPdf =
    attachment.mediaType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(attachment.name);
  if (!isPdf) return null;
  const comma = attachment.url.indexOf(",");
  if (!attachment.url.startsWith("data:") || comma < 0) return null;
  try {
    const binary = atob(attachment.url.slice(comma + 1));
    const matches = binary.match(/\(([^()\\]{3,160})\)/g) ?? [];
    const extracted = matches
      .map((token) =>
        token
          .slice(1, -1)
          .replace(/[^\x20-\x7E]/g, " ")
          .trim(),
      )
      .filter((line) => /[A-Za-z]{2,}/.test(line))
      .join(" ")
      .slice(0, 32_000);
    return extracted || `PDF document (${Math.round(binary.length / 1024)} KB)`;
  } catch {
    return null;
  }
}

export function toSessionContent(message: HermesMessage) {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return message.text;
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];
  if (message.text.trim()) content.push({ type: "text", text: message.text });
  for (const attachment of attachments) {
    if (attachment.mediaType.startsWith("image/")) {
      content.push({ type: "image_url", image_url: { url: attachment.url } });
    } else {
      const textContent = decodeAttachmentText(attachment);
      const pdfSnippet = textContent === null ? decodePdfSnippet(attachment) : null;
      if (textContent !== null && textContent.trim()) {
        content.push({
          type: "text",
          text: `<file name="${attachment.name}" type="${attachment.mediaType}">\n${textContent}\n</file>`,
        });
      } else if (pdfSnippet !== null) {
        content.push({
          type: "text",
          text: `<document name="${attachment.name}" type="application/pdf">\n${pdfSnippet}\n</document>`,
        });
      } else {
        content.push({
          type: "text",
          text: `[attached file: ${attachment.name} (${attachment.mediaType})]`,
        });
      }
    }
  }
  return content;
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const { config, configured, update } = useHermesConfig();
  const { session } = useSession(sessionId);
  const [status, setStatus] = useState<Status>("idle");
  const [live, setLive] = useState<HermesMessage | null>(null);
  const [modelSheet, setModelSheet] = useState(false);
  const [templateSheet, setTemplateSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMatchesOnly, setFilterMatchesOnly] = useState(false);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const { rpc: rpcRef, state: rpcState } = useHermesRpc(config, false);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const [steerNote, setSteerNote] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const submitGeneration = useRef(0);
  const pullGeneration = useRef(0);

  const activeProvider = session?.provider || config.provider;
  const activeModel = session?.model || config.model;
  const messages = useMemo(() => session?.messages ?? [], [session]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!configured || (activeModel && activeProvider)) return;
    let cancelled = false;
    void fetchModelOptions(config)
      .then(async (options) => {
        if (!options.activeProvider || !options.activeModel || cancelled) return;
        const runtime = await lockSessionRuntime(config, sessionId, {
          provider: options.activeProvider,
          model: options.activeModel,
        });
        if (!cancelled && runtime.locked) {
          updateSession(sessionId, { provider: runtime.provider, model: runtime.model });
          update({ provider: runtime.provider, model: runtime.model });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeModel, activeProvider, config, configured, sessionId, update]);

  const pullRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      // Invalidate both asynchronous lanes before a different session can render.
      // A late stream completion or transcript pull must never overwrite it.
      submitGeneration.current += 1;
      pullGeneration.current += 1;
      abortRef.current?.abort();
      pullRef.current?.();
    };
  }, [sessionId, config.activeProfile, config.profilePathPrefix]);

  // A conversation tapped under "On your Mac" has no local copy yet — pull it.
  useEffect(() => {
    if (!configured) return;
    if (session && session.messages.length > 0) return;
    let cancelled = false;
    const profileRun = profileRunBoundary.start();
    const generation = pullGeneration.current;
    setPulling(true);
    setPullError(null);
    setLive(null);
    pullRef.current = () => {
      cancelled = true;
    };
    pullSession(config, sessionId, profileRun.signal)
      .then((messages) => {
        if (cancelled || generation !== pullGeneration.current || !profileRun.isCurrent()) return;
        importGatewaySession(
          sessionId,
          sessionLabel({
            ...(session?.title ? { title: session.title } : {}),
            messages,
          }),
          messages,
        );
        setPulling(false);
      })
      .catch((err: unknown) => {
        if (cancelled || generation !== pullGeneration.current || !profileRun.isCurrent()) return;
        if (isMissing(err)) {
          setPullError("This session no longer exists on Hermes.");
          return;
        }
        setPullError((err as Error)?.message ?? "Couldn't reach your Mac.");
      })
      .finally(() => {
        if (!cancelled && generation === pullGeneration.current && profileRun.isCurrent()) {
          setPulling(false);
        }
        profileRun.release();
      });
    return () => {
      cancelled = true;
      profileRun.abort();
      profileRun.release();
      pullRef.current = null;
    };
  }, [configured, config, sessionId, session?.title]);

  // Restore active approval or clarify prompts only when the host confirms they are still pending.
  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    void fetchActiveSessionPrompts(config, sessionId, controller.signal).then((active) => {
      if (controller.signal.aborted) return;
      if (active.approval) setApproval(active.approval);
      if (active.clarify) setClarify(active.clarify);
    });
    return () => controller.abort();
  }, [configured, config, sessionId]);

  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    const generation = pullGeneration.current;
    const profileRun = profileRunBoundary.start();
    void followHostWatch(
      config,
      `/api/sessions/${encodeURIComponent(sessionId)}/watch`,
      (frame) => {
        if (frame.event !== "message.added") return;
        if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
        if (generation !== pullGeneration.current || !profileRun.isCurrent()) return;
        void pullSession(config, sessionId, profileRun.signal)
          .then((messages) => {
            if (generation !== pullGeneration.current || !profileRun.isCurrent()) return;
            const shown = mergePulledMessages(messagesRef.current, messages);
            importGatewaySession(
              sessionId,
              sessionLabel({
                ...(session?.title ? { title: session.title } : {}),
                messages: shown,
              }),
              shown,
            );
          })
          .catch(() => undefined);
      },
      controller.signal,
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof HermesError && err.status === 404) {
        setWatchNote(
          "This gateway is not pushing live updates. Checking the Mac every few seconds.",
        );
      }
    });
    return () => {
      controller.abort();
      profileRun.abort();
      profileRun.release();
    };
  }, [configured, config, sessionId, session?.title]);

  useEffect(() => {
    if (!configured) return;
    const pullNow = () => {
      if (document.hidden) return;
      if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
      void pullSession(config, sessionId)
        .then((messages) => {
          const shown = mergePulledMessages(messagesRef.current, messages);
          importGatewaySession(
            sessionId,
            sessionLabel({
              ...(session?.title ? { title: session.title } : {}),
              messages: shown,
            }),
            shown,
          );
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") pullNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(pullNow, 8000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [configured, config, sessionId, session?.title]);

  const run = useCallback(
    async (history: HermesMessage[]) => {
      const profileRun = profileRunBoundary.start();
      abortRef.current = profileRun;
      setStatus("submitted");
      submitGeneration.current += 1;
      const currentGeneration = submitGeneration.current;

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
      const isCurrentRun = createRunGuard(
        currentGeneration,
        () => submitGeneration.current,
        profileRun.signal,
      );
      const isCurrentProfileRun = () => isCurrentRun() && profileRun.isCurrent();
      const push = () => {
        if (!isCurrentProfileRun()) return;
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

          profileRun.signal.addEventListener("abort", () => {
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

      let completedModel = activeModel;
      const attempt = (model: string) => {
        const prompt = history[history.length - 1];
        const prevMessage = history.length >= 2 ? history[history.length - 2] : undefined;
        const promptWithGap: HermesMessage | undefined = prompt
          ? {
              ...prompt,
              text: injectGapContextIntoText(
                prompt.text,
                prevMessage?.createdAt,
                prompt.createdAt,
                config.injectGapContext !== false,
              ),
            }
          : undefined;
        return streamGatewaySession({
          config,
          sessionId,
          message: promptWithGap ? toSessionContent(promptWithGap) : "",
          provider: activeProvider,
          model,
          signal: profileRun.signal,
          handlers: {
            onText: (delta) => {
              text += delta;
              push();
            },
            onReasoning: (delta) => {
              if (config.showReasoning === false) return;
              reasoning += delta;
              push();
            },
            onTool: (tool) => {
              const existing = tools.find((item) => item.id === tool.id);
              tools = existing
                ? tools.map((item) => (item.id === tool.id ? tool : item))
                : [...tools, tool];
              push();
            },
            onCompleted: (event) => {
              if (event.content && !text) text = event.content;
              const ran = event.runtime?.model;
              if (ran) completedModel = ran;
              if (ran && model && ran !== model) {
                setWatchNote(
                  `This turn ran ${ran}, not ${model}. The Mac did not take that switch.`,
                );
              }
              push();
            },
            onError: (message) => {
              throw new HermesError(message);
            },
            onApproval: (request) => {
              setApproval(request);
              if (
                document.hidden &&
                "Notification" in window &&
                Notification.permission === "granted" &&
                config.notificationPrefs?.approvals !== false
              ) {
                new Notification("Hermes needs approval", { body: request.command });
              }
            },
            onClarify: (request) => {
              setClarify(request);
              if (
                document.hidden &&
                "Notification" in window &&
                Notification.permission === "granted" &&
                config.notificationPrefs?.approvals !== false
              ) {
                new Notification("Hermes has a question", { body: request.question });
              }
            },
            onRun: (id) => {
              runIdRef.current = id;
              setRunId(id);
            },
          },
        });
      };

      const start = async (model: string) => attempt(model);
      try {
        await start(activeModel);
        if (!isCurrentProfileRun()) return;
        const completedAssistant: HermesMessage = {
          ...assistant,
          text,
          reasoning: reasoning || undefined,
          tools: tools.length ? tools : undefined,
          model: completedModel || activeModel,
        };
        const committed =
          text.trim() || tools.length || reasoning.trim()
            ? [...history, completedAssistant]
            : history;
        messagesRef.current = committed;
        setMessages(sessionId, committed);
        const canonical = mergePulledMessages(
          committed,
          await pullSession(config, sessionId, profileRun.signal),
        );
        if (!isCurrentProfileRun()) return;
        importGatewaySession(
          sessionId,
          session?.title ?? "New chat",
          canonical,
          completedModel || activeModel,
          activeProvider,
        );
        setStatus("idle");
        setRunId(null);
        runIdRef.current = null;
        haptic("done");
        playCompletionChime();
        if (
          document.hidden &&
          "Notification" in window &&
          config.notificationPrefs?.turnComplete !== false
        ) {
          if (Notification.permission === "granted") {
            new Notification("Hermes finished", { body: "A turn on your phone is done." });
          } else if (Notification.permission === "default") {
            void Notification.requestPermission();
          }
        }
      } catch (err) {
        if (!isCurrentProfileRun()) return;
        const aborted = (err as Error)?.name === "AbortError";
        if (aborted) {
          setStatus("idle");
          return;
        }
        try {
          const recovered = mergePulledMessages(
            history,
            await pullSession(config, sessionId, profileRun.signal),
          );
          if (!isCurrentProfileRun()) return;
          const last = recovered[recovered.length - 1];
          if (last?.role === "assistant" && last.text.trim()) {
            importGatewaySession(
              sessionId,
              session?.title ?? "New chat",
              recovered,
              activeModel,
              activeProvider,
            );
            setLive(null);
            setStatus("idle");
            return;
          }
        } catch {
          // The next poll will try again.
        }
        setWatchNote("The phone dropped the stream. Waiting for the Mac to finish this turn.");
        setStatus("idle");
      } finally {
        if (isCurrentProfileRun()) {
          setLive(null);
          if (abortRef.current === profileRun) abortRef.current = null;
        }
        profileRun.release();
      }
    },
    [activeModel, activeProvider, config, rpcRef, session?.title, sessionId],
  );

  const send = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text && !message.files.length) return;
    const busy = status === "submitted" || status === "streaming";
    if (!configured || pulling || pullError || busy) return;
    if (!activeModel || !activeProvider) {
      setModelSheet(true);
      return;
    }
    clearSessionDraft(config.activeProfile, sessionId);
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
    pullGeneration.current += 1;
    setMessages(sessionId, history);
    void run(history);
  };

  useEffect(() => {
    if (status !== "idle" || !queued) return;
    const next = queued;
    setQueued(null);
    void send({ text: next, files: [] });
  }, [queued, status, send]);

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
  const activeQuery = searchOpen ? searchQuery.trim() : "";
  const matchedIds = useMemo(() => {
    if (!activeQuery) return new Set<string>();
    return new Set(shown.filter((m) => messageMatchesQuery(m, activeQuery)).map((m) => m.id));
  }, [activeQuery, shown]);
  const visibleMessages = useMemo(() => {
    if (!activeQuery || !filterMatchesOnly) return shown;
    return shown.filter((m) => matchedIds.has(m.id));
  }, [activeQuery, filterMatchesOnly, matchedIds, shown]);

  const insertIntoComposer = useCallback(
    (promptText: string) => {
      setSessionDraft(config.activeProfile, sessionId, promptText);
      const textarea = document.querySelector(
        'textarea[name="message"]',
      ) as HTMLTextAreaElement | null;
      if (!textarea) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (setter) {
        setter.call(textarea, promptText);
      } else {
        textarea.value = promptText;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    },
    [config.activeProfile, sessionId],
  );

  const exportMeta = {
    sessionId,
    title: session?.title ?? "New chat",
    profile: config.activeProfile,
    model: activeModel,
    provider: activeProvider,
  };

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
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Search in session"
            onClick={() => {
              haptic("tap");
              setSearchOpen((v) => !v);
            }}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(transcriptText(shown));
              haptic("done");
            }}
          >
            Copy
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Export session">
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  const md = formatSessionMarkdown(shown, exportMeta);
                  downloadTextFile(
                    safeExportFilename(session?.title, "md"),
                    md,
                    "text/markdown;charset=utf-8",
                  );
                  haptic("done");
                }}
              >
                Export Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const json = formatSessionJson(shown, exportMeta);
                  downloadTextFile(
                    safeExportFilename(session?.title, "json"),
                    json,
                    "application/json;charset=utf-8",
                  );
                  haptic("done");
                }}
              >
                Export JSON (.json)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Model and route"
            onClick={() => setModelSheet(true)}
          >
            <Cpu />
          </Button>
        </div>
      }
    >
      <div className="flex h-full flex-col">
        {searchOpen && (
          <div className="border-b border-border/70 bg-secondary/35 px-3 py-2">
            <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search messages, tools, or thoughts…"
                  className="h-8 pl-8 text-xs"
                  autoFocus
                />
              </div>
              {activeQuery && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {matchedIds.size} {matchedIds.size === 1 ? "match" : "matches"}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant={filterMatchesOnly ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() => setFilterMatchesOnly((v) => !v)}
              >
                Filter
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Close session search"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setFilterMatchesOnly(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

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
              <div className="flex flex-col items-center justify-center gap-4 px-4 py-12 text-center">
                <img
                  src={hermesMark}
                  alt="Hermes"
                  width={512}
                  height={512}
                  className="h-14 w-14 object-contain opacity-90"
                />
                <div className="space-y-1">
                  <p className="text-base font-medium">Hermes is listening</p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Ask anything, run a tool, or send a photo from your phone straight to the agent
                    on your Mac.
                  </p>
                </div>
                <div className="w-full max-w-md space-y-3 rounded-2xl border border-border/70 bg-secondary/30 p-3.5 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Profile &amp; route
                      </p>
                      <p className="truncate text-xs font-medium">
                        {config.activeProfile} · {activeModel || "No model selected"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/bots">Profiles</Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setModelSheet(true)}
                      >
                        Model
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Reasoning effort
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(["off", "low", "medium", "high"] as ReasoningLevel[]).map((level) => (
                        <Button
                          key={level}
                          type="button"
                          size="sm"
                          variant={config.reasoning === level ? "default" : "outline"}
                          className="capitalize"
                          onClick={() => update({ reasoning: level })}
                        >
                          {level}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <div>
                      <p className="text-xs font-medium">Fast mode</p>
                      <p className="text-[11px] text-muted-foreground">
                        Prefer lower-latency responses on this session.
                      </p>
                    </div>
                    <Switch
                      checked={config.fastMode}
                      onCheckedChange={(fastMode) => update({ fastMode })}
                    />
                  </div>
                  <div className="border-t border-border/60 pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5 text-xs"
                      onClick={() => setTemplateSheet(true)}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Host prompt templates
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              visibleMessages.map((message, idx) => {
                const prev = idx > 0 ? visibleMessages[idx - 1] : undefined;
                const showDivider = shouldShowDateDivider(prev?.createdAt, message.createdAt);
                const gapText = formatTimeGap(prev?.createdAt, message.createdAt);
                return (
                  <div key={message.id} className="space-y-3">
                    {(showDivider || gapText) && (
                      <div className="my-1 flex items-center justify-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                        {showDivider && (
                          <span className="font-medium text-foreground/80">
                            {formatDateDivider(message.createdAt)}
                          </span>
                        )}
                        {showDivider && gapText && <span aria-hidden="true">·</span>}
                        {gapText && <span className="font-mono text-[10px]">{gapText}</span>}
                      </div>
                    )}
                    <MessageBubble
                      message={message}
                      live={live?.id === message.id}
                      highlighted={Boolean(activeQuery) && matchedIds.has(message.id)}
                      onRetry={live?.id === message.id ? undefined : retry}
                      onReact={(emoji) => react(message.id, emoji)}
                    />
                  </div>
                );
              })
            )}
            {pulling && messages.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">Loading this conversation…</p>
            )}
            {pullError && <p className="px-1 text-sm text-destructive">{pullError}</p>}
            {watchNote && <p className="px-1 text-xs text-muted-foreground">{watchNote}</p>}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="safe-bottom border-t border-border/70 bg-background/90 px-3 pt-3 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-3xl">
            {busy && (
              <form
                className="mb-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = steerText.trim();
                  if (!text) return;
                  if (runId) {
                    void steerRun(config, runId, text)
                      .then(() => {
                        setSteerText("");
                        setSteerNote("Sent into this turn.");
                      })
                      .catch(() => setSteerNote("The host did not take that steer."));
                    return;
                  }
                  setQueued(text);
                  setSteerText("");
                  setSteerNote("Queued. It sends when this turn ends.");
                }}
              >
                <input
                  value={steerText}
                  onChange={(event) => setSteerText(event.target.value)}
                  placeholder={runId ? "Steer this turn" : "Queue for after this turn"}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
                />
                <Button type="submit" size="sm" variant="outline">
                  {runId ? "Steer" : "Queue"}
                </Button>
              </form>
            )}
            {steerNote && <p className="mb-2 text-xs text-muted-foreground">{steerNote}</p>}
            {clarify && (
              <div className="mb-3 space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-sm font-medium">Hermes needs an answer</p>
                <p className="text-sm">{clarify.question}</p>
                <div className="flex flex-wrap gap-2">
                  {(clarify.choices.length > 0 ? clarify.choices : ["yes", "no"]).map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      size="sm"
                      onClick={() => {
                        void answerClarify(config, clarify.id, choice).then(() => setClarify(null));
                      }}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {approval && (
              <div className="mb-3 space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-sm font-medium">Hermes wants to run this</p>
                <pre className="overflow-x-auto text-xs">{approval.command}</pre>
                <div className="flex flex-wrap gap-2">
                  {approval.choices.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      size="sm"
                      variant={choice === "deny" ? "outline" : "default"}
                      onClick={() => {
                        void respondToApproval(config, {
                          runId: approval.runId,
                          choice,
                          ...(approval.requestId ? { requestId: approval.requestId } : {}),
                        })
                          .then(() => setApproval(null))
                          .catch((err: unknown) => {
                            setWatchNote(
                              err instanceof HermesError
                                ? err.message
                                : "The host refused that choice.",
                            );
                          });
                      }}
                    >
                      {choice === "once"
                        ? "Once"
                        : choice === "session"
                          ? "This session"
                          : choice === "always"
                            ? "Always"
                            : "Deny"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <PromptInput
              onSubmit={send}
              accept="image/*,application/pdf,audio/*,text/*"
              multiple
              maxFileSize={20 * 1024 * 1024}
              className="rounded-2xl"
            >
              <PromptInputTextarea
                key={`${config.activeProfile}:${sessionId}`}
                defaultValue={getSessionDraft(config.activeProfile, sessionId)}
                onChange={(event) =>
                  setSessionDraft(config.activeProfile, sessionId, event.currentTarget.value)
                }
                autoFocus
                placeholder={configured ? "Message Hermes…" : "Connect Hermes to start"}
                disabled={!configured || Boolean(pullError)}
              />
              <AttachmentPreviews />
              <PromptInputFooter className="justify-between">
                <div className="flex items-center gap-1">
                  <AttachmentCameraButton />
                  <AttachmentAddButton />
                  <VoiceDictationButton disabled={!configured || Boolean(pullError)} />
                  <PromptInputButton
                    aria-label="Prompt templates"
                    onClick={() => setTemplateSheet(true)}
                  >
                    <Sparkles />
                  </PromptInputButton>
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
                  disabled={!configured || Boolean(pullError)}
                  onStop={() => {
                    haptic("error");
                    const id = runIdRef.current;
                    if (id) void stopRun(config, id).catch(() => undefined);
                    abortRef.current?.abort();
                  }}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>

      <PromptTemplateSheet
        open={templateSheet}
        onOpenChange={setTemplateSheet}
        onInsert={insertIntoComposer}
        onSendNow={
          configured && !pullError && !busy
            ? (promptText) => {
                void send({ text: promptText, files: [] });
              }
            : undefined
        }
      />

      <ModelSheet
        open={modelSheet}
        onOpenChange={setModelSheet}
        config={config}
        active={activeModel}
        activeProvider={activeProvider}
        onSelect={async ({ provider, model }) => {
          const runtime = await lockSessionRuntime(config, sessionId, { provider, model });
          if (!runtime.locked || runtime.model !== model || runtime.provider !== provider) {
            throw new Error(
              `The Mac kept ${runtime.model || "the current model"}. It did not switch to ${model}.`,
            );
          }
          updateSession(sessionId, { provider: runtime.provider, model: runtime.model });
        }}
        onUpdateConfig={(patch) => update(patch)}
      />
    </AppShell>
  );
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function VoiceDictationButton({ disabled }: { disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const toggleVoice = (event: React.MouseEvent<HTMLButtonElement>) => {
    haptic("tap");
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechCtor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SpeechCtor) {
      toast.error("Voice dictation is not supported in this browser.");
      return;
    }
    const form = event.currentTarget.closest("form");
    const textarea = form?.querySelector('textarea[name="message"]') as HTMLTextAreaElement | null;

    const recognition = new SpeechCtor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (resEvent) => {
      const transcript = Array.from(resEvent.results)
        .map((group) => group[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript && textarea) {
        const prefix = textarea.value.trim() ? `${textarea.value.trim()} ` : "";
        const nextValue = `${prefix}${transcript}`;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (setter) {
          setter.call(textarea, nextValue);
        } else {
          textarea.value = nextValue;
        }
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
      }
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <PromptInputButton
      aria-label={listening ? "Stop voice input" : "Voice input"}
      disabled={disabled}
      onClick={toggleVoice}
      className={listening ? "text-primary" : undefined}
    >
      {listening ? <MicOff /> : <Mic />}
    </PromptInputButton>
  );
}
