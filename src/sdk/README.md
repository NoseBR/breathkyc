# BreathProof SDK 🌬️

A lightweight SDK to integrate biometric liveness verification with ZK-Proofs and Solana.

## Installation

```bash
npm install @breathproof/sdk
```

## Usage

### 1. Initialize the SDK

```typescript
import { initBreathProof } from '@breathproof/sdk';

const sdk = initBreathProof({
  solanaRpcUrl: 'https://api.devnet.solana.com',
  zkVerifyNodeUrl: 'https://rpc.zkverify.network',
  debug: true
});
```

### 2. Verify Liveness from a MediaStream

```typescript
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
const result = await sdk.verify(stream);

if (result.success) {
  console.log('Attestation ID:', result.attestationId);
}
```

### 3. Register on Solana

```typescript
if (result.attestationId) {
  const { txHash } = await sdk.register(result.attestationId, userPublicKey);
  console.log('Transaction Confirmed:', txHash);
}
```

## Features

- **Privacy Built-in**: No biometric data leaves the client.
- **ZK-Proof Powered**: Submits proofs to zkVerify for decentralized validity.
- **On-Chain Identity**: Direct integration with Solana PDAs for human registries.
