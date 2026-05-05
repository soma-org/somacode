import type { Component } from "solid-js"
import { FIXED_PROVIDER_ID } from "@/config/fixed-provider"
import { DialogConnectProvider } from "./dialog-connect-provider"

export const DialogSelectProvider: Component = () => <DialogConnectProvider provider={FIXED_PROVIDER_ID} />
