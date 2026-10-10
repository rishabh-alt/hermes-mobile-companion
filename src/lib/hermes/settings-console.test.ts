import { describe, expect, it } from "vitest";
import {
  firstSessionMessagesPath,
  interpretProbe,
  searchSections,
  settingsSections,
} from "./settings-console";

describe("settingsSections", () => {
  it("keeps phone controls editable when the gateway refuses config writes", () => {
    const sections = settingsSections({ admin_config_rw: false, model_options: true });
    expect(sections.find((section) => section.id === "appearance")?.access).toBe("phone");
    expect(sections.find((section) => section.id === "safety")?.access).toBe("blocked");
    expect(sections.find((section) => section.id === "safety")?.reason).toBe(
      "Missing door: safety write",
    );
  });

  it("opens safety only when the typed settings door is advertised", () => {
    expect(settingsSections({ settings_admin: true }).find((section) => section.id === "safety")?.access).toBe(
      "write",
    );
    expect(settingsSections({ admin_config_rw: true }).find((section) => section.id === "safety")?.access).toBe(
      "blocked",
    );
  });

  it("opens model saves only through the separate admin door", () => {
    const model = settingsSections({ model_admin: true, admin_config_rw: false }).find(
      (section) => section.id === "model",
    );
    expect(model?.access).toBe("write");
    expect(
      settingsSections({ admin_config_rw: true }).find((section) => section.id === "safety")
        ?.access,
    ).toBe("blocked");
  });

  it("lets model be read from the advertised inventory without pretending the host default can be saved", () => {
    const model = settingsSections({ admin_config_rw: false, model_options: true }).find(
      (section) => section.id === "model",
    );
    expect(model?.access).toBe("read");
    expect(model?.reason).toMatch(/read/i);
  });

  it("does not include desktop chrome", () => {
    const ids = settingsSections({}).map((section) => section.id);
    expect(ids).not.toContain("keybinds");
    expect(ids).not.toContain("pet");
    expect(ids).toContain("workspace");
  });
});

describe("interpretProbe", () => {
  it("keeps auth, transport, and missing routes distinct", () => {
    expect(interpretProbe({ ok: true, status: 200 })).toBe("ok");
    expect(interpretProbe({ ok: false, status: 401 })).toBe("auth");
    expect(interpretProbe({ ok: false, status: 404 })).toBe("unsupported");
    expect(interpretProbe({ ok: false, transport: true })).toBe("transport");
    expect(interpretProbe({ ok: false, status: 500 })).toBe("failed");
  });
});

describe("firstSessionMessagesPath", () => {
  it("points at the first real session transcript and ignores an empty list", () => {
    expect(firstSessionMessagesPath({ data: [{ id: "sess_1" }] })).toBe(
      "/api/sessions/sess_1/messages",
    );
    expect(firstSessionMessagesPath({ data: [] })).toBeNull();
    expect(firstSessionMessagesPath({ sessions: [{ id: "abc/1" }] })).toBe(
      "/api/sessions/abc%2F1/messages",
    );
  });
});

describe("searchSections", () => {
  it("matches a section title without dropping the connection screen", () => {
    const sections = settingsSections({ admin_config_rw: false });
    const found = searchSections(sections, "memory");
    expect(found.map((section) => section.id)).toEqual(["memory"]);
  });
});
