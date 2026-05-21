# Base Sepolia → Soma USDC deposit (with Base Account paymaster)

Bridge in USDC from Base Sepolia to Soma using a paymaster so the user pays zero ETH gas. Two calls (approve + deposit) sent atomically via `wallet_sendCalls`.

## Addresses (Base Sepolia)

- **SomaBridge proxy:** `0x5458a14d8a28CAff779f029FA3d60B8F9523C85b`
- **USDC:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle testnet)
- **Destination chain id (Soma):** `2`

## Flow on the Base side

- User connects with Base Account
- App builds two calls: `usdc.approve(SomaBridge, amount)` then `SomaBridge.deposit(2, somaRecipient, amount)`
- App sends both as one `wallet_sendCalls` user op, pointing `capabilities.paymasterService.url` at your paymaster proxy
- Paymaster sponsors the gas; Base Account submits the bundle
- `SomaBridge.deposit` pulls `amount` USDC from the user via `transferFrom` and routes it to the vault, then emits `TokensDeposited(nonce, sender, destChainId, somaRecipient, tokenType=3, amount, timestampMs)`
- Soma bridge nodes pick the event out of the receipt within ~30s, sign it, and the relayer submits a mint to `somaRecipient` on Soma

## Code

```ts
import { encodeFunctionData, numberToHex } from 'viem';
import { base } from 'wagmi/chains';

const SOMA_BRIDGE = '0x5458a14d8a28CAff779f029FA3d60B8F9523C85b';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const SOMA_CHAIN_ID = 2; // destination

// amount in 6-decimal USDC base units: 1.5 USDC -> 1_500_000n
const amount = 1_000_000n; // 1 USDC

// 32-byte Soma recipient as 0x-prefixed hex
const somaRecipient =
  '0x97861d9b81cbc56957f8ec61286a45d088c10e287076c6b966698b90ba259dd3';

const calls = [
  {
    to: USDC,
    value: '0x0',
    data: encodeFunctionData({
      abi: [{
        name: 'approve', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ type: 'address' }, { type: 'uint256' }],
        outputs: [{ type: 'bool' }],
      }],
      functionName: 'approve',
      args: [SOMA_BRIDGE, amount],
    }),
  },
  {
    to: SOMA_BRIDGE,
    value: '0x0',
    data: encodeFunctionData({
      abi: [{
        name: 'deposit', type: 'function', stateMutability: 'nonpayable',
        inputs: [
          { type: 'uint8', name: 'destinationChainID' },
          { type: 'bytes32', name: 'somaRecipient' },
          { type: 'uint64', name: 'amount' },
        ],
        outputs: [],
      }],
      functionName: 'deposit',
      args: [SOMA_CHAIN_ID, somaRecipient, amount],
    }),
  },
];

const result = await provider.request({
  method: 'wallet_sendCalls',
  params: [{
    version: '1.0',
    chainId: numberToHex(base.constants.CHAIN_IDS.baseSepolia),
    from: fromAddress,
    calls,
    capabilities: {
      paymasterService: {
        url: process.env.NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL!,
      },
    },
  }],
});
```

## Notes

- The two calls must be in one `wallet_sendCalls`. If you send them as separate user ops, the approve might land but the deposit could be front-run or fail in isolation.
- Allowlist `USDC.approve` and `SomaBridge.deposit` on your paymaster policy — anything else and the paymaster will reject the bundle.
- `somaRecipient` is a 32-byte Soma address. Pad/format as `bytes32` (no length-prefix). If the user gives you a shorter form, reject — silently zero-padding ends up sending to a wallet the user doesn't control.
- `amount` is `uint64` micros (6 decimals). `deposit` reverts on `amount == 0` and on a recipient of `bytes32(0)`.
- Soma-side credit lands in ~30s after the Base Sepolia tx finalizes. Verify with `soma balance <somaRecipient>` or watch `BridgeState.total_usdc_supply` go up via `soma bridge status`.
