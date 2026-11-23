# Latch

[![Local permission proof](https://github.com/eminentcodes/latch/actions/workflows/latch.yml/badge.svg)](https://github.com/eminentcodes/latch/actions/workflows/latch.yml)

**Catch permission bugs. Prove the source repair with Kane.**

Latch checks who may read and change a protected document, gives the failure evidence to a coding agent, and verifies the repaired application against the same permission contract. It includes a hands-on demo, a CLI, an evidence report and GitHub Actions checks.

The demo is a running document-sharing application with two deliberate authorization bugs. Browser requests and stored-data changes are real. You can enter your own text, inspect the response, and generate a new report.

## Try it

Requires Node.js 22.19 or newer.

```sh
git clone https://github.com/eminentcodes/latch.git
cd latch
npm ci
npx playwright install chromium
npm run judge
```

On Linux, use `npx playwright install --with-deps chromium`.

Open **http://127.0.0.1:4318**. The original app runs on port **4317** and the source-repaired app on **4319**. Choose a test identity when opening each version; no app password is required.

1. Choose **Morgan** in the original app and open **Orion launch plan**. A user from another workspace receives the private document.
2. Choose **Sam**, open the protected update page linked in Latch, and enter your own text. The viewer's write succeeds; Avery can read that text back.
3. Repeat in the repaired app. Morgan's read and Sam's write return **403**. Sam's rejected text does not change the document; Avery can still read and edit.
4. In Latch, choose **Local browser · quick check** and click **Generate fresh before/after proof**. Inspect the new run ID, screenshots, response status, data hashes and allowed-user controls.

The quick check uses Playwright. Choose **Kane CLI · native verification** to run Kane with your local Kane login and credits. The report identifies which engine produced each result. Checks reset the demo data between cases.

Read the [judge guide](docs/judge-guide.md) for exact actions and how to check the evidence independently.

## Host it on Vercel

Follow the [Vercel setup guide](docs/vercel.md). Import this repository with **Other**, `npm run build:vercel` and output directory `public`; `vercel.json` supplies these settings. Add `LATCH_DEMO_ENABLED=true` and a private `LATCH_SESSION_SECRET` in Vercel's Production environment. Anyone can start a session without an access code or sign-up.

The website launches a bounded Vercel Sandbox with isolated original/repaired apps and real Chromium checks. Configure dedicated `LT_USERNAME`/`LT_ACCESS_KEY` and `LATCH_KANE_ENABLED=true` for native Kane. The quick check remains explicitly Playwright, and the saved native report is labeled recorded. Download fresh evidence with its hashes before the 45-minute session ends. The cloud adapter is locally tested; a deployed Sandbox/native run still needs verification.

## Recorded native proof

Native Kane caught both seeded bugs and then **passed all five cases after the actual source repair**, with unchanged permission expectations and verification inputs.

| Action | Original source | Repaired source |
| --- | --- | --- |
| Avery reads | HTTP 200; private content visible | HTTP 200; private content visible |
| Morgan reads | HTTP 200; private content visible | HTTP 403; private content absent |
| Sam reads | HTTP 200; private content visible | HTTP 200; private content visible |
| Avery updates | HTTP 200; stored content changed | HTTP 200; stored content changed |
| Sam updates | HTTP 200; stored content changed | HTTP 403; stored content unchanged |

Native Kane also passed the report interaction check. Inspect the [recorded evidence](evidence/native-repair/README.md), [interactive report](evidence/native-repair/index.html), [source/data hashes](evidence/native-repair/manifest.json) and [agent handoff](evidence/native-repair/agent-handoff.json). The export retains genuine screenshots and sanitized events; account share links and raw vendor packs stay local. Rerun the commands below to generate fresh complete evidence.

Original native run: `23eaa89a-f3fe-4d0c-adde-6baddf31b463`. Repaired native run: `f8556f4d-110b-481a-a33f-895b22685227`.

View the recorded [original failure](docs/images/report-before.png) and [verified repair](docs/images/report-after.png).

The repair changes only [demo/policy.ts](demo/policy.ts): reads require the same workspace, and writes also require the editor role. Both versions retain the same fixture mode, permission contract, test data, scenarios and verifier hashes.

The coding-agent handoff used the active Codex session to read Latch's Kane failure prompt and author a source-hash-bound patch. The report labels it as a file-patch handoff. A separate nested Codex CLI invocation is available but has not been executed.

## Reproduce the source repair

```sh
npm run repair:local
```

This runs all five cases, verifies the reviewed fixture patch in an isolated source copy, and writes `artifacts/local-repair/index.html`. It preserves the original app so the failure remains reproducible. `run.json`, `before-run.json`, `application-patch.json` and the evidence files accompany the report.

For native Kane, log in and check your available credits first:

```sh
npm run kane:login
npm run kane:status
npm run kane:balance
npm run repair:kane
npm run kane:report -- artifacts/kane-repair
```

Kane is pinned to 0.10.6. If Chrome is not discovered, set `KANE_CLI_CHROME_PATH` to a Chrome/Chromium executable. A normal native suite takes several minutes; the local browser check is faster.

`repair:kane` uses Kane for both the failing app and the isolated repair. This demonstration command generates the reviewed fixture patch; it does not invoke another coding agent. `kane:report` separately verifies the report journey, including an original failure, its screenshot and allowed-user control, then a repaired denial and unchanged data.

## Feed a failure to a coding agent

```sh
node dist/src/cli.js repair --run artifacts/local-repair/baseline/run.json --out artifacts/repair-review --allow demo/policy.ts
```

Hand the generated `repair-prompt.md` to your coding agent. Submit its reviewable replacement as a `latch-file-patch-v1` JSON file with `path`, `beforeHash` and `content`:

```sh
node dist/src/cli.js repair --run artifacts/local-repair/baseline/run.json --patch path/to/patch.json --allow demo/policy.ts --out artifacts/agent-repair
```

Latch compiles the isolated candidate and repeats the original cases. A stale patch, protected-file edit, changed verification input, missing evidence, timeout or failed allowed-user control rejects the repair. A browser assertion error with correctly enforced permissions cannot trigger an authorization repair.

`--execute` invokes your locally authenticated Codex CLI in an isolated copy. That optional nested model execution requires your own model access and has not been verified in this build. `--apply` copies an accepted change into the original source after verification; rebuilding is required to load it.

## Checks and CI

```sh
npm test
npm run check
npm run validate
npm run review:judge
```

The suite includes behavioral tests, an actual isolated browser repair, rejection of a deny-everyone patch, protected-input guards, cloud session/origin guards and credential redaction. The judge review tests manually entered content, permitted controls, fresh reports, screenshots, source provenance and mobile layout.

The [local Actions workflow](.github/workflows/latch.yml) runs tests and configured browser permission checks, retains the evidence artifact and delivers same-repository PR results. [Native CI](.github/workflows/kane.yml) is opt-in through `LATCH_KANE_ENABLED=true` and dedicated `LT_USERNAME`/`LT_ACCESS_KEY` secrets. Local OAuth credentials are never published or copied to CI.

Hosted PR repair and the nested Codex adapter remain unverified.

`passed` covers every declared case with matching browser and protected-operation evidence. `failed` records a violated rule or browser assertion. `incomplete` records missing evidence, missing observations, tool errors or timeouts. A passing suite covers its specified cases.

## Scope and prior art

This version uses the bundled application. External-app session/fixture adapters, retained-session membership removal and larger role matrices remain extensions.

[Bugsy](https://github.com/aayushkhator1994/bugsy) already documents ownership checks, allowed-user controls and a Kane/Codex repair loop. Latch credits that overlap; its implementation adds fixed verification inputs, guarded source changes, explicit incomplete states and a hands-on report. This is a fresh codebase; no Bugsy or Tavrel implementation was copied.

The [research and previous-winner comparison](docs/prior-art.md) links the underlying user problems, existing tools and organizer-confirmed projects. Built for the [KaneCLI Online Hackathon](https://www.kaneclihack.sh/).
