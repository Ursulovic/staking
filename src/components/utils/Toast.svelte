<script lang="ts">
  import { onMount } from 'svelte';

  let {
    message = '',
    type = 'info',
    duration = 10000,
    onClose = () => {},
  }: {
    message: string;
    type: 'info' | 'error';
    duration: number;
    onClose: () => void;
  } = $props();

  let fading = $state<number | null>(null);
  let hide = $state<boolean>(false);

  const closeToast = () => {
    fading = Math.random();
    setTimeout(() => {
      if (onClose) onClose();
      hide = true;
    }, 600);
  };

  onMount(() => {
    const timer = setTimeout(() => {
      closeToast();
    }, duration - 600);

    return () => {
      clearTimeout(timer);
    };
  });
</script>

<button
  class="void-btn flex-row pad round blur"
  class:info={type === 'info'}
  class:error={type !== 'info'}
  class:fading-left={fading && fading < 0.5}
  class:fading-right={fading && fading >= 0.5}
  class:hide
  onclick={closeToast}
  type="button"
  aria-live={type === 'error' ? 'assertive' : 'polite'}
>
  <p>{message}</p>
</button>

<style lang="scss">
  @use '/src/styles/mixins' as *;

  button {
    pointer-events: auto;
    max-width: 100%;
    width: fit-content;
    margin-inline: auto;

    transition: all 0.6s ease;
    opacity: 1;

    @include white-txt(1);
    @include box-shadow;

    &.info {
      @include green(0.75);
    }

    &.error {
      @include red(0.75);
    }

    &.fading-left {
      opacity: 0;
      transform: translate(-200%, 50%) scaleY(0.5) skew(15deg, -15deg);
    }

    &.fading-right {
      opacity: 0;
      transform: translate(200%, 50%) scaleY(0.5) skew(-15deg, 15deg);
    }

    &.hide {
      display: none;
    }

    @starting-style {
      opacity: 0;
      transform: translateY(-300%) scale(0.75);
    }

    &:hover,
    &:active,
    &:focus-visible {
      @include box-shadow(deep);

      &.info {
        @include green;
      }

      &.error {
        @include red;
      }
    }
  }
</style>
