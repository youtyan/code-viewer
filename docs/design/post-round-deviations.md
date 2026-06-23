# Post-round implementation notes

This branch has several review-driven fixes after the original Round 1-5
design docs were written. The older docs keep their original "do not touch"
lists as planning constraints, but current review verification uses the
following narrower rule.

## Current Protected Files

For Phase 11 majority-review fixes, do not add new diffs to:

- `web-src/server/database/snapshot-store.ts`
- `web-src/server/database/query-history.ts`
- `web-src/server/database/connection-pool.ts`

These files remain stable storage/connection boundaries. They can be read for
verification, but behavior changes should be handled in caller layers unless a
future task explicitly reopens them.

## Files Changed After Original Rounds

The following files appeared in older "do not touch" lists but were later
changed intentionally:

- `snapshot-runner.ts`: gained generic `SnapshotIterable` support and
  `AbortSignal` propagation for cancellable snapshots.
- `adapters/sqlite.ts` and `adapters/docker.ts`: gained SQL snapshot iteration
  and docker compose container-resolution cleanup.
- `adapters/redis.ts` and `adapters/elasticsearch.ts`: are first-class
  datasource adapters, implement snapshot iteration, and share docker utility
  helpers.
- `global-search.ts`: was adjusted during datasource/view integration work.
- `views/database/*`: tab UI, kind visibility, explorer abort guards, pane
  status helpers, and font-size behavior were changed after Round 5.

Rule of thumb for later work: new datasource adapters and their dedicated
handlers/views are allowed to evolve. Shared storage and history files stay
protected unless the task explicitly requires changing their contract.
