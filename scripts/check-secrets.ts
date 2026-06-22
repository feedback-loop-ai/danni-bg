#!/usr/bin/env bun
// Secret-placeholder gate (spec 030, FR-136 / SC-D3). Run in CI/release before a non-dev deploy: it
// fails (exit 1) if a known dev placeholder — or a missing required secret — would ship to the target
// profile. Set DANNI_PROFILE (e.g. `production`) and provide the real secrets via the environment.
//
//   DANNI_PROFILE=production bun run scripts/check-secrets.ts

import { auditSecrets } from '../src/lib/secret-scan.ts';

// DANNI_REQUIRED_SECRETS (comma-separated) overrides which secrets MUST be present for this run — e.g.
// the app container sets it empty (deployment-wide secrets are gated in CI, not in the app entrypoint).
const requiredOverride =
  process.env.DANNI_REQUIRED_SECRETS != null
    ? process.env.DANNI_REQUIRED_SECRETS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

const audit = auditSecrets(
  process.env,
  requiredOverride !== undefined ? { required: requiredOverride } : {},
);

if (audit.isDev) {
  console.info(
    `✓ secret check skipped for dev-like profile "${audit.profile}" (placeholders allowed)`,
  );
  process.exit(0);
}

if (audit.violations.length > 0) {
  console.error(`✗ secret check FAILED for profile "${audit.profile}":`);
  for (const v of audit.violations) {
    console.error(
      v.reason === 'missing'
        ? `  - ${v.name}: required secret is missing/empty`
        : `  - ${v.name}: still set to a placeholder value`,
    );
  }
  console.error('Provide real, rotatable secrets via the environment before deploying.');
  process.exit(1);
}

console.info(`✓ secret check passed for profile "${audit.profile}"`);
process.exit(0);
