#!/usr/bin/env bun
// Headless multi-provider test: bring up the soma runtime (wallet + proxy +
// trusted-server) and curl chat completions through it for several models.
// Usage: cd packages/opencode && bun run script/soma-multi-provider-test.ts

import * as SomaRuntime from "../src/soma/runtime"

const MODELS = [
  "google/gemma-4-31b-it",
  "meta-llama/llama-4-scout",
  "qwen/qwen3.6-flash",
  "deepseek/deepseek-v4-flash",
  "mistralai/mistral-small-2603",
  "anthropic/claude-haiku-4.5",
]

const run = async () => {
  console.log("== booting soma runtime ==")
  const b = await SomaRuntime.init()
  console.log(`address=${b.address} baseURL=${b.baseURL}`)
  // Give the trusted-server one extra refresh cycle so the filter is warm.
  await Bun.sleep(2000)
  let pass = 0
  let fail = 0
  for (const model of MODELS) {
    const t0 = Date.now()
    try {
      const r = await fetch(`${b.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with exactly: PROVIDER_OK" }],
          max_tokens: 20,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      const body = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: unknown }
      const reply = body.choices?.[0]?.message?.content ?? null
      const dt = Date.now() - t0
      if (reply) {
        console.log(`PASS ${model}  reply=${JSON.stringify(reply)}  ${dt}ms`)
        pass++
      } else {
        console.log(`FAIL ${model}  ${dt}ms  err=${JSON.stringify(body.error ?? body)}`)
        fail++
      }
    } catch (e) {
      console.log(`FAIL ${model}  exception=${(e as Error).message}`)
      fail++
    }
  }
  console.log(`\n== summary: ${pass}/${pass + fail} passed ==`)
  await SomaRuntime.shutdown()
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error("fatal:", e)
  process.exit(2)
})
