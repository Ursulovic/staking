import { z } from 'zod';
import type { Abi } from 'viem';

const env = z
  .object({
    PUBLIC_RPC_URL: z.string().url(),
    PUBLIC_CHAIN_ID: z.coerce.number().int(),
    PUBLIC_POTENTIALS_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    PUBLIC_STAKING_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    PUBLIC_GRAPHQL_ENDPOINT: z.string().url(),
    PUBLIC_RELAY_API_URL: z.string().url(),
    PUBLIC_FORWARDER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .parse(import.meta.env);

export const RPC_URL = env.PUBLIC_RPC_URL;
export const CHAIN_ID = env.PUBLIC_CHAIN_ID;
export const POTENTIALS_ADDRESS = env.PUBLIC_POTENTIALS_ADDRESS;
export const STAKING_ADDRESS = env.PUBLIC_STAKING_ADDRESS;
export const GRAPHQL_ENDPOINT = env.PUBLIC_GRAPHQL_ENDPOINT;
export const RELAY_API_URL = env.PUBLIC_RELAY_API_URL;
export const FORWARDER_ADDRESS = env.PUBLIC_FORWARDER_ADDRESS;

export const POTENTIALS_ABI = [
  {
    name: 'setApprovalForAll',
    inputs: [{ type: 'address' }, { type: 'bool' }],
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    name: 'ownerOf',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'isApprovedForAll',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const STAKING_ABI = [
  {
    name: 'stake',
    inputs: [{ type: 'uint256[]' }, { type: 'uint8[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    name: 'unstake',
    inputs: [{ type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    name: 'getStakeInfo',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { type: 'uint40' },
      { type: 'uint40' },
      { type: 'uint8' },
      { type: 'address' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'isStakingPaused',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const POTENTIALS_ABI_VIEM = POTENTIALS_ABI as unknown as Abi;

// --- Relay types ---

export interface ForwardRequestData {
  from: string;
  to: string;
  value: string;
  gas: string;
  deadline: string;
  data: string;
  signature: string;
}

export interface RelayResult {
  tx_hash: string;
  success: boolean;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chain_id: number;
  verifying_contract: string;
}

// EIP-712 type structure for ForwardRequest signing
export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};
