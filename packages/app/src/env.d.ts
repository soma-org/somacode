interface ImportMetaEnv {
  readonly VITE_SOMACODE_SERVER_HOST: string
  readonly VITE_SOMACODE_SERVER_PORT: string
  readonly VITE_SOMACODE_CHANNEL?: "dev" | "beta" | "prod"

  /** Buy USDC: `POST` this URL with `Authorization: Bearer` using {@link ImportMetaEnv.VITE_STRIPE_TEST_KEY}. */
  readonly VITE_USDC_CHECKOUT_URL?: string

  /** Stripe secret key (`sk_test_…` / `sk_live_…`) for `Authorization: Bearer` on `VITE_USDC_CHECKOUT_URL`. */
  readonly VITE_STRIPE_TEST_KEY?: string

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
