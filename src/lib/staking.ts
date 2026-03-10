import { ethers } from 'ethers';
import {
  STAKING_ABI,
  STAKING_ADDRESS,
  RPC_URL,
  CHAIN_ID,
  RELAY_API_URL,
} from '@lib/contract';

const readProvider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

export function stakingContract(
  readerOrSigner?: ethers.Provider | ethers.Signer,
) {
  const p = readerOrSigner ?? readProvider;
  return new ethers.Contract(STAKING_ADDRESS, STAKING_ABI, p);
}

export async function isPaused(provider?: ethers.Provider) {
  const c = stakingContract(provider ?? readProvider);
  return await c.isStakingPaused();
}

// --- Backend API helpers ---

async function relayFetch<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10000);

  try {
    const res = await fetch(`${RELAY_API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
    const body = await res.json();
    if (!res.ok) {
      const detail = body?.error?.details || body?.error || '';
      throw new Error(body?.message ? `${body.message} ${detail}` : `Relay error ${res.status}`);
    }
    return body.data as T;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkApproval(address: string): Promise<boolean> {
  const data = await relayFetch<{ approved: boolean }>(
    `/staking/check-approval/${address}`,
  );
  return data.approved;
}

export async function fundGas(
  address: string,
  count: number,
): Promise<string> {
  const data = await relayFetch<{ tx_hash: string }>(
    `/staking/fund-gas/${address}?count=${count}`,
    { method: 'POST', timeoutMs: 30000 },
  );
  return data.tx_hash;
}

// Minimum ETH balance to consider the user "funded" (fallback check).
const MIN_GAS_ETH = 100_000_000_000_000n; // 0.0001 ETH

export async function hasEnoughEthForGas(address: string): Promise<boolean> {
  const balance = await readProvider.getBalance(address);
  return balance >= MIN_GAS_ETH;
}

export async function waitForFundingTx(txHash: string): Promise<void> {
  const receipt = await readProvider.waitForTransaction(txHash, 1, 60_000);
  if (!receipt || receipt.status === 0) {
    throw new Error('Funding transaction failed on-chain');
  }
}

// Requests gas funding from the backend and waits for confirmation.
// The backend sends only the deficit (needed - userBalance), handles dedup,
// and validates count against actual NFT balance.
export async function ensureGasFunded(address: string, count: number): Promise<void> {
  try {
    const txHash = await fundGas(address, count);
    await waitForFundingTx(txHash);
  } catch (err: any) {
    // Funding may have succeeded on-chain even though the response timed out,
    // or user already had sufficient ETH. Check balance as fallback.
    const hasEthNow = await hasEnoughEthForGas(address);
    if (hasEthNow) return;
    throw err;
  }
}

// --- Direct stake/unstake via user's wallet ---

export async function stakeTokens(
  signer: ethers.Signer,
  tokenIds: number[],
  months: number[],
) {
  if (tokenIds.length === 0) throw new Error('No tokens selected');
  if (tokenIds.length !== months.length) throw new Error('Length mismatch');

  // Sort ascending so each ERC721A transfer initializes the next slot,
  // making subsequent ownerOf calls O(1) instead of scanning backwards.
  const indices = tokenIds.map((_, i) => i).sort((a, b) => tokenIds[a] - tokenIds[b]);
  const sortedIds = indices.map((i) => tokenIds[i]);
  const sortedMonths = indices.map((i) => months[i]);

  const contract = stakingContract(signer);
  const tx = await contract.stake(sortedIds, sortedMonths);
  const receipt = await tx.wait();
  if (!receipt || receipt.status === 0) {
    throw new Error('Staking transaction reverted on-chain');
  }
  return { tx_hash: tx.hash };
}

export async function unstakeTokens(
  signer: ethers.Signer,
  tokenIds: number[],
) {
  if (tokenIds.length === 0) throw new Error('No tokens selected');

  // Sort ascending for ERC721A gas optimization.
  const sortedIds = [...tokenIds].sort((a, b) => a - b);

  const contract = stakingContract(signer);
  const tx = await contract.unstake(sortedIds);
  const receipt = await tx.wait();
  if (!receipt || receipt.status === 0) {
    throw new Error('Unstaking transaction reverted on-chain');
  }
  return { tx_hash: tx.hash };
}
