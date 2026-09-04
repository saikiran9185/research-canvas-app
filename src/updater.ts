import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { askConfirm } from "./dialogs";

// Checks GitHub Releases (via the endpoint in tauri.conf.json) for a newer,
// signature-verified version. Called once on launch. Silent if offline or no
// release exists yet.
export async function checkForUpdatesOnLaunch() {
  try {
    const update = await check();
    if (!update) return;
    // window.confirm is a no-op in the webview, so use the app's own dialog.
    const ok = await askConfirm(`Research Canvas ${update.version} is available`, {
      message: (update.body ? `${update.body}\n\n` : "") +
        "Download and install it now? The app will restart.",
      okLabel: "Update",
    });
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    // No releases yet, offline, or dev build — safe to ignore.
    console.log("Update check skipped:", e);
  }
}
