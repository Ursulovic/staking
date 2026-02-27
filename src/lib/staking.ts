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

async function relayFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${RELAY_API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.message || body?.error || `Relay error ${res.status}`);
  }
  return body.data as T;
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
    { method: 'POST' },
  );
  return data.tx_hash;
}

async function relayForwardRequest(
  req: ForwardRequestData,
): Promise<RelayResult> {
  return relayFetch<RelayResult>('/staking/relay', {
    method: 'POST',
    body: JSON.stringify({ request: req }),
  });
}

// --- EIP-712 signing ---

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

  // Gas estimate for staking operations (generous buffer)
  const gas = '500000';

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

  const iface = new ethers.Interface(STAKING_ABI);
  const calldata = iface.encodeFunctionData('stake', [tokenIds, months]);

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

  const iface = new ethers.Interface(STAKING_ABI);
  const calldata = iface.encodeFunctionData('unstake', [tokenIds]);

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
