import { PINNED_VERSION } from "./config"
import { SUP_INSTALLER_URL } from "../config/endpoints"

const SUP_INSTALLER = SUP_INSTALLER_URL

const which = async (cmd: string): Promise<string | undefined> => {
  const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "ignore" })
  if ((await proc.exited) !== 0) return undefined
  return (await new Response(proc.stdout).text()).trim() || undefined
}

const run = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd[0]} exited with code ${code}`)
}

const installSup = async () => {
  const installer = await fetch(SUP_INSTALLER).then((r) => r.text())
  const tmp = `/tmp/sup-install-${Date.now()}.sh`
  await Bun.write(tmp, installer)
  await run(["sh", tmp])
}

const installedVersion = async (binary: string) => {
  const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
  if ((await proc.exited) !== 0) return undefined
  return (await new Response(proc.stdout).text()).trim()
}

export const ensureSoma = async (): Promise<string> => {
  const existing = await which("soma")
  if (existing) {
    const ver = await installedVersion(existing)
    if (ver?.includes(PINNED_VERSION)) return existing
    if (ver) return existing
  }
  const sup = (await which("sup")) ?? (await (async () => {
    await installSup()
    return which("sup")
  })())
  if (!sup) throw new Error("sup binary not found after installer ran")
  await run([sup, "install", `soma@${PINNED_VERSION}`])
  const after = await which("soma")
  if (!after) throw new Error("soma binary not found after sup install")
  return after
}
