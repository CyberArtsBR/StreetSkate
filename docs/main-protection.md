# StreetSkate — production protection and staging workflow

Observed on 2026-10-07:

- production branch: `main`
- production main SHA at the start of this v2 refactor: `caf36682a61444e19fddf20599652029836f17df`
- GitHub reports `main` as **not protected**
- repository rulesets endpoint currently returns no active rulesets
- production Render service: `streetskate`
- production Render branch: `main`
- production Render auto-deploy trigger: **commit**
- current refactor branch: `refactor/core-skate-controller-v2`
- legacy Phase 1 staging service still tracks `refactor/core-skate-controller-v1`
- active production park is the current three-area assembly: original optimized arena/collision + `halfnew.glb` extensions
- `halfpipenew.glb` remains inactive

## CI gate

`.github/workflows/phase1-core-ci.yml` runs for:

- pushes to `main`
- pushes to `refactor/core-skate-controller-v*`
- pull requests targeting `main`
- manual workflow dispatch

Required jobs:

1. `validate-core`
   - npm install
   - unit + deterministic replay tests
   - board / vert / pump verification
   - production bundle
2. `browser-smoke`
   - local production preview
   - real browser input smoke
   - canonical state/yaw checks
   - camera-state checks
   - screenshot artifact

## Required GitHub ruleset

The connected GitHub integration does not expose repository-administration writes, so this cannot be safely enabled from the current tool connection.

Configure manually:

**Repository Settings → Rules → Rulesets → New branch ruleset**

Recommended:

- name: `StreetSkate production main`
- status: **Active**
- target: `main`
- block force pushes
- restrict branch deletion
- require pull request before merge
- require branch to be up to date
- require status checks:
  - `validate-core`
  - `browser-smoke`
- keep owner/admin bypass available for solo development

## Render policy

Production must remain:

`main`
→ `streetskate`
→ https://streetskate.onrender.com

Do not point the production service at a refactor branch.

The production Render service currently deploys on every commit to main. To prevent a broken direct push from reaching production before CI finishes, change in the Render dashboard:

**streetskate → Settings → Auto-Deploy → After CI Checks Pass**

Do not change the production branch.

## Staging policy

Every substantial core refactor should use an isolated Render service that tracks the active refactor branch.

Current work:

`refactor/core-skate-controller-v2`
→ Phase 1 Core CI
→ v2 staging
→ browser/manual playtest
→ PR to main
→ required checks
→ production merge

The older `streetskate-phase1-staging` service is still tied to v1 and should not be treated as the v2 validation target.

## Merge gate

Do not merge v2 while any of these are unresolved:

- `validate-core` is red
- `browser-smoke` is red
- deterministic vert/coping replay is non-deterministic
- contact-driven landing yaw violations are non-zero
- explicit spin is not the only airborne yaw authority
- collision stress at 3/6/9/12/15/17 m/s tunnels through wall/corner geometry
- canonical movement/travel state invariants diverge
- transition metadata loses any base or runtime extension transition
- v2 staging has visible collision, camera, ramp, grind, manual or performance regressions

Production merge remains a separate action after staging acceptance.
