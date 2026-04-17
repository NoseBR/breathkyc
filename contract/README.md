# BreathProof: On-Chain Registry (Anchor)

This directory contains the Solana smart contract for the BreathProof project, built using the Anchor Framework.

## Program: `proof_registry`

The contract is responsible for maintaining a decentralized registry of verified humans. It associates a Solana public key with a unique attestation ID provided by the **zkVerify** network.

### Key Instructions:

- `verify_human(attestation_id, timestamp)`: 
  - Validates that the signer is a trusted verifier (or the user with a valid proof).
  - Creates or updates a Program Derived Address (PDA) storing the user's verified status.
  - Emits a `HumanVerified` event.

### Deployment (Instructional):

To deploy this contract to Solana Devnet, ensure you have the Anchor CLI installed:

1. **Initialize Anchor** (if not already):
   ```bash
   anchor init .
   ```

2. **Update Project ID**:
   Generate a new keypair for the program and update the `declare_id!` in `proof_registry.rs`.

3. **Build**:
   ```bash
   anchor build
   ```

4. **Deploy**:
   ```bash
   anchor deploy --provider.cluster devnet
   ```

### State Structure:

The registry uses PDAs derived from the user's public key to ensure 1-to-1 mapping:
`["human_registry", user_pubkey]`
