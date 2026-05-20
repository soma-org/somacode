import { spawn } from "node:child_process"
import type { CliRenderer } from "@opentui/core"
import open from "open"
import { win32SetConsoleTitle } from "../win32"

const DEFAULT_TITLE = "Soma Code"

function openBrowser(url: string): Promise<void> {
  if (process.platform !== "win32") {
    return open(url)
  }

  // The `open` package spawns PowerShell attached to this console, which resets the
  // window title to "Windows PowerShell" and breaks UTF-8 / box-drawing rendering.
  return new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

export async function openUrl(
  renderer: CliRenderer,
  url: string,
  options?: { title?: string },
): Promise<void> {
  const title = options?.title?.trim() || DEFAULT_TITLE
  await openBrowser(url).catch(() => {})
  if (process.platform !== "win32") return
  win32SetConsoleTitle(title)
  renderer.setTerminalTitle(title)
}

export * as OpenUrl from "./open-url"
