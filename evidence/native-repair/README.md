# Recorded native Kane source repair

Original run: `23eaa89a-f3fe-4d0c-adde-6baddf31b463`. Repaired run: `f8556f4d-110b-481a-a33f-895b22685227`.

Kane completed five cases before repair, caught both seeded authorization bugs and preserved permitted controls. All five passed after the isolated source repair, with the same contract, fixture mode and verification inputs. Native Kane also verified the report interaction; see workflow-proof.json.

Open index.html locally for the interactive recorded report. It contains real screenshots and observations from those runs. Use npm run judge or npm run repair:kane to generate fresh results.

Recorded evidence export. Result states, observations, IDs and input/source hashes are preserved. Account share links and raw vendor evidence packs are omitted; screenshots and sanitized events are retained. Rerun native verification to generate fresh complete packs.

manifest.json records SHA-256 hashes for the exported files and the original raw packs. agent-handoff.json distinguishes the active Codex file-patch handoff from nested Codex execution. repair-prompt.md is the original generated agent prompt; its evidence paths refer to the agent workspace.
