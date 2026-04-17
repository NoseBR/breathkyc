/**
 * BreathProof SDK Types
 */

export type LivenessConfig = {
  solanaRpcUrl: string;
  zkVerifyNodeUrl: string;
  debug?: boolean;
};

export type LivenessResult = {
  success: boolean;
  score: number;
  proof?: string;
  attestationId?: string;
  txHash?: string;
  error?: string;
};

export interface IBreathProofSDK {
  verify(stream: MediaStream): Promise<LivenessResult>;
  register(attestationId: string, walletPublicKey: string): Promise<{ txHash: string }>;
}
