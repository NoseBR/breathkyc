import { zkVerifyService } from '../services/zkVerifyService';
import { solanaService } from '../services/solanaService';
import { LivenessConfig, LivenessResult } from './types';

/**
 * BreathProof SDK - The bridge between Biometrics, ZK-Proofs, and Blockchain.
 */
export class BreathProofSDK {
  private config: LivenessConfig;

  constructor(config: LivenessConfig) {
    this.config = config;
    if (this.config.debug) {
      console.log('BreathProof SDK Initialized', config);
    }
  }

  /**
   * Orchestrates the liveness verification flow.
   * In a real SDK, this would analyze the MediaStream frames.
   */
  async verify(stream: MediaStream): Promise<LivenessResult> {
    try {
      if (!stream.active) throw new Error('MediaStream is inactive');

      // 1. Simulate Biometric Analysis (Analyzing breath/visuals from stream)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 2. Submit to zkVerify
      const zkResult = await zkVerifyService.submitProof({
        proof: "zk_biometric_proof_v1",
        publicSignals: ["liveness_confirmed"],
        protocol: 'groth16'
      });

      if (!zkResult.success) {
        return { success: false, score: 0, error: 'ZK Verification failed' };
      }

      return {
        success: true,
        score: 0.99,
        proof: "zk_biometric_proof_v1",
        attestationId: zkResult.attestationId
      };
    } catch (error) {
      return { 
        success: false, 
        score: 0, 
        error: error instanceof Error ? error.message : 'Unknown SDK error' 
      };
    }
  }

  /**
   * Registers a verified attestation on the Solana blockchain.
   */
  async register(attestationId: string, walletPublicKey: string): Promise<{ txHash: string }> {
    const result = await solanaService.registerHumanOnChain(walletPublicKey, attestationId);
    return { txHash: result.txHash };
  }
}

// Export a default factory function
export const initBreathProof = (config: LivenessConfig) => new BreathProofSDK(config);
