const { scoreToLevel } = require('../../config/risk-thresholds');
const { get2LevelPrefix } = require('../../utils/path');

function buildCompositeRisk(entry) {
  const reasons = [];

  const impactCount = entry?.impactCount || 0;
  const affectedTestsCount = entry?.affectedTestsCount || 0;
  const affectedRoutes = entry?.affectedRoutes || [];

  // 1. Flow Participation
  let flowParticipation = 0;
  if ((entry?.frameworkPattern !== undefined && entry?.frameworkPattern !== null) || entry?.classification?.isEntry === true) {
    flowParticipation = 3;
    reasons.push('High flow participation: Entry file or framework-specific entry point.');
  } else if (affectedRoutes.length >= 5) {
    flowParticipation = 2;
    reasons.push(`High flow participation: Affects ${affectedRoutes.length} route(s).`);
  } else if (affectedRoutes.length >= 1) {
    flowParticipation = 1;
    reasons.push(`Medium flow participation: Affects ${affectedRoutes.length} route(s).`);
  }

  // 2. Community Crossing
  let communityCrossing = 0;
  const uniquePrefixes = new Set();
  if (entry?.impact) {
    for (const imp of entry.impact) {
      if (imp.file) {
        uniquePrefixes.add(get2LevelPrefix(imp.file));
      }
    }
  }
  if (uniquePrefixes.size >= 3) {
    communityCrossing = 3;
    reasons.push(`High community crossing: Transitive dependents span ${uniquePrefixes.size} directories.`);
  } else if (uniquePrefixes.size >= 2) {
    communityCrossing = 2;
    reasons.push(`Medium community crossing: Transitive dependents span ${uniquePrefixes.size} directories.`);
  } else if (uniquePrefixes.size >= 1) {
    communityCrossing = 1;
    reasons.push(`Low community crossing: Transitive dependents span ${uniquePrefixes.size} directories.`);
  }

  // 3. Test Coverage
  let testCoverage = 0;
  if (affectedTestsCount === 0 && impactCount >= 3) {
    testCoverage = 3;
    reasons.push('Critical test coverage gap: 0 tests cover this file despite high impact.');
  } else if (affectedTestsCount === 0 && impactCount > 0) {
    testCoverage = 2;
    reasons.push('High test coverage gap: 0 tests cover this file.');
  } else if (affectedTestsCount === 1 || affectedTestsCount === 2) {
    testCoverage = 1;
    reasons.push(`Low test coverage: Only ${affectedTestsCount} test(s) cover this file.`);
  }

  // 4. Caller Count
  let callerCount = 0;
  if (impactCount >= 10) {
    callerCount = 3;
    reasons.push(`High caller count: ${impactCount} transitive dependents.`);
  } else if (impactCount >= 5) {
    callerCount = 2;
    reasons.push(`Medium caller count: ${impactCount} transitive dependents.`);
  } else if (impactCount >= 1) {
    callerCount = 1;
    reasons.push(`Low caller count: ${impactCount} transitive dependents.`);
  }

  // 5. Security Sensitive
  let securitySensitive = 0;
  const pathLower = (entry?.file || '').toLowerCase();
  const secKeywords = ['auth', 'login', 'crypt', 'token', 'password', 'key', 'permission', 'session', 'guard', 'jwt', 'policy', 'security'];
  if (secKeywords.some(k => pathLower.includes(k))) {
    securitySensitive = 2;
    reasons.push('Security sensitive: File path matches security keywords.');
  }

  let score = flowParticipation + communityCrossing + testCoverage + callerCount + securitySensitive;

  // Downgrade non-mainline files because they usually have narrower production impact.
  if (entry?.classification?.isMainline === false && score > 0) {
    score -= 1;
    reasons.push('Non-mainline file: downgrade one point.');
  }

  score = Math.max(0, score);
  const level = scoreToLevel(score);

  if (reasons.length === 0) {
    reasons.push('Low observed structural risk.');
  }

  return {
    level,
    score,
    reasons,
    dimensions: {
      flow_participation: flowParticipation,
      community_crossing: communityCrossing,
      test_coverage: testCoverage,
      caller_count: callerCount,
      security_sensitive: securitySensitive
    }
  };
}

module.exports = { buildCompositeRisk };
