import type { FC, PropsWithChildren } from 'react';
import { useEffect } from 'react';
import { BrowserProvider } from 'ethers';
import type { Provider, Eip1193Provider } from 'ethers';

import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
  ConnectButton,
} from '@rainbow-me/rainbowkit';

import { WagmiProvider, useAccount, useAccountEffect, http } from 'wagmi';
import { mainnet, sepolia, baseSepolia, base } from 'wagmi/chains';
import { CHAIN_ID, RPC_URL } from '@/lib/contract';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@rainbow-me/rainbowkit/styles.css';

/* ---- Svelte stores & helpers ------------------------------------ */
import { walletAddress, username, userProvider } from '@stores/auth.svelte';
import { walletReady } from '@stores/web3.svelte';

/* ------------------------------------------------------------------ */
/* 1.  Global wagmi / RainbowKit config (must not re‑create on render) */
/* ------------------------------------------------------------------ */
const chainMap = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
  [base.id]: base,
} as const;
const activeChain = chainMap[CHAIN_ID as keyof typeof chainMap] ?? baseSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: 'Degenerous DAO',
  appIcon: 'https://media.degenerousdao.com/assets/logo.png',
  projectId: '0b8a3fac6220753a719b9aeceb8f19fb',
  chains: [activeChain],
  transports: { [activeChain.id]: http(RPC_URL) },
  ssr: false,
});

const queryClient = new QueryClient();

type RainbowProps = {
  buttonClassName?: string;
  signInLabel?: string;
};

/* ------------------------------------------------------------------ */
/* 2.  Provider wrapper                                               */
/* ------------------------------------------------------------------ */
export const Web3Providers: FC<PropsWithChildren> = ({ children }) => (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider
        modalSize="wide"
        theme={darkTheme({
          accentColor: 'rgb(51, 226, 230)',
          accentColorForeground: 'rgb(51, 226, 230)',
          borderRadius: 'large',
          fontStack: 'rounded',
          overlayBlur: 'large',
        })}
      >
        {children}
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

/* ------------------------------------------------------------------ */
/* 3.  Sync RainbowKit ↔ Svelte stores with one hook                  */
/* ------------------------------------------------------------------ */
function useSyncStores() {
  const { status } = useAccount();

  useEffect(() => {
    const hydrated = status !== 'connecting' && status !== 'reconnecting';
    walletReady.set(hydrated);
  }, [status]);

  useAccountEffect({
    async onConnect({ address, connector }) {
      /* update local stores */
      walletAddress.set(address);
      username.set(`${address.slice(0, 6)}…${address.slice(-4)}`);

      /* RainbowKit returns an EIP‑1193 provider (type unknown) */
      const raw = (await connector.getProvider()) as Eip1193Provider;
      const provider = new BrowserProvider(raw, 'any') as Provider;
      userProvider.set(provider);
    },

    onDisconnect() {
      /* ensure surrounding Svelte UI notices logout */
      location.reload();
    },
  });
}

/* ------------------------------------------------------------------ */
/* 4.  Custom Connect / Account button                                */
/* ------------------------------------------------------------------ */
const RainbowConnectInner: FC<RainbowProps> = ({
  buttonClassName = 'rainbow-btn',
  signInLabel = 'Sign In',
}) => {
  useSyncStores();

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        if (!mounted) return <div aria-hidden="true" />;

        const connected = account && chain;

        if (!connected) {
          return (
            <button className={buttonClassName} onClick={openConnectModal}>
              {signInLabel}
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button className={buttonClassName} onClick={openChainModal}>
              Wrong&nbsp;network
            </button>
          );
        }

        return (
          <button className={buttonClassName} onClick={openAccountModal}>
            Sign&nbsp;Out
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
};

/* ------------------------------------------------------------------ */
/* 5.  Export ready‑to‑mount component                                */
/* ------------------------------------------------------------------ */
const Rainbow: FC<RainbowProps> = (props) => (
  <Web3Providers>
    <RainbowConnectInner {...props} />
  </Web3Providers>
);

export default Rainbow;
