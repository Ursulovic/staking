import { ethers } from 'ethers';
import { createPublicClient, http } from 'viem';
import { mainnet as viemMainnet, sepolia as viemSepolia, baseSepolia as viemBaseSepolia, base as viemBase } from 'viem/chains';
import {
  CHAIN_ID,
  RPC_URL,
  POTENTIALS_ADDRESS,
  POTENTIALS_ABI,
  POTENTIALS_ABI_VIEM,
} from '@lib/contract';

const chainMap = {
  [viemMainnet.id]: viemMainnet,
  [viemSepolia.id]: viemSepolia,
  [viemBaseSepolia.id]: viemBaseSepolia,
  [viemBase.id]: viemBase,
} as const;
const baseChain = chainMap[CHAIN_ID as keyof typeof chainMap] ?? viemBaseSepolia;

const activeChain = {
  ...baseChain,
  id: CHAIN_ID,
  rpcUrls: {
    ...baseChain.rpcUrls,
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
} as const;

const viemClient = createPublicClient({
  chain: activeChain,
  transport: http(RPC_URL),
});

const readProvider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

function potentialsContract(readerOrSigner?: ethers.Provider | ethers.Signer) {
  const p = readerOrSigner ?? readProvider;
  return new ethers.Contract(POTENTIALS_ADDRESS, POTENTIALS_ABI, p);
}

export async function isApprovedForAll(
  owner: string,
  operator: string,
): Promise<boolean> {
  const c = potentialsContract(readProvider);
  return await c.isApprovedForAll(owner, operator);
}

export async function setApprovalForAll(
  signer: ethers.Signer,
  operator: string,
  approved = true,
) {
  const c = potentialsContract(signer);
  const tx = await c.setApprovalForAll(operator, approved);
  return await tx.wait();
}

async function getOwnedTokenIds(
  owner: `0x${string}`,
  totalSupply = 1000,
  batchSize = 100,
) {
  const tokenIds = Array.from({ length: totalSupply }, (_, i) => BigInt(i + 1));
  const batches: bigint[][] = [];
  for (let i = 0; i < tokenIds.length; i += batchSize) {
    batches.push(tokenIds.slice(i, i + batchSize));
  }

  const calls = (ids: bigint[]) =>
    ids.map((id) => ({
      address: POTENTIALS_ADDRESS as `0x${string}`,
      abi: POTENTIALS_ABI_VIEM,
      functionName: 'ownerOf' as const,
      args: [id] as const,
    }));

  const mine: number[] = [];
  for (const batch of batches) {
    const res = await viemClient.multicall({ contracts: calls(batch) });
    res.forEach((result, idx) => {
      if (result.status === 'success') {
        const ownerAddr = (
          result.result as string | undefined
        )?.toLowerCase?.();
        if (ownerAddr === owner.toLowerCase()) {
          mine.push(Number(batch[idx]));
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return mine;
}

// Returns both owned (unstaked) token IDs and a Set for quick lookup.
export async function getOwnedTokenSet(
  owner: `0x${string}`,
  totalSupply = 1000,
  batchSize = 100,
) {
  const ids = await getOwnedTokenIds(owner, totalSupply, batchSize);
  return { ids, set: new Set(ids) };
}
