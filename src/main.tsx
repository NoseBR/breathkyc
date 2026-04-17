import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Buffer } from 'buffer';
import App from './App.tsx';
import './index.css';
import { SolanaProvider } from './components/SolanaProvider.tsx';

// Solana SDKs and some ZK libraries depend on Buffer being globally available
window.Buffer = Buffer;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaProvider>
      <App />
    </SolanaProvider>
  </StrictMode>,
);

