import { ethers } from 'ethers';
import {
  STAKING_ABI,
  STAKING_ADDRESS,
  RPC_URL,
  CHAIN_ID,
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
