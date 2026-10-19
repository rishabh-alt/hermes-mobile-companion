export interface PromptTemplate {
  id: string;
  title: string;
  category: "Headless PC" | "Logs & Health" | "Code & Git" | "Custom";
  prompt: string;
  custom?: boolean | undefined;
}

const CUSTOM_TEMPLATES_KEY = "hermes.prompt_templates.v1";

export const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "builtin_host_health",
    title: "Headless PC health & disk report",
    category: "Headless PC",
    prompt:
      "Check the system health of this host: CPU load, RAM usage, disk free space across mounted drives, uptime, and top 5 memory-consuming processes.",
  },
  {
    id: "builtin_docker_services",
    title: "Audit Docker containers & systemd services",
    category: "Headless PC",
    prompt:
      "List running and exited Docker containers and key systemd services on this machine, highlighting any unhealthy or recently restarted services.",
  },
  {
    id: "builtin_ports_network",
    title: "Inspect open ports & network listeners",
    category: "Headless PC",
    prompt:
      "Show all listening TCP/UDP ports on this host, the process bound to each port, and Tailscale / local LAN IP addresses.",
  },
  {
    id: "builtin_gateway_logs",
    title: "Summarize recent gateway & system errors",
    category: "Logs & Health",
    prompt:
      "Inspect the recent Hermes gateway logs and system journal for any warnings, errors, or failed background jobs in the last 24 hours and summarize the root causes.",
  },
  {
    id: "builtin_cleanup_disk",
    title: "Find safe disk space cleanup targets",
    category: "Logs & Health",
    prompt:
      "Scan common cache, log, and build directories (Docker dangling images, npm/pip caches, old logs) and report how much disk space can be safely reclaimed before deleting anything.",
  },
  {
    id: "builtin_git_status",
    title: "Active Git repo status & uncommitted diff",
    category: "Code & Git",
    prompt:
      "Check the current workspace Git status, recent commits, current branch, and summarize any uncommitted changes or untracked files.",
  },
  {
    id: "builtin_run_tests",
    title: "Run test suite & diagnose failures",
    category: "Code & Git",
    prompt:
      "Run the project's test suite and linter, and if anything fails, pinpoint the failing test and propose a minimal fix.",
  },
];

export function readCustomPromptTemplates(): PromptTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is PromptTemplate =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as PromptTemplate).id === "string" &&
          typeof (item as PromptTemplate).title === "string" &&
          typeof (item as PromptTemplate).prompt === "string",
      )
      .map((item) => ({
        ...item,
        category: "Custom",
        custom: true,
      }));
  } catch {
    return [];
  }
}

export function writeCustomPromptTemplates(templates: PromptTemplate[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    // Ignore quota errors
  }
}

export function addCustomPromptTemplate(title: string, prompt: string): PromptTemplate[] {
  const cleanTitle = title.trim();
  const cleanPrompt = prompt.trim();
  if (!cleanTitle || !cleanPrompt) return readCustomPromptTemplates();
  const existing = readCustomPromptTemplates();
  const next: PromptTemplate = {
    id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    category: "Custom",
    prompt: cleanPrompt,
    custom: true,
  };
  const updated = [next, ...existing];
  writeCustomPromptTemplates(updated);
  return updated;
}

export function removeCustomPromptTemplate(id: string): PromptTemplate[] {
  const updated = readCustomPromptTemplates().filter((item) => item.id !== id);
  writeCustomPromptTemplates(updated);
  return updated;
}

export function getAllPromptTemplates(): PromptTemplate[] {
  return [...readCustomPromptTemplates(), ...BUILTIN_PROMPT_TEMPLATES];
}
