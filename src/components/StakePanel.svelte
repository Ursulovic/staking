<script lang="ts">
  import type { BrowserProvider } from 'ethers';

  import { setApprovalForAll, isApprovedForAll } from '@lib/potentials';
  import {
    address,
    provider,
    connected,
    walletReady,
    myTokens,
    userStats,
    globalStats,
    dataStatus,
    busy as busyStore,
    isPaused as pausedStore,
  } from '@stores/web3.svelte';
  import {
    stakingContract,
    isPaused,
    stakeTokens,
    unstakeTokens,
  } from '@lib/staking';
  import {
    getUserStakingData,
    getGlobalStats,
  } from '@lib/indexer';
  import { getOwnedTokenSet } from '@lib/potentials';
  import { STAKING_ADDRESS } from '@lib/contract';
  import { toastStore } from '@stores/toast.svelte';
  import { previewStaking } from '@lib/stakingPreview';
  import { getVotingPower } from '@lib/tokenLevels';

  import WalletConnect from '@components/web3/WalletConnect.svelte';
  import RefreshSVG from '@components/icons/Refresh.svelte';
  import ContractSVG from '@components/icons/Contract.svelte';
  import LoadingSVG from '@components/icons/Loading.svelte';

  const DEFAULT_LOCK = 6;
  const MIN_LOCK = 1;
  const MAX_LOCK = 12;
  const readOnlyStaking = stakingContract();
  const stakingReady = Boolean(readOnlyStaking?.target ?? STAKING_ADDRESS);

  let approved = $state(false);
  let globalLockMonths = $state<number>(DEFAULT_LOCK);

  function isUnlockable(token: TokenState) {
    return (
      token.isStaked &&
      token.unlockTime > 0 &&
      token.unlockTime <= Math.floor(Date.now() / 1000)
    );
  }

  const stakeSelection = $derived(
    $myTokens.filter((token) => token.selected && !token.isStaked),
  );
  const stakeSelectionCount = $derived(stakeSelection.length);
  const unstakeSelection = $derived(
    $myTokens.filter(
      (token) => token.selected && token.isStaked && isUnlockable(token),
    ),
  );
  const unstakeSelectionCount = $derived(unstakeSelection.length);
  const availableCount = $derived(
    $myTokens.filter((token) => !token.isStaked).length,
  );
  const stakingDisabled = $derived(
    !$connected ||
      !stakingReady ||
      !approved ||
      !stakeSelectionCount ||
      $pausedStore ||
      $busyStore !== 'idle',
  );
  const unstakingDisabled = $derived(
    !$connected ||
      !stakingReady ||
      !unstakeSelectionCount ||
      $busyStore !== 'idle',
  );
  const approveDisabled = $derived(
    approved || !stakingReady || !$connected || $busyStore !== 'idle',
  );

  const poolShare = $derived(
    (() => {
      const globalEffectiveVP = $globalStats?.totalEffectiveVotingPower;
      const userEffectiveVP = $userStats?.totalEffectiveVotingPower;

      if (globalEffectiveVP === undefined || userEffectiveVP === undefined)
        return null;

      if (globalEffectiveVP === 0n) return null;

      const share = (Number(userEffectiveVP) / Number(globalEffectiveVP)) * 100;
      return Math.min(Math.max(share, 0), 100);
    })(),
  );

  const stakingPreview = $derived(
    (() => {
      if (!stakeSelectionCount) return null;

      const globalEffectiveVP = $globalStats?.totalEffectiveVotingPower ?? 0n;
      const userEffectiveVP = $userStats?.totalEffectiveVotingPower ?? 0n;
      const tokenIds = stakeSelection.map((t) => t.tokenId);

      return previewStaking(
        tokenIds,
        globalLockMonths,
        globalEffectiveVP,
        userEffectiveVP,
      );
    })(),
  );

  let loadingData = false;

  // Map raw GraphQL entries into Svelte-friendly objects.
  function normalizeToken(raw: RawStakedNFT): TokenState {
    return {
      tokenId: Number(raw.tokenId),
      votingPower: Number(raw.votingPower ?? 0),
      lockMonths: Number(raw.lockMonths ?? DEFAULT_LOCK) || DEFAULT_LOCK,
      stakedAt: Number(raw.stakedAt ?? 0),
      unlockTime: Number(raw.unlockTime ?? 0),
      isStaked: Boolean(raw.isStaked),
      selected: false,
    };
  }

  async function loadStakingData(addr: string) {
    if (loadingData) return;
    loadingData = true;
    busyStore.set('fetch');
    dataStatus.set('loading');

    try {
      // Try indexer first, fall back to on-chain multicall if unavailable.
      let ownedIds: number[];
      let userData: Awaited<ReturnType<typeof getUserStakingData>>;
      let globalSnapshot: Awaited<ReturnType<typeof getGlobalStats>>;
      try {
        [userData, globalSnapshot] = await Promise.all([
          getUserStakingData(addr),
          getGlobalStats(),
        ]);
      } catch {
        console.warn('Indexer unavailable, falling back to on-chain reads');
        userData = {
          stakedNFTs: [],
          totalVotingPower: 0n,
          totalEffectiveVotingPower: 0n,
          accumulatedPoints: 0,
          currentPoints: 0,
          pointsPerSecond: 0,
          stakedNFTCount: 0,
        };
        globalSnapshot = {
          totalVotingPower: 0n,
          totalEffectiveVotingPower: 0n,
          totalStakedNFTs: 0,
          totalAccumulatedPoints: 0,
        };
      }
      // Ownership is always read on-chain (indexer doesn't track it).
      const { ids } = await getOwnedTokenSet(addr as `0x${string}`);
      ownedIds = ids;

      const stakedTokens = userData.stakedNFTs.map(normalizeToken);

      userStats.set({
        totalVotingPower: userData.totalVotingPower,
        totalEffectiveVotingPower: userData.totalEffectiveVotingPower,
        accumulatedPoints: userData.accumulatedPoints,
        currentPoints: userData.currentPoints,
        pointsPerSecond: userData.pointsPerSecond,
        stakedNFTCount: userData.stakedNFTCount,
      });

      globalStats.set(globalSnapshot);

      const merged = new Map<number, TokenState>();

      stakedTokens.forEach((token) => {
        merged.set(token.tokenId, token);
      });

      ownedIds.forEach((tokenId) => {
        if (merged.has(tokenId)) return;
        merged.set(tokenId, {
          tokenId,
          votingPower: getVotingPower(tokenId),
          lockMonths: DEFAULT_LOCK,
          stakedAt: 0,
          unlockTime: 0,
          isStaked: false,
          selected: false,
        });
      });

      const tokens = Array.from(merged.values()).sort(
        (a, b) => a.tokenId - b.tokenId,
      );
      myTokens.set(tokens);

      if (!tokens.length) {
        dataStatus.set('empty');
      } else {
        dataStatus.set('ready');
      }
    } catch (err) {
      console.error(err);
      dataStatus.set('error');
      toastStore.show(
        'Unable to load staking data, please try refreshing',
        'error',
      );
    } finally {
      busyStore.set('idle');
      loadingData = false;
    }
  }

  async function refreshApproval(addr: string) {
    if (!stakingReady) return;
    try {
      approved = await isApprovedForAll(addr, STAKING_ADDRESS);
    } catch (err) {
      console.error(err);
    }
  }

  // Ping the contract (read-only) to see if staking is paused.
  async function refreshPausedState() {
    try {
      const paused = await isPaused();
      pausedStore.set(!!paused);
    } catch (err) {
      console.error(err);
    }
  }

  // UI-only selection helpers (non-staked tokens only).
  function toggleSelection(tokenId: number, selectedValue: boolean) {
    const paused = $pausedStore;
    myTokens.update((tokens) =>
      tokens.map((token) => {
        if (token.tokenId !== tokenId) return token;

        const unlockable = isUnlockable(token);
        const stakeSelectable = !token.isStaked && !paused;
        const unstakeSelectable = token.isStaked && unlockable;
        if (!stakeSelectable && !unstakeSelectable) return token;

        return { ...token, selected: selectedValue };
      }),
    );
  }

  function selectAllForStaking() {
    if ($pausedStore) return;
    myTokens.update((tokens) =>
      tokens.map((token) => {
        if (token.isStaked) return token;
        return { ...token, selected: true };
      }),
    );
  }

  function getUserMessage(err: any, fallback: string): string {
    const code = err?.code;
    const msg = err?.message ?? '';
    if (code === 'ACTION_REJECTED' || msg.includes('user rejected'))
      return 'Transaction cancelled';
    if (code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds'))
      return 'Not enough ETH for gas fees';
    if (msg.includes('TX_TIMEOUT'))
      return 'Transaction is taking longer than expected. Check your wallet for status.';
    return fallback;
  }

  function onRefreshClick() {
    const current = $address;
    if (!current) return;
    loadStakingData(current);
  }

  async function handleApprove() {
    if (!stakingReady) {
      toastStore.show('Set PUBLIC_STAKING_ADDRESS to continue', 'error');
      return;
    }

    const current = $address;
    if (!current) {
      toastStore.show('Connect a wallet first', 'error');
      return;
    }

    const currentProvider = $provider as BrowserProvider | null;
    if (!currentProvider) {
      toastStore.show('Connect a wallet first', 'error');
      return;
    }

    busyStore.set('approve');

    try {
      const signer = await currentProvider.getSigner();
      await setApprovalForAll(signer, STAKING_ADDRESS, true);
      approved = true;
      toastStore.show('Staking contract approved');
    } catch (err) {
      console.error(err);
      toastStore.show(getUserMessage(err, 'Approval transaction failed'), 'error');
    } finally {
      busyStore.set('idle');
    }
  }

  async function handleStake() {
    if (!stakingReady) {
      toastStore.show('Set PUBLIC_STAKING_ADDRESS to continue', 'error');
      return;
    }

    const current = $address;
    const currentProvider = $provider as BrowserProvider | null;

    if (!current || !currentProvider) {
      toastStore.show('Connect a wallet first', 'error');
      return;
    }

    const selection = stakeSelection;
    if (!selection.length) {
      toastStore.show('Select at least one NFT to stake', 'error');
      return;
    }

    if (
      !Number.isInteger(globalLockMonths) ||
      globalLockMonths < MIN_LOCK ||
      globalLockMonths > MAX_LOCK
    ) {
      toastStore.show(
        'Choose a lock duration between 1 and 12 months',
        'error',
      );
      return;
    }

    const tokenIds = selection.map((token) => token.tokenId);
    const months = Array(tokenIds.length).fill(globalLockMonths);

    busyStore.set('stake');

    try {
      const signer = await currentProvider.getSigner();
      const result = await stakeTokens(signer, tokenIds, months);
      toastStore.show(
        `Staked ${tokenIds.length} NFT${tokenIds.length > 1 ? 's' : ''} successfully (tx: ${result.tx_hash.slice(0, 10)}...)`,
      );
      await loadStakingData(current);
    } catch (err) {
      console.error(err);
      toastStore.show(getUserMessage(err, 'Staking failed — please try again'), 'error');
    } finally {
      busyStore.set('idle');
    }
  }

  async function handleUnstake() {
    if (!stakingReady) {
      toastStore.show('Set PUBLIC_STAKING_ADDRESS to continue', 'error');
      return;
    }

    const current = $address;
    const currentProvider = $provider as BrowserProvider | null;

    if (!current || !currentProvider) {
      toastStore.show('Connect a wallet first', 'error');
      return;
    }

    const selection = unstakeSelection;
    if (!selection.length) {
      toastStore.show('Select at least one unlockable NFT to unstake', 'error');
      return;
    }

    const tokenIds = selection.map((token) => token.tokenId);

    busyStore.set('unstake');

    try {
      const signer = await currentProvider.getSigner();
      const result = await unstakeTokens(signer, tokenIds);
      toastStore.show(
        `Unstaked ${tokenIds.length} NFT${tokenIds.length > 1 ? 's' : ''} successfully (tx: ${result.tx_hash.slice(0, 10)}...)`,
      );
      await loadStakingData(current);
    } catch (err) {
      console.error(err);
      toastStore.show(getUserMessage(err, 'Unstaking failed — please try again'), 'error');
    } finally {
      busyStore.set('idle');
    }
  }

  $effect(() => {
    const current = $address;
    connected.set(!!current);
    if (!current) {
      approved = false;
      myTokens.set([]);
      userStats.set(null);
      globalStats.set(null);
      dataStatus.set('idle');
      pausedStore.set(false);
      return;
    }
    refreshApproval(current);
    loadStakingData(current);
  });

  $effect(() => {
    $provider;
    refreshPausedState();
  });

  // Formatting helpers for the metric cards.
  function formatBigInt(value?: bigint | null) {
    if (value === undefined || value === null) return '0';
    return value.toString();
  }

  function formatPoints(value?: number | null, digits = 0) {
    if (value === undefined || value === null || Number.isNaN(value))
      return '0';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatPercent(value?: number | null, digits = 2) {
    if (
      value === undefined ||
      value === null ||
      Number.isNaN(value) ||
      !Number.isFinite(value)
    )
      return '--';
    return `${value.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}%`;
  }

  function formatPerDay(value?: number | null) {
    if (value === undefined || value === null || Number.isNaN(value))
      return '0 pts/day';
    const perDay = value * 60 * 60 * 24;
    return `${formatPoints(perDay)} pts/day`;
  }

  // Date conversion utility
  const convertDate = (timestamp: number) => {
    return new Date(Number(timestamp) * 1000).toLocaleDateString();
  };
</script>

<h1 class="sr-only">Potentials Staking</h1>

<h5 class="mar-inline">
  Select your Potentials, set a lock period, and stake.
</h5>

<section class="flex">
  {#if $connected}
    <header class="flex-row flex-wrap pad pad-inline shad fade-in">
      <h4>Potentials Staking</h4>
      <RefreshSVG
        onclick={onRefreshClick}
        text={$busyStore === 'fetch' ? 'Fetching…' : 'Refresh'}
        disabled={$busyStore === 'fetch'}
      />
    </header>

    <div class="panel container">
      {#if !stakingReady}
        <p class="validation">
          Set <code>PUBLIC_STAKING_ADDRESS</code> in your .env file to enable staking.
        </p>
      {/if}

      {#if $pausedStore}
        <p class="validation">
          Staking is temporarily paused. Unstake remains available after unlock.
        </p>
      {/if}

      {#if $userStats || $globalStats}
        <div class="stats flex fade-in">
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Your Potential Power</p>
            <h4>{formatBigInt($userStats?.totalVotingPower)}</h4>
          </article>
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Your points</p>
            <h4>
              {formatPoints($userStats?.currentPoints)}
              <br />
              <strong>({formatPerDay($userStats?.pointsPerSecond)})</strong>
            </h4>
          </article>
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Your share of pool</p>
            <h4>{formatPercent(poolShare)}</h4>
          </article>
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Your Staked NFTs</p>
            <h4>
              {($userStats?.stakedNFTCount ?? 0).toLocaleString()}
            </h4>
          </article>
        </div>

        <div class="stats flex">
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Global Potential Power</p>
            <h4>{formatBigInt($globalStats?.totalVotingPower)}</h4>
          </article>
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Global points</p>
            <h4>
              {formatPoints($globalStats?.totalAccumulatedPoints)}
            </h4>
          </article>
          <article class:loading-animation={$dataStatus === 'loading'}>
            <p>Total staked NFTs</p>
            <h4>
              {($globalStats?.totalStakedNFTs ?? 0).toLocaleString()}
            </h4>
          </article>
        </div>
      {/if}

      {#if availableCount}
        <h4>
          {availableCount} / {$myTokens.length} NFTs available for staking
        </h4>

        <button
          onclick={selectAllForStaking}
          disabled={$pausedStore || !availableCount || $busyStore !== 'idle'}
        >
          Select all to stake
        </button>
      {:else if $myTokens.length}
        <h4>All {$myTokens.length} NFTs are currently staked</h4>
      {/if}

      {#if $dataStatus === 'loading'}
        <span class="flex-row gap">
          <LoadingSVG />
          <h5>Fetching owned Potentials…</h5>
        </span>
      {:else if $dataStatus === 'empty'}
        <p class="validation">No Potentials NFTs were found for this wallet</p>
      {:else if $myTokens.length === 0}
        <p class="validation">
          Data loaded, but no NFTs are currently available for staking
        </p>
      {:else}
        <div class="nfts-wrapper flex-row flex-wrap gap fade-in">
          {#each $myTokens as token (token.tokenId)}
            {@const unlockable = isUnlockable(token)}
            {@const stakeSelectable = !token.isStaked && !$pausedStore}
            {@const unstakeSelectable = token.isStaked && unlockable}
            {@const selectable = stakeSelectable || unstakeSelectable}
            {@const disabledTile =
              (!selectable && token.isStaked) ||
              (!token.isStaked && $pausedStore)}
            <button
              class="void-btn"
              class:potential-tile={stakeSelectable && !token.selected}
              class:green-tile={token.selected && selectable}
              class:gray-tile={disabledTile}
              class:rose-tile={token.isStaked && unlockable && !token.selected}
              disabled={!selectable}
              onclick={() => toggleSelection(token.tokenId, !token.selected)}
              aria-label={`Select token ${token.tokenId}`}
            >
              <img
                src={`https://api.dgrslabs.ink/nft/image/${token.tokenId}`}
                alt={`Potential #${token.tokenId}`}
              />
              <h5>Potential #{token.tokenId}</h5>

              {#if token.isStaked}
                <span class="tile-data">
                  <p>Staked: {convertDate(token.stakedAt)}</p>
                  <p>Unlocks: {convertDate(token.unlockTime)}</p>
                </span>
              {/if}

              {#if token.isStaked}
                {#if unlockable}
                  <p class="validation">Ready to unstake</p>
                {:else}
                  <p class="validation">Staked</p>
                {/if}
              {:else if token.selected}
                <p class="validation">Selected</p>
              {:else}
                <p class="validation">Available</p>
              {/if}
            </button>
          {/each}
        </div>

        <div class="preview-box flex fade-in">
          <div class="lock-slider flex gap-8">
            <label for="lock-period">
              Lock period:
              <strong class="lock-value">
                {globalLockMonths}
                {globalLockMonths === 1 ? 'month' : 'months'}
              </strong>
            </label>
            <input
              id="lock-period"
              type="range"
              min={MIN_LOCK}
              max={MAX_LOCK}
              step="1"
              bind:value={globalLockMonths}
            />
          </div>

          {#if stakingPreview}
            <div class="flex-row flex-wrap">
              <p>
                <span>Selected NFTs:</span>
                <strong>{stakeSelectionCount}</strong>
              </p>
              <p>
                <span>Base Voting Power:</span>
                <strong>{stakingPreview.totalBaseVP}</strong>
              </p>
              <p>
                <span>Boost ({globalLockMonths}mo):</span>
                <strong>{stakingPreview.boostMultiplier.toFixed(2)}x</strong>
              </p>
              <p>
                <span>Boosted Voting Power:</span>
                <strong>{stakingPreview.boostedVP.toFixed(1)}</strong>
              </p>
              <p>
                <span>Projected pts/day:</span>
                <strong
                  >{formatPoints(stakingPreview.projectedPointsPerDay)}</strong
                >
              </p>
              <p>
                <span>Projected Pool Share:</span>
                <strong
                  >{formatPercent(stakingPreview.projectedPoolShare)}</strong
                >
              </p>
            </div>
          {/if}

          <span class="caption-font transparent-white-txt">
            Staked NFTs are locked for the full duration and cannot be unstaked early.
          </span>
        </div>

        {#if !approved}
          <ContractSVG
            onclick={handleApprove}
            text={$busyStore === 'approve'
              ? 'Approving…'
              : 'Approve staking contract'}
            disabled={approveDisabled}
          />
        {/if}

        <span class="flex-row flex-wrap">
          <button class="cta" onclick={handleStake} disabled={stakingDisabled}>
            {#if $busyStore === 'stake'}
              Staking…
            {:else}
              Stake selected NFTs
              {#if stakeSelectionCount}
                ({stakeSelectionCount})
              {/if}
              for {globalLockMonths}
              {globalLockMonths === 1 ? 'month' : 'months'}
            {/if}
          </button>
          <button
            class="green-btn"
            onclick={handleUnstake}
            disabled={unstakingDisabled}
          >
            {#if $busyStore === 'unstake'}
              Unstaking…
            {:else}
              Unstake selected NFTs
              {#if unstakeSelectionCount}
                ({unstakeSelectionCount})
              {/if}
            {/if}
          </button>
        </span>
      {/if}
    </div>
  {:else}
    <div class="container">
      {#if $walletReady}
        <h5>Connect your wallet to load your inventory.</h5>
      {:else}
        <span class="flex-row gap">
          <LoadingSVG />
          <h5>Checking wallet session…</h5>
        </span>
      {/if}
      <span hidden={!$walletReady}>
        <WalletConnect
          buttonClassName="cta"
          signInLabel="Sign In With Web3 Wallet"
        />
      </span>
    </div>
  {/if}
</section>

<style lang="scss">
  @use '/src/styles/mixins/' as *;

  section {
    gap: 0;
    min-width: min(40rem, 95%);
    width: 95%;
    max-width: calc(15rem * 4 + 7rem); // 4 tiles per row + gaps

    @include respond-up(full-hd) {
      max-width: calc(15rem * 5 + 8rem);
    }

    @include respond-up(quad-hd) {
      max-width: calc(15rem * 6 + 11rem);
    }

    .container {
      width: 100%;
      max-width: unset;
      margin: 0;
      animation: none;
      @include dark-blue;
    }

    header {
      width: 100%;
      z-index: 10;
      background-color: $royal-purple;
      border-top-left-radius: 1rem;
      border-top-right-radius: 1rem;

      h4 {
        @include orange(1, text);
      }
    }

    .panel {
      width: 100%;
      border-top-left-radius: 0;
      border-top-right-radius: 0;

      .stats {
        width: 100%;

        article {
          display: flex;
          flex-flow: column nowrap;
          align-items: flex-start;
          gap: 0.5rem;
          width: 100%;
          padding: 1rem;
          border-radius: 0.5rem;
          @include white-txt;
          @include gray-border;
          @include purple(0.25);

          p {
            text-transform: capitalize;
            margin-bottom: 0.5rem;
            @include font(caption);
          }

          h4 {
            text-align: left;

            strong {
              opacity: 0.5;
              font-weight: normal;
              @include font(body);
            }
          }
        }

        @include respond-up(tablet) {
          flex-direction: row;
          align-items: stretch;
        }
      }

      .nfts-wrapper {
        width: 100%;

        button {
          .validation {
            color: inherit;
          }

          @include mobile-only {
            width: 100%;

            img {
              height: 80vw;
            }
          }
        }
      }

      .lock-slider {
        width: 100%;

        input[type='range'] {
          width: min(25rem, 100%);
        }
      }

      .preview-box {
        width: 100%;
        padding: 1rem;
        border-radius: 0.5rem;
        @include gray-border;
        @include purple(0.25);

        p {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          width: 100%;
          border-top: 1px solid $transparent-gray;
          padding-top: 1rem;

          @include respond-up(small-desktop) {
            width: calc(50% - 1rem);
            border-top: none;
            padding: 1rem;
            border-radius: 0.5rem;
            @include dark-blue(0.5);
          }

          @include respond-up(large-desktop) {
            width: calc(33% - 1rem);
          }

          span {
            @include white-txt(soft);
          }

          strong {
            @include orange(1, text);
          }
        }
      }
    }
  }
</style>
