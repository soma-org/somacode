import os from "os"
import path from "path"

export const PINNED_VERSION = "0.1.30"

export const INDEXER_URL = "https://graphql.testnet.soma.org/graphql"

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".soma", "soma_config")
const SOMACODE_CONFIG_DIR = path.join(os.homedir(), ".somacode", "soma", "soma_config")
const SOMACODE_HOME = path.join(os.homedir(), ".somacode", "soma")
const DEFAULT_HOME = path.join(os.homedir(), ".soma")

const exists = (filepath: string) => Bun.file(filepath).exists()

export const resolveConfigDir = async () => {
  if (await exists(path.join(DEFAULT_CONFIG_DIR, "client.yaml"))) return DEFAULT_CONFIG_DIR
  return SOMACODE_CONFIG_DIR
}

export const resolveHome = async () => {
  if (await exists(path.join(DEFAULT_CONFIG_DIR, "client.yaml"))) return DEFAULT_HOME
  return SOMACODE_HOME
}

export const WALLET_ALIAS = "somacode-default"

export const FUNDING_THRESHOLD_MICROS = 1_000_000n
export const LOW_BALANCE_MICROS = 5_000_000n

export const AUTO_TOPUP_AMOUNT_USDC = "5"
