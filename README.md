# BreathProof: ZK-Humanity

BreathProof is a cutting-edge, decentralized biometric liveness verification application. It allows users to prove their biological humanity through a non-invasive, tri-modal breathing task, generating a Zero-Knowledge Proof (ZKP) that is validated on the **zkVerify** network and registered on the **Solana** blockchain.

## 🚀 Key Features

- **Biometric Liveness**: Uses computer vision and audio analysis to detect respiratory patterns (inhale/exhale), ensuring the user is a living human being in real-time.
- **Privacy First**: Sensitive biometric data is processed locally. Only the resulting ZK-proof is submitted to the network, ensuring zero data leakage.
- **zkVerify Integration**: Leverages the zkVerify protocol for decentralized validation of liveness proofs.
- **Solana On-Chain Registry**: Records the "Verified Human" status permanently on the Solana blockchain using a custom Anchor-based smart contract.
- **Wallet Compatibility**: Supports major Solana wallets (Phantom, Solflare) via the Solana Wallet Adapter.

## 🛠 Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Motion (for hardware-style animations).
- **ZK Protocol**: zkVerify (Simulation Layer).
- **Blockchain**: Solana (Devnet), Anchor Framework.
- **Biometrics**: WebRTC (Camera/Microphone) for real-time capture.

## 📁 Project Structure

```text
├── contract/              # Anchor/Solana Smart Contract (Rust)
│   └── programs/
│       └── proof_registry/src/lib.rs
├── src/
│   ├── components/        # React components (UI & Providers)
│   ├── services/          # Business logic (zkVerify, Solana, local biometrics)
│   ├── lib/              # Utility functions and polyfills
│   └── App.tsx           # Main application logic and state machine
├── index.html            # Entry point with global environment fixes
└── vite.config.ts        # Vite configuration with module aliasing
```

## ⚙️ Setup and Installation

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd breathproof
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Connect Wallet**: Ensure you have a Solana wallet (like Phantom) set to **Devnet**.

## 🔐 Security & Polyfills

This project includes advanced browser polyfills to ensure compatibility with Solana and ZK-crypto libraries in sandboxed environments:
- **Global `fetch` protection**: Prevents polyfill crashes in iframe environments.
- **Buffer Polyfill**: Global `Buffer` support for Solana SDK.
- **Process/Global Polyfills**: Standard environment variables support.

## 📝 License

This project is licensed under the Apache-2.0 License.
