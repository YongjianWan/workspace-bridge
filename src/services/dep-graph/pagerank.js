/**
 * PageRank computation for file-level dependency graphs.
 * Ported from qartez-mcp graph/pagerank.rs.
 *
 * Operates on a directed graph where edges represent imports.
 * Dangling nodes (files with no outgoing edges) redistribute their rank
 * uniformly to all nodes, preventing rank sink.
 */

const DEFAULT_CONFIG = {
  damping: 0.85,
  iterations: 20,
  epsilon: 1e-5,
};

/**
 * Compute PageRank over an abstract graph without side effects.
 *
 * @param {string[]} nodes - Array of node identifiers (file paths)
 * @param {[string, string][]} edges - Array of [src, dst] tuples
 * @param {{damping?: number, iterations?: number, epsilon?: number}} [options]
 * @param {Map<string, number>} [prevRanks] - Warm-start ranks from previous run
 * @returns {Map<string, number>} Map of node id -> rank (ranks sum to ~1.0)
 */
function computePageRank(nodes, edges, options, prevRanks) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const n = nodes.length;
  if (n === 0) {
    return new Map();
  }

  const nodeToIdx = new Map();
  for (let i = 0; i < n; i++) {
    nodeToIdx.set(nodes[i], i);
  }

  const outgoing = Array.from({ length: n }, () => []);
  const incoming = Array.from({ length: n }, () => []);

  for (const [src, dst] of edges) {
    if (src === dst) continue;
    const si = nodeToIdx.get(src);
    const di = nodeToIdx.get(dst);
    if (si === undefined || di === undefined) continue;
    outgoing[si].push(di);
    incoming[di].push(si);
  }

  // Deduplicate adjacency lists
  for (let i = 0; i < n; i++) {
    if (outgoing[i].length > 1) {
      outgoing[i] = Array.from(new Set(outgoing[i]));
    }
    if (incoming[i].length > 1) {
      incoming[i] = Array.from(new Set(incoming[i]));
    }
  }

  const uniform = 1.0 / n;

  // Determine whether we have a usable warm-start.
  // If prevRanks sum is too low (all zeros or empty), fall back to uniform.
  let prevSum = 0.0;
  if (prevRanks && prevRanks.size > 0) {
    for (const [, rank] of prevRanks) {
      prevSum += rank;
    }
  }
  const haveWarmStart = prevSum > 0.5;

  let ranks = new Array(n);
  if (haveWarmStart) {
    for (let i = 0; i < n; i++) {
      const nodeId = nodes[i];
      const prev = prevRanks.get(nodeId);
      ranks[i] = prev && prev > 0.0 ? prev : uniform;
    }
  } else {
    ranks.fill(uniform);
  }

  let newRanks = new Array(n).fill(0.0);
  const base = (1.0 - config.damping) / n;

  for (let iter = 0; iter < config.iterations; iter++) {
    let leaked = 0.0;
    for (let i = 0; i < n; i++) {
      if (outgoing[i].length === 0) {
        leaked += ranks[i];
      }
    }
    const leakedShare = config.damping * leaked / n;

    for (let i = 0; i < n; i++) {
      let inboundSum = 0.0;
      for (const src of incoming[i]) {
        const outDegree = outgoing[src].length;
        if (outDegree > 0) {
          inboundSum += ranks[src] / outDegree;
        }
      }
      newRanks[i] = base + config.damping * inboundSum + leakedShare;
    }

    let delta = 0.0;
    for (let i = 0; i < n; i++) {
      delta += Math.abs(newRanks[i] - ranks[i]);
    }

    // swap ranks and newRanks
    [ranks, newRanks] = [newRanks, ranks];

    if (delta < config.epsilon) {
      break;
    }
  }

  const result = new Map();
  for (let i = 0; i < n; i++) {
    result.set(nodes[i], ranks[i]);
  }
  return result;
}

module.exports = { computePageRank, DEFAULT_CONFIG };
