# 0007. CI runs the three gates with exact pins

- Status: accepted
- Date: 2026-09-17

## Context

The quality gates are `claude plugin validate plugin`, `tsc -p plugin/hooks` and the plugin
tests. `/plugin-types` must run first, because `tsc` reads the declarations that it writes.
None of these calls the model. With Claude Code 2.1.274, all of them passed in a new clone
with only `HOME` (an empty directory), `PATH` and `USER` set.

pull-request-pane tested each version from 2.1.266 through 2.1.273 and found `claude plugin
test` first in 2.1.273, published 2026-09-15. A version that can run the tests is thus 2 days
old or less today.

## Decision

`.github/workflows/test.yml` runs on each push to `main` and on each pull request. It uses the
same pins as pull-request-pane, so one review moves both: `actions/checkout` v7.0.1 and
`actions/setup-node` v7.0.0 by commit SHA, Node 22.23.2, `typescript@7.0.2`, and
`@anthropic-ai/claude-code@2.1.273`. The claude CLI pin is a stated exception to the 7-day
rule. The workflow has no secret.

## Consequences

- The gates were not run locally with 2.1.273: a minimum-package-age guard on the development
  machine refused the install, and the guard stayed on. The first run on GitHub is the check
  that `Input`, `onInput` and `onSubmit` exist in that version. If it fails, move the pin to
  2.1.274.
- 2026-09-17, later: the first run on GitHub passed all gates with 2.1.273 (17 tests), so the
  pin stays and the README names 2.1.273 as the minimum version.
- Look at the claude CLI pin again from 2026-09-22, when 2.1.273 is 7 days old.
