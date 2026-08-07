# Wave 1G Verification Logs & Command Summaries

## Execution Summary

| Suite | Status | Total Files | Passed | Failed |
|---|---|---|---|---|
| Backend Unit & Integration Tests (`vitest`) | PASSED | 20 | 20 | 0 |
| Frontend Unit & Component Tests (`vitest`) | PASSED | 5 | 5 | 0 |
| Playwright E2E Tests (`playwright`) | PASSED | 1 | 1 (2 tests) | 0 |
| Frontend TypeScript (`npx tsc --noEmit`) | PASSED | - | - | 0 |
| E2E TypeScript (`npx tsc --noEmit -p tsconfig.e2e.json`) | PASSED | - | - | 0 |
| Server TypeScript (`cd server; npx tsc --noEmit`) | PASSED | - | - | 0 |
| Production Build Frontend (`npm run build`) | PASSED | - | - | 0 |
| Production Build Server (`cd server; npm run build`) | PASSED | - | - | 0 |
| Prisma Validation (`npx prisma validate`) | PASSED | - | - | 0 |

## Playwright Postcondition Proofs
- **Test 1**: API/Backend propagation preview & apply with independent `expectedVersions` (`property: 1`, `billing: 1`), verifying idempotency key replay and version conflict rejection.
- **Test 2**: Visible Owner UI lifecycle connecting Owner Settings, Propagation Preview Modal, Building Overrides, Room Identity Overrides, Snapshot comparison, and Availability query with zero console errors (`expect(test2ConsoleErrors).toEqual([])`).
