import { GRAPHQL_ENDPOINT } from '@/lib/contract';

const POINTS_PER_SECOND = 500_000 / (7 * 24 * 60 * 60);

// HyperIndex tracks user/global staking stats off-chain. This helper wraps the
// fetch so the rest of the app can access the same data without rewriting the
// GraphQL boilerplate.

// GraphQL schema fragments used as inputs for normalization.

export async function queryGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data as T;
}

export async function getUserStakingData(
  userAddress: string,
): Promise<UserStakingData> {
  const query = `
    query GetUserData($user: String!) {
      User(where: { id: { _eq: $user } }) {
        totalVotingPower
        totalEffectiveVotingPower
        accumulatedPoints
        stakedNFTCount
        lastUpdateTime
      }
      StakedNFT(where: { user: { _eq: $user }, isStaked: { _eq: true } }) {
        tokenId
        votingPower
        lockMonths
        stakedAt
        unlockTime
        isStaked
      }
      GlobalState {
        totalVotingPower
        totalEffectiveVotingPower
        totalStakedNFTs
        totalAccumulatedPoints
      }
    }
  `;

  const result = await queryGraphQL<{
    User: RawUser[];
    StakedNFT: RawStakedNFT[];
    GlobalState: RawGlobalState[];
  }>(query, { user: userAddress });

  const user = result.User[0];
  const globalState = result.GlobalState[0];

  if (!user || !globalState) {
    return {
      stakedNFTs: [],
      totalVotingPower: 0n,
      totalEffectiveVotingPower: 0n,
      accumulatedPoints: 0,
      currentPoints: 0,
      pointsPerSecond: 0,
      stakedNFTCount: 0,
    };
  }

  const userVP = BigInt(user.totalVotingPower);
  const userEffectiveVP = BigInt(user.totalEffectiveVotingPower || '0');
  const globalEffectiveVP = BigInt(
    globalState.totalEffectiveVotingPower || '0',
  );
  const lastUpdateTime = BigInt(user.lastUpdateTime || '0');
  const currentTime = BigInt(Math.floor(Date.now() / 1000));
  const timeElapsed = Number(currentTime - lastUpdateTime);

  const accumulatedPoints = parseFloat(user.accumulatedPoints ?? '0');
  const pendingPoints =
    globalEffectiveVP > 0n
      ? (Number(userEffectiveVP) / Number(globalEffectiveVP)) *
        POINTS_PER_SECOND *
        Math.max(timeElapsed, 0)
      : 0;

  const pointsPerSecond =
    globalEffectiveVP > 0n
      ? (Number(userEffectiveVP) / Number(globalEffectiveVP)) *
        POINTS_PER_SECOND
      : 0;

  return {
    stakedNFTs: result.StakedNFT,
    totalVotingPower: userVP,
    totalEffectiveVotingPower: userEffectiveVP,
    accumulatedPoints,
    currentPoints: accumulatedPoints + pendingPoints,
    pointsPerSecond,
    stakedNFTCount: user.stakedNFTCount,
  };
}

export async function getGlobalStats(): Promise<GlobalStats> {
  const query = `
    query GetGlobalStats {
      GlobalState {
        totalVotingPower
        totalEffectiveVotingPower
        totalStakedNFTs
        totalAccumulatedPoints
      }
    }
  `;

  const result = await queryGraphQL<{ GlobalState: RawGlobalState[] }>(query);
  const globalState = result.GlobalState[0];
  const totalAccumulatedPoints = globalState
    ? parseFloat(globalState.totalAccumulatedPoints ?? '0')
    : 0;

  return {
    totalVotingPower: globalState
      ? BigInt(globalState.totalVotingPower || '0')
      : 0n,
    totalEffectiveVotingPower: globalState
      ? BigInt(globalState.totalEffectiveVotingPower || '0')
      : 0n,
    totalStakedNFTs: globalState ? globalState.totalStakedNFTs : 0,
    totalAccumulatedPoints: Number.isFinite(totalAccumulatedPoints)
      ? totalAccumulatedPoints
      : 0,
  };
}

export async function getOwnedTokenIds(_owner: string): Promise<number[]> {
  // TokenInfo is not tracked by the indexer — ownership must be read on-chain.
  throw new Error('TokenInfo not available in indexer');
}
