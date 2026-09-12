import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android shell for the Hermes companion.
 *
 * The app talks straight from the phone to the Hermes gateway on your Mac
 * (Tailscale address or Cloudflare Tunnel URL), which you set inside the app
 * under Settings — nothing is hardcoded here.
 *
 * The app is served by the local Mac dev server during Phase 1. Set
 * CAP_SERVER_URL to the Mac's Tailscale URL before `npx cap sync android`.
 */
const config: CapacitorConfig = {
  appId: "app.hermes.companion",
  appName: "Hermes",
  webDir: "dist/client",
  android: {
    backgroundColor: "#141414",
    // The gateway may be plain http:// over Tailscale.
    allowMixedContent: true,
  },
  ...(process.env.CAP_SERVER_URL
    ? {
        server: {
          url: process.env.CAP_SERVER_URL,
          cleartext: process.env.CAP_SERVER_URL.startsWith("http://"),
          androidScheme: process.env.CAP_SERVER_URL.startsWith("https://") ? "https" : "http",
        },
      }
    : {}),
};

export default config;
