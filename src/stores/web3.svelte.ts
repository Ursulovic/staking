import { writable } from 'svelte/store';
import { walletAddress, userProvider } from '@stores/auth.svelte';

export const connected = writable(false);
export const walletReady = writable(false);
export const address = walletAddress;
export const provider = userProvider;
export const isPaused = writable<boolean>(false);
export const myTokens = writable<TokenState[]>([]);
export const userStats = writable<UserStats | null>(null);
export const globalStats = writable<GlobalStats | null>(null);
export const dataStatus = writable<
  'idle' | 'loading' | 'ready' | 'empty' | 'error'
>('idle');
export const busy = writable<
  'idle' | 'fetch' | 'approve' | 'stake' | 'unstake'
>('idle');
