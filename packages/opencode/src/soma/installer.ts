import { SUP_INSTALLER_URL } from "../config/endpoints"

const SUP_INSTALLER = SUP_INSTALLER_URL

// Cross-platform PATH lookup. Bun.which handles Windows PATHEXT (.exe/.cmd/.bat)
// and POSIX semantics; the previous spawn of `which` only existed on POSIX.
const which = async (cmd: string): Promise<string | undefined> => {
  return Bun.which(cmd) ?? undefined
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

// Always install whatever sup considers latest. We used to gate on a
// PINNED_VERSION constant so somacode and the on-chain protocol moved
// together, but the chain enforces protocol-version semantics itself
// (advance_epoch refuses upgrades that aren't quorum-supported) so a
// somacode running an older binary just transparently uses an older
// in-proxy filter set. When we want strict lockstep again, reintroduce
// PINNED_VERSION and pass `soma@${PINNED_VERSION}` to `sup install`.
export const ensureSoma = async (): Promise<string> => {
  const existing = await which("soma")
  if (existing) return existing
  const sup = (await which("sup")) ?? (await (async () => {
    await installSup()
    return which("sup")
  })())
  if (!sup) throw new Error("sup binary not found after installer ran")
  await run([sup, "install", "soma"])
  const after = await which("soma")
  if (!after) throw new Error("soma binary not found after sup install")
  return after
}
