import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android shell for the Hermes companion.
 *
 * The app talks straight from the phone to the Hermes gateway on your Mac
 * (Tailscale address or Cloudflare Tunnel URL), which you set inside the app
 * under Settings — nothing is hardcoded here.
 *
 * The complete interface is bundled into the APK. Only the Hermes gateway
 * remains on the Mac and is configured by the user inside the app.
 */
const config: CapacitorConfig = {
  appId: "app.hermes.companion",
  appName: "Hermes",
  webDir: "dist",
  android: {
    backgroundColor: "#141414",
  },
};

export default config;
