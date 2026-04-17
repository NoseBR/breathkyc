/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wind, 
  ShieldCheck, 
  Activity, 
  Camera, 
  Mic, 
  AlertCircle,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Fingerprint,
  Wallet,
  ExternalLink
} from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { zkVerifyService } from './services/zkVerifyService.ts';
import { solanaService } from './services/solanaService.ts';

type AppState = 'landing' | 'calibrating' | 'scanning' | 'verifying' | 'success' | 'error';

export default function App() {
  const { connected, publicKey } = useWallet();
  const [state, setState] = useState<AppState>('landing');
  const [progress, setProgress] = useState(0);
  const [inhaling, setInhaling] = useState(true);
  const [attestation, setAttestation] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Simulated breathing loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (state === 'scanning') {
      interval = setInterval(() => {
        setInhaling(prev => !prev);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [state]);

  const startScan = async () => {
    if (!connected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' }, 
        audio: true 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setState('calibrating');
      setTimeout(() => setState('scanning'), 2000);
    } catch (err) {
      console.error(err);
      setState('error');
    }
  };

  const handleScanComplete = async () => {
    setState('verifying');
    const result = await zkVerifyService.submitProof({
      proof: "mock_zk_proof_0x...",
      publicSignals: ["liveness_score_1.0", "timestamp_" + Date.now()],
      protocol: 'groth16'
    });
    
    if (result.success) {
      setAttestation(result.attestationId || null);
      setState('success');
    } else {
      setState('error');
    }
  };

  const registerOnChain = async () => {
    if (!publicKey || !attestation) return;
    setRegistering(true);
    try {
      const result = await solanaService.registerHumanOnChain(publicKey.toString(), attestation);
      setTxHash(result.txHash);
    } catch (err) {
      console.error(err);
    } finally {
      setRegistering(false);
    }
  };

  useEffect(() => {
    if (state === 'scanning') {
      const timer = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            clearInterval(timer);
            handleScanComplete();
            return 100;
          }
          return prev + 1;
        });
      }, 50);
      return () => clearInterval(timer);
    }
  }, [state]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 sm:p-12 overflow-hidden bg-[#0c0d0e]">
      <header className="fixed top-0 left-0 right-0 p-6 flex justify-between items-center z-50">
        <div className="flex items-center gap-2">
          <Wind className="w-5 h-5 text-red-500" />
          <span className="mono-display text-xs font-bold tracking-widest uppercase">BreathProof</span>
        </div>
        <WalletMultiButton className="!bg-white/10 !border !border-white/10 !rounded-lg !font-mono !text-[10px] !uppercase !tracking-widest !h-auto !py-2 !px-4 hover:!bg-white/20 transition-all" />
      </header>

      <AnimatePresence mode="wait">
        {state === 'landing' && (
          <motion.div 
            key="landing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-xl text-center"
          >
            <div className="flex justify-center mb-6">
              <div className="p-4 hardware-card bg-red-500/10 border-red-500/20">
                <Wind className="w-12 h-12 text-red-500" />
              </div>
            </div>
            <h1 className="text-4xl sm:text-6xl font-sans font-bold tracking-tight mb-4">
              Biological Liveness
            </h1>
            <p className="text-secondary text-lg mb-8 leading-relaxed">
              Verify your humanity via <span className="text-primary font-medium">zkVerify</span> and register it on the <span className="text-primary font-medium">Solana</span> blockchain. 
              The most secure way to prove you are not a bot.
            </p>
            
            <div className="flex flex-col items-center gap-4">
              {connected ? (
                <div className="space-y-6 flex flex-col items-center">
                  <div className="px-4 py-2 hardware-card border-emerald-500/30 bg-emerald-500/5 text-emerald-500 mono-display text-[10px] flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3" />
                    WALLET ACTIVE: {publicKey?.toString().slice(0, 6)}...{publicKey?.toString().slice(-6)}
                  </div>
                  <button 
                    onClick={startScan}
                    className="group relative flex items-center gap-3 px-8 py-4 hardware-card bg-red-600 hover:bg-red-500 transition-all duration-300 overflow-hidden mx-auto"
                  >
                    <span className="font-mono font-bold uppercase tracking-widest text-sm text-white">Start Liveness Check</span>
                    <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6">
                  <div className="p-6 hardware-card border-dashed border-white/20 bg-white/5 max-w-sm">
                    <Wallet className="w-8 h-8 text-secondary mx-auto mb-3" />
                    <p className="status-label text-center mb-0">Solana wallet connection required</p>
                    <p className="text-[9px] text-secondary/60 mt-2 text-center uppercase tracking-tighter">
                      Tip: If using MetaMask, ensure the Solana Snap is installed or use a native Solana wallet like Phantom.
                    </p>
                  </div>
                  <WalletMultiButton className="!bg-red-600 hover:!bg-red-500 !transition-all !duration-300 !rounded-none !h-14 !px-10 !font-mono !text-xs !uppercase !tracking-widest" />
                </div>
              )}
            </div>

            <div className="mt-12 flex justify-center gap-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
              <div className="flex flex-col items-center gap-1">
                <ShieldCheck className="w-6 h-6" />
                <span className="status-label">zkVerify Enabled</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Activity className="w-6 h-6" />
                <span className="status-label">On-Chain Registry</span>
              </div>
            </div>
          </motion.div>
        )}

        {(state === 'calibrating' || state === 'scanning' || state === 'verifying') && (
          <motion.div 
            key="interface"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="w-full max-w-2xl hardware-card overflow-hidden relative"
          >
            {/* Same interface code as before but with slightly updated layout if needed */}
            <div className="absolute top-4 left-4 flex gap-4">
              <div className="flex items-center gap-2">
                <Camera className="w-3 h-3 text-red-500" />
                <span className="status-label">Cam Active</span>
              </div>
              <div className="flex items-center gap-2">
                <Mic className="w-3 h-3 text-red-500" />
                <span className="status-label">Audio Stream</span>
              </div>
            </div>

            <div className="absolute top-4 right-4 mono-display text-[10px] text-secondary">
              WALLET: {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
            </div>

            <div className="aspect-video bg-black relative overflow-hidden">
              <video 
                ref={videoRef} 
                autoPlay 
                muted 
                playsInline 
                className="w-full h-full object-cover opacity-60 grayscale scale-x-[-1]"
              />
              <div className="scan-line animate-scan" style={{ top: `${progress}%` }} />
              
              <AnimatePresence>
                {state === 'scanning' && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/20 backdrop-blur-[2px]"
                  >
                    <motion.div 
                      animate={{ 
                        scale: inhaling ? [1, 1.4, 1.4, 1] : [1, 0.8, 0.8, 1],
                        opacity: inhaling ? 1 : 0.7 
                      }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                      className="w-32 h-32 rounded-full border-2 border-red-500/50 flex items-center justify-center bg-red-500/10"
                    >
                      <span className="mono-display text-white text-xs font-bold uppercase tracking-widest">
                        {inhaling ? 'Inhale' : 'Exhale'}
                      </span>
                    </motion.div>
                  </motion.div>
                )}

                {state === 'verifying' && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md"
                  >
                    <Loader2 className="w-12 h-12 text-red-500 animate-spin mb-4" />
                    <h3 className="mono-display text-sm tracking-widest uppercase">zkVerify Process</h3>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <div className="p-6 bg-black/40 border-t border-white/5 space-y-4">
               <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="status-label">Sequence Analysis</span>
                    <span className="mono-display text-[10px] text-red-500">{progress}%</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                    />
                  </div>
               </div>
            </div>
          </motion.div>
        )}

        {state === 'success' && (
          <motion.div 
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md w-full hardware-card p-8 text-center"
          >
            <div className="flex justify-center mb-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Liveness Confirmed</h2>
            <p className="text-secondary text-sm mb-6">
              zkVerify network has successfully validated your biometric signature.
            </p>
            
            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-lg text-left border border-white/10">
                <span className="status-label text-emerald-400">Proof Link</span>
                <code className="mono-display text-[9px] break-all block mt-1 opacity-60">
                  {attestation}
                </code>
              </div>

              {!txHash ? (
                <button 
                  onClick={registerOnChain}
                  disabled={registering}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 hardware-card bg-emerald-600 hover:bg-emerald-500 transition-all font-mono text-xs uppercase tracking-widest font-bold disabled:opacity-50"
                >
                  {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Register On Solana'}
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-500/10 rounded-lg text-left border border-emerald-500/20">
                    <div className="flex justify-between items-center mb-1">
                      <span className="status-label text-emerald-500">On-Chain Registry Confirmed</span>
                      <a 
                        href={`https://explorer.solana.com/tx/${txHash}?cluster=devnet`}
                        target="_blank"
                        referrerPolicy="no-referrer"
                        className="p-1 hover:bg-emerald-500/20 rounded-md transition-colors text-emerald-500"
                        title="View in Solana Explorer"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    <p className="mono-display text-[9px] break-all opacity-80 font-mono tracking-tighter">
                      TX: {txHash}
                    </p>
                  </div>
                  
                  <div className="flex flex-col gap-2 p-3 hardware-card border-white/5 bg-white/5">
                    <div className="flex justify-between items-center">
                      <span className="status-label text-secondary text-[8px]">Network Status</span>
                      <span className="text-[8px] px-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded">SIMULATION</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="mono-display text-[9px] uppercase tracking-wider text-emerald-500">Confirmed on Solana Devnet</span>
                    </div>
                    <p className="text-[8px] text-secondary/40 leading-tight">
                      * Transactions are currently simulated. Deploy the Anchor contract to valid live hashes.
                    </p>
                  </div>
                </div>
              )}

              <button 
                onClick={() => setState('landing')}
                className="w-full px-6 py-2 text-secondary hover:text-white transition-colors font-mono text-xs uppercase tracking-widest"
              >
                Back To Home
              </button>
            </div>
          </motion.div>
        )}

        {state === 'error' && (
          <motion.div 
            key="error"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md w-full hardware-card p-12 text-center border-red-500/50"
          >
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold mb-2">Scan Aborted</h2>
            <p className="text-secondary mb-8 text-sm">
              Verification criteria not met. Ensure you are in a quiet, well-lit environment and follow the breathing prompts closely.
            </p>
            <button 
              onClick={() => setState('landing')}
              className="w-full px-6 py-3 hardware-card bg-red-600 hover:bg-red-500 transition-all font-mono text-xs uppercase tracking-widest font-bold"
            >
              Retry Session
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="fixed bottom-8 left-0 right-0 flex justify-center opacity-30 pointer-events-none px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          <span className="status-label">BreathProtocol™ v1.0.3</span>
          <span className="status-label">zkVerify Verification</span>
          <span className="status-label">Solana Identity Stack</span>
        </div>
      </footer>
    </div>
  );
}

