import { ethers } from 'ethers';
import {
  STAKING_ABI,
  STAKING_ADDRESS,
  RPC_URL,
  CHAIN_ID,
  RELAY_API_URL,
  FORWARD_REQUEST_TYPES,
} from '@lib/contract';
import type {
  ForwardRequestData,
  RelayResult,
  EIP712Domain,
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

// --- Relay API helpers ---

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
      throw new Error('Relay request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getForwarderNonce(address: string): Promise<string> {
  const data = await relayFetch<{ nonce: string }>(
    `/staking/nonce/${address}`,
  );
  return data.nonce;
}

export async function getForwarderDomain(): Promise<EIP712Domain> {
  return relayFetch<EIP712Domain>('/staking/domain');
}

export async function checkApproval(address: string): Promise<boolean> {
  const data = await relayFetch<{ approved: boolean }>(
    `/staking/check-approval/${address}`,
  );
  return data.approved;
}

export async function fundApproval(
  address: string,
): Promise<string> {
  const data = await relayFetch<{ tx_hash: string }>(
    `/staking/fund-approval/${address}`,
    { method: 'POST', timeoutMs: 30000 },
  );
  return data.tx_hash;
}

// Minimum ETH balance (in wei) to cover a setApprovalForAll tx on mainnet.
const MIN_APPROVAL_ETH = 500_000_000_000_000n; // 0.0005 ETH

export async function hasEnoughEthForApproval(address: string): Promise<boolean> {
  const balance = await readProvider.getBalance(address);
  return balance >= MIN_APPROVAL_ETH;
}

export async function waitForFundingTx(txHash: string): Promise<void> {
  const receipt = await readProvider.waitForTransaction(txHash, 1, 60_000);
  if (!receipt || receipt.status === 0) {
    throw new Error('Funding transaction failed on-chain');
  }
}

async function relayForwardRequest(
  req: ForwardRequestData,
): Promise<RelayResult> {
  const result = await relayFetch<RelayResult>('/staking/relay', {
    method: 'POST',
    body: JSON.stringify({ request: req }),
  });

  // Wait for the transaction to be mined and verify it succeeded on-chain.
  const receipt = await readProvider.waitForTransaction(result.tx_hash, 1, 60_000);
  if (!receipt || receipt.status === 0) {
    throw new Error('Transaction reverted on-chain');
  }

  return result;
}

// --- EIP-712 signing ---

function estimateGas(data: string): string {
  // Forwarder overhead: signature verification, _checkForwardedGas, proxy delegatecall
  const OVERHEAD = 80_000;
  // First token buffer: covers ERC721A ownerOf backward scan for the first (lowest) token
  // in a batch. Handles up to ~130 empty slots (worst case for current supply).
  const FIRST_TOKEN_BUFFER = 300_000;
  // Per-NFT base cost: safeTransferFrom + storage writes + events.
  // When sorted ascending, each transfer initializes the next slot, so ownerOf is O(1).
  const PER_NFT = 80_000;
  // ERC721A scan cost per empty slot between non-consecutive token IDs.
  // Each gap slot requires a cold SLOAD (~2100) plus loop overhead.
  const SCAN_PER_SLOT = 2_500;

  try {
    const iface = new ethers.Interface(STAKING_ABI);
    const decoded = iface.parseTransaction({ data });
    if (decoded && (decoded.name === 'stake' || decoded.name === 'unstake')) {
      const tokenIds: bigint[] = decoded.args[0];
      const count = tokenIds.length;
      if (count === 0) return String(OVERHEAD + FIRST_TOKEN_BUFFER + PER_NFT);

      const sorted = [...tokenIds].map(Number).sort((a, b) => a - b);
      const span = sorted[count - 1] - sorted[0];
      // Gaps = empty slots between our tokens that still need scanning
      const gaps = Math.max(0, span - count + 1);

      return String(
        OVERHEAD + FIRST_TOKEN_BUFFER + count * PER_NFT + gaps * SCAN_PER_SLOT,
      );
    }
  } catch {
    // Fall through to default
  }
  return String(OVERHEAD + FIRST_TOKEN_BUFFER + PER_NFT);
}

async function signForwardRequest(
  signer: ethers.Signer,
  to: string,
  data: string,
  domain: EIP712Domain,
  nonce: string,
): Promise<ForwardRequestData> {
  const from = await signer.getAddress();

  // Set a 10-minute deadline
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const gas = estimateGas(data);

  const domainData = {
    name: domain.name,
    version: domain.version,
    chainId: domain.chain_id,
    verifyingContract: domain.verifying_contract,
  };

  const message = {
    from,
    to,
    value: '0',
    gas,
    nonce,
    deadline,
    data,
  };

  const signature = await signer.signTypedData(
    domainData,
    FORWARD_REQUEST_TYPES,
    message,
  );

  return {
    from,
    to,
    value: '0',
    gas,
    deadline: String(deadline),
    data,
    signature,
  };
}

// --- Gasless stake/unstake via relay ---

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

  const iface = new ethers.Interface(STAKING_ABI);
  const calldata = iface.encodeFunctionData('stake', [sortedIds, sortedMonths]);

  const from = await signer.getAddress();
  const [domain, nonce] = await Promise.all([
    getForwarderDomain(),
    getForwarderNonce(from),
  ]);

  const forwardReq = await signForwardRequest(
    signer,
    STAKING_ADDRESS,
    calldata,
    domain,
    nonce,
  );

  return relayForwardRequest(forwardReq);
}

export async function unstakeTokens(
  signer: ethers.Signer,
  tokenIds: number[],
) {
  if (tokenIds.length === 0) throw new Error('No tokens selected');

  // Sort ascending for consistent gas estimation (unstake ownerOf is O(1)
  // since slots were initialized during stake, but sorting keeps it predictable).
  const sortedIds = [...tokenIds].sort((a, b) => a - b);

  const iface = new ethers.Interface(STAKING_ABI);
  const calldata = iface.encodeFunctionData('unstake', [sortedIds]);

  const from = await signer.getAddress();
  const [domain, nonce] = await Promise.all([
    getForwarderDomain(),
    getForwarderNonce(from),
  ]);

  const forwardReq = await signForwardRequest(
    signer,
    STAKING_ADDRESS,
    calldata,
    domain,
    nonce,
  );

  return relayForwardRequest(forwardReq);
}
