/**
 * Self-hosted OTA update checker for Kira app.
 *
 * On launch, checks Supabase for a newer version.
 * If found, downloads the APK and prompts to install.
 * No expo-updates dependency — just Supabase Storage + a version table.
 */

import { Alert, Linking } from "react-native";

// Semantic version — bump this on each release
export const CURRENT_VERSION = "1.10.3";

const BACKEND_URL = "https://kira-backend-six.vercel.app";

function isNewer(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, "").split(".").map(Number);
  const l = local.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

export async function checkForAppUpdate(silent: boolean = true): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/kira/app-version`);
    if (!res.ok) {
      if (!silent) Alert.alert("Update check failed", `Server returned ${res.status}`);
      return;
    }

    const data = await res.json();
    if (!data.version || !isNewer(data.version, CURRENT_VERSION)) {
      if (!silent) Alert.alert("Up to date", `v${CURRENT_VERSION}`);
      return;
    }

    if (!data.url) {
      if (!silent) Alert.alert("Update available", `${data.version} — connect USB to install`);
      return;
    }

    Alert.alert(
      `Update: ${data.version}`,
      data.notes || "A new version of Kira is available.",
      [
        { text: "Later", style: "cancel" },
        {
          text: "Download",
          onPress: () => Linking.openURL(data.url),
        },
      ]
    );
  } catch (e: any) {
    if (!silent) Alert.alert("Update check failed", e?.message || "Network error");
    console.log("[Updater] Check failed:", e);
  }
}
