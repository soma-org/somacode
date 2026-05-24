import {
  DEFAULT_BASE_SEPOLIA_RPC_URL,
  DEFAULT_ONRAMP_BASE_URL,
  DEFAULT_PAYMENT_GATEWAY_URL,
  DEFAULT_SOMA_GRAPHQL_URL,
  DEFAULT_SUP_INSTALLER_URL,
} from "@opencode-ai/core/config/endpoints"

const env = (key: string): string | undefined => process.env[key]?.trim() || undefined

// Soma GraphQL endpoint used by the soma proxy/indexer/trusted-server (off-chain
// reads inside the inference runtime).
export const SOMA_INDEXER_GRAPHQL_URL = env("SOMACODE_INDEXER_GRAPHQL_URL") ?? DEFAULT_SOMA_GRAPHQL_URL

// Soma GraphQL endpoint used by the TUI balance/spent fetcher (mock/legacy
// path kept around as a fallback when the soma runtime isn't reachable).
export const SOMA_BALANCE_GRAPHQL_URL = env("SOMACODE_BALANCE_GRAPHQL_URL") ?? DEFAULT_SOMA_GRAPHQL_URL

// Soma GraphQL endpoint used by the model picker fallback list.
export const SOMA_MODELS_GRAPHQL_URL = env("SOMACODE_MODELS_GRAPHQL_URL") ?? DEFAULT_SOMA_GRAPHQL_URL

// Base Sepolia RPC. Used for nonce/gas reads when building bridge user ops.
export const BASE_SEPOLIA_RPC_URL = env("BASE_SEPOLIA_RPC_URL") ?? DEFAULT_BASE_SEPOLIA_RPC_URL

// Onramp event stream backend (SSE) that the TUI subscribes to.
export const ONRAMP_BASE_URL = env("SOMACODE_ONRAMP_BASE_URL") ?? DEFAULT_ONRAMP_BASE_URL

// Backend paymaster proxy. The somacode backend forwards JSON-RPC paymaster
// requests to CDP after JWT auth, so somacode never needs a direct CDP URL.
// See `runOnrampCheckout` → /api/auth/register → intent_token (used as bearer).
export const BACKEND_PAYMASTER_URL = `${ONRAMP_BASE_URL}/api/paymaster`

// Paymaster endpoint used by the bridge. Defaults to the backend proxy above;
// override with a direct CDP URL when debugging without involving the backend.
export const BASE_PAYMASTER_URL = env("BASE_PAYMASTER_URL") ?? BACKEND_PAYMASTER_URL

// Bundler endpoint. CDP serves bundler + paymaster from the same URL, so
// default to BASE_PAYMASTER_URL. Override only if your bundler is split.
export const BASE_BUNDLER_URL = env("BASE_BUNDLER_URL") ?? BASE_PAYMASTER_URL

// Payment gateway URL hit by the buy-usdc dialog. VITE_-prefixed name is kept
// because the same value is consumed by the web app via import.meta.env;
// SOMACODE_PAYMENT_GATEWAY_URL is the CLI-side override.
export const PAYMENT_GATEWAY_URL =
  env("VITE_SOMACODE_PAYMENT_GATEWAY_URL") ?? env("SOMACODE_PAYMENT_GATEWAY_URL") ?? DEFAULT_PAYMENT_GATEWAY_URL

// `sup` installer endpoint used to bootstrap the soma binary on first run.
export const SUP_INSTALLER_URL = env("SUP_INSTALLER_URL") ?? DEFAULT_SUP_INSTALLER_URL
