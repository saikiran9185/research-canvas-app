import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Checks GitHub Releases (via the endpoint in tauri.conf.json) for a newer,
// signature-verified version. Called once on launch. Silent if offline or no
// release exists yet.
export async function checkForUpdatesOnLaunch() {
  try {
    const update = await check();
    if (!update) return;
    const ok = window.confirm(
      `Research Canvas ${update.version} is available` +
        (update.body ? `:\n\n${update.body}` : ".") +
        `\n\nDownload and install it now? The app will restart.`
    );
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    // No releases yet, offline, or dev build — safe to ignore.
    console.log("Update check skipped:", e);
  }
}
