# DB Sync Copy Style Guide

This guide standardizes DB Sync text across dashboard surfaces.

## Goals
- Keep healthy-state messages short and easy to scan.
- Show detailed diagnostics only when there is an actionable error.
- Keep wording consistent between topbar and detailed health panel.

## Canonical States
Use these state labels exactly:
- `Waiting for sign-in`
- `Syncing`
- `Syncing recent changes`
- `Pending changes`
- `Synced`
- `Needs attention`

## Health Panel Copy

### Healthy (no `dbStateLastError`)
Use compact summary only:
- `DB Sync {mode} | Queue: {queueSize} | Last Refresh: {syncText} | Last Write: {writeText}`

Do not include request/result/error internals in healthy mode.

### Error (`dbStateLastError` present)
Use expanded diagnostics:
- `DB Sync {mode} | Queue: {queueSize} | Last Refresh: {syncText} | Last Write: {writeText} | Last Attempt: {attemptText} | Write Attempt: {writeAttemptText} | Last Request: {requestText} | Last Result: {resultText} | Write Result: {writeResultText} | Refresh Result: {refreshResultText} | Last Error: {errorText}`

## Topbar Copy

### Healthy (no `dbStateLastError`)
- With queue: `Queue: {queueSize} | Refresh: {syncText}`
- Without queue: `Refresh: {syncText}`

### Error (`dbStateLastError` present)
- `Write {writeResultText} | Refresh {refreshResultText} | Error: {errorText}`

## Copy Rules
- Prefer title case labels (`Last Refresh`, `Last Write`) in panel summary.
- Prefer short labels in topbar (`Refresh`) to save space.
- Avoid adding new metrics to healthy mode unless they are required for everyday operation.
- Keep diagnostics in error mode only.
- If wording changes in one dashboard file, apply the same change in the other dashboard file.

## Placement
Current implementations are in:
- `index.html` -> `renderDbSyncHealth()`
- `Saadho_Bodhashala_Dashboard.html` -> `renderDbSyncHealth()`
