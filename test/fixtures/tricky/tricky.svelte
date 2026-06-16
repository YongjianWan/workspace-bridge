<script>
  import { writable } from 'svelte/store';
  import LocalComponent from './LocalComponent.svelte';

  const count = writable(0);
</script>

<LocalComponent count={$count} />
