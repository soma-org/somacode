import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import type { OpenAICompatibleChatModelInput } from "../protocols/openai-compatible-chat"

export const id = ProviderID.make("soma")

const FALLBACK_BASE_URL = "http://127.0.0.1:11434/v1"

let runtimeBaseURL: string | undefined

export const setBaseURL = (url: string | undefined) => {
  runtimeBaseURL = url
}

export type ModelOptions = Omit<OpenAICompatibleChatModelInput, "id" | "provider" | "baseURL"> & {
  readonly baseURL?: string
}

export const routes = [OpenAICompatibleChat.route]

export const model = (id: string | ModelID, options: ModelOptions = {}) =>
  OpenAICompatibleChat.model({
    ...options,
    id,
    provider: ProviderID.make("soma"),
    baseURL: options.baseURL ?? runtimeBaseURL ?? FALLBACK_BASE_URL,
  })

export const provider = Provider.make({
  id,
  model,
})
