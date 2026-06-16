<template>
  <div>{{ val }}</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { helper } from './utils';

const val = ref('hello');
</script>
