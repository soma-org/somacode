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

// Coinbase Developer Platform paymaster URL (sponsors bridge gas). No default —
// the bridge fails fast with "missing_paymaster_url" when this is unset.
export const BASE_PAYMASTER_URL = env("BASE_PAYMASTER_URL")

// Bundler endpoint. CDP serves bundler + paymaster from the same URL, so
// default to BASE_PAYMASTER_URL.
export const BASE_BUNDLER_URL = env("BASE_BUNDLER_URL") ?? BASE_PAYMASTER_URL

// Onramp event stream backend (SSE) that the TUI subscribes to.
export const ONRAMP_BASE_URL = env("SOMACODE_ONRAMP_BASE_URL") ?? DEFAULT_ONRAMP_BASE_URL

// Payment gateway URL hit by the buy-usdc dialog. VITE_-prefixed name is kept
// because the same value is consumed by the web app via import.meta.env;
// SOMACODE_PAYMENT_GATEWAY_URL is the CLI-side override.
export const PAYMENT_GATEWAY_URL =
  env("VITE_SOMACODE_PAYMENT_GATEWAY_URL") ?? env("SOMACODE_PAYMENT_GATEWAY_URL") ?? DEFAULT_PAYMENT_GATEWAY_URL

// `sup` installer endpoint used to bootstrap the soma binary on first run.
export const SUP_INSTALLER_URL = env("SUP_INSTALLER_URL") ?? DEFAULT_SUP_INSTALLER_URL
