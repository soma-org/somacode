interface ImportMetaEnv {
  readonly VITE_SOMACODE_SERVER_HOST: string
  readonly VITE_SOMACODE_SERVER_PORT: string
  readonly VITE_SOMACODE_CHANNEL?: "dev" | "beta" | "prod"

  /** Stripe Checkout (or billing) URL opened when the user taps “Add USDC” in the balance dialog */
  readonly VITE_USDC_CHECKOUT_URL?: string

  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
