# OptionChainPulse / Option-Chain — GitHub Copilot Instructions

## Project purpose
This repository contains OptionChainPulse, a Windows Electron desktop application for real-time Indian index option-chain analysis and trading workflows. It supports NIFTY, BANKNIFTY and SENSEX and integrates broker/data adapters, option-chain analytics, Smart Signal analysis, trade recommendations, alerts, trade journal functionality, and Windows packaging.

## Core rules
1. Preserve existing trading functionality unless the user explicitly asks to change or remove it.
2. Do not silently change trading rules, signal thresholds, risk-management logic, broker behavior, order execution behavior, or live-data behavior.
3. Do not introduce simulated, mocked, or fabricated market data into live broker/data paths.
4. Treat Smart Signal Engine as an existing production feature. Preserve its explainable factor model, blockers, stability checks, output types, and integration unless a change is explicitly requested.
5. Keep NIFTY, BANKNIFTY and SENSEX support working.
6. Keep all existing broker integrations and fallback behavior intact unless the requested change specifically concerns a broker.
7. Keep Electron Windows packaging working. Do not break the electron:build, dist, dist:portable, or dist:publish flows.
8. Prefer small, focused changes. Avoid unrelated refactors.
9. Before changing a type/interface, search for all consumers and update them consistently.
10. Before changing database/schema code, inspect related Prisma models, queries, migrations and UI consumers and explain any compatibility implications.

## Validation and build discipline
1. After TypeScript/React changes, run the most relevant type/build checks available in the repository.
2. When a GitHub Actions build fails, identify the first real source error before changing configuration or adding workarounds.
3. Do not treat artifact-upload warnings as the root cause when the build/package step failed earlier.
4. Keep GitHub Actions compatible with currently supported action runtimes.
5. Do not claim that an EXE or GitHub Release exists unless the corresponding build/release has actually completed successfully.
6. For packaging changes, verify that the expected Windows installer/portable artifact paths still match the workflow.

## Smart Signal Engine
1. Preserve the explainable weighted-factor architecture in src/lib/smart-signal-engine.ts.
2. Keep factor contributions and blockers visible and understandable.
3. Do not describe the rule engine as trained machine learning unless the implementation is actually changed to use trained ML.
4. Preserve engine versioning and output compatibility.
5. Be careful with data-quality, stale-data, missing-OI, regime and stability handling.

## UI and UX
1. Keep the existing dark trading-dashboard style and responsive behavior.
2. Reuse existing components and patterns before introducing new UI dependencies.
3. Keep important trading information visible and understandable.
4. Avoid hiding, removing or renaming existing user-facing controls without an explicit request.

## Help & What's New — mandatory
Every user-requested application update must also be documented in the Help & What's New section in:
src/components/option-chain/help-whats-new.tsx

When adding a feature, fix, build/CI fix, packaging change, or important user-facing behavior:
- Add a concise bullet describing the change.
- Keep the current version/date structure unless a version bump is part of the request.
- Do not remove previous What's New entries.
- Mention important build or packaging fixes when they affect EXE generation.

## Git and collaboration
1. Use focused commit messages that describe the actual change.
2. Do not rewrite unrelated history.
3. Prefer a pull request for larger or risky changes.
4. Include what changed, why, and what validation was performed in the PR description.
5. Never commit secrets, API keys, broker credentials, tokens, private certificates, or generated local credential files.

## Security
1. Never hard-code broker API keys, access tokens, Telegram tokens, passwords, or private credentials.
2. Preserve Electron contextIsolation and nodeIntegration=false security settings unless there is a documented reason to change them.
3. Expose Electron functionality to the renderer through the existing secure preload bridge rather than enabling Node.js access in the renderer.

## Working style
Before editing:
- Inspect the relevant existing code and types.
- Trace the data flow from source/API to adapter, type, UI and persistence where applicable.
- Make the smallest safe change.

After editing:
- Re-check affected imports/types/usages.
- Run the relevant build/type checks.
- Summarize changed files, validation, and any remaining limitation.
