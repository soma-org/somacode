// Default network endpoints. Runtimes that read env (opencode CLI via process.env,
// web app via import.meta.env) wrap these as fallbacks. Update here when the
// testnet/mainnet split changes so both CLI and web stay in sync.

export const DEFAULT_SOMA_GRAPHQL_URL = "https://graphql.testnet.soma.org/graphql"
export const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org"
export const DEFAULT_ONRAMP_BASE_URL = "http://95.217.102.55:3010"
export const DEFAULT_PAYMENT_GATEWAY_URL = "http://localhost:8000"
export const DEFAULT_SUP_INSTALLER_URL = "https://sup.soma.org"
