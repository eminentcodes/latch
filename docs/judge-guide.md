# Test Latch yourself

Latch checks a permission contract and verifies that a source repair enforces it. The included example is a real Node HTTP application with browser login cookies and a mutable document. Its identities, content and two bugs are deliberate test fixtures.

## Start the live demonstration

Open [the public demo](https://latchtst.vercel.app/), click **Start live demo**, wait for preparation, and open your live workspace. No access code or sign-up is required. Download your evidence before ending the bounded session. The same steps below also work locally:

```sh
npm ci
npx playwright install chromium
npm run judge
```

Use Node.js 22 or newer. On Linux, install Chromium with `npx playwright install --with-deps chromium`.

| Surface | URL |
| --- | --- |
| Latch workspace | http://127.0.0.1:4318 |
| Original app | http://127.0.0.1:4317/login |
| Source-repaired app | http://127.0.0.1:4319/login |

Choose the named test identity again when switching app versions. No application password is needed.

## Enter something the demo cannot have prerecorded

1. In the original app, choose **Morgan** and open **Orion launch plan**. Morgan belongs to another workspace. The document and its private marker appear; the protected request returns HTTP 200.
2. Choose **Sam** and open `/probe/documents/launch-plan`. Type a phrase of your own choosing into **Proposed content**, then click **Send update request**. The viewer's request succeeds.
3. Choose **Avery**, open the document and confirm your exact phrase was stored.
4. In the repaired app, repeat Morgan's read. It returns HTTP 403 and does not disclose the private document.
5. As Sam, try a different phrase. The update returns HTTP 403. Switch to Avery and verify that the rejected text was not stored.
6. As Avery, submit a new update. The allowed editor's request must succeed and the document must show the entered text.

Browser developer tools show the actual GET/PUT requests. The update page also displays the response status. The manual actions change each app's in-memory document independently; automated checks reset data between cases.

## Generate evidence yourself

In Latch, select **Local browser · quick check**, then **Generate fresh before/after proof**. This launches new browser sessions and writes a new report. It does not load prerecorded result JSON.

The same five cases run against both apps:

| Case | Expected result after repair |
| --- | --- |
| Avery reads | HTTP 200; private content visible |
| Morgan reads | HTTP 403; private content absent |
| Sam reads | HTTP 200; permitted content visible |
| Avery updates | HTTP 200; content changes |
| Sam updates | HTTP 403; stored content unchanged |

Inspect **Before · failed run** and **After · verified repair**. Each case includes the tested actor, expected permission, actual response, data hashes, browser evidence and an allowed-user control. A fix that blocks all users fails.

The report directory contains `run.json`, `before-run.json`, `application-patch.json` and screenshots. Check that the run IDs are fresh and the original/repaired contract, fixture mode and verification hashes match. Check the policy file's before/after hashes against the supplied patch.

Both apps use the same **vulnerable** fixture mode. The repaired app is compiled from an isolated change to `demo/policy.ts`; the comparison does not switch the original app into its predefined secure mode. Changing application or verification inputs while the judge runtime is running stops further checks until a restart.

## Verify with native Kane

```sh
npm run kane:login
npm run kane:status
npm run kane:balance
```

Use your normal local Kane account and available credits. Set `KANE_CLI_CHROME_PATH` if Chrome is not discovered. Then choose **Kane CLI · native verification** in Latch, or run:

```sh
npm run repair:kane
npm run kane:report -- artifacts/kane-repair
```

The first command executes native before/after permission checks for a reviewed fixture patch. The second separately verifies Latch's report interaction. The report always states the permission engine and repair method. A local Playwright result is never labeled as Kane verification.

Native Kane caught both seeded bugs and then **passed all five cases after the actual source repair**, with unchanged permission expectations and verification inputs.

| Action | Original source | Repaired source |
| --- | --- | --- |
| Avery reads | HTTP 200; private content visible | HTTP 200; private content visible |
| Morgan reads | HTTP 200; private content visible | HTTP 403; private content absent |
| Sam reads | HTTP 200; private content visible | HTTP 200; private content visible |
| Avery updates | HTTP 200; stored content changed | HTTP 200; stored content changed |
| Sam updates | HTTP 200; stored content changed | HTTP 403; stored content unchanged |

Native Kane also passed the report interaction check. Inspect the [recorded evidence](../evidence/native-repair/README.md), [interactive report](../evidence/native-repair/index.html), [source/data hashes](../evidence/native-repair/manifest.json) and [agent handoff](../evidence/native-repair/agent-handoff.json). The export retains genuine screenshots and sanitized events; account share links and raw vendor packs stay local. Rerun the commands below to generate fresh complete evidence.

Original native run: `23eaa89a-f3fe-4d0c-adde-6baddf31b463`. Repaired native run: `f8556f4d-110b-481a-a33f-895b22685227`.

## Inspect the coding-agent handoff

The published native proof includes the generated failure prompt, hash-bound application patch and handoff metadata. The active Codex session consumed the two native failures and authored the enforcement repair. Native Kane then checked the isolated candidate against the original contract and inputs.

The report button verifies a reviewed patch; it does not invoke Codex. The optional `repair --execute` adapter invokes a separately authenticated Codex CLI. That nested execution remains unverified. A judge can instead supply a new file patch to `repair --patch` and independently repeat verification.

## Assess the demonstration

The useful result is observable: forbidden disclosure and mutation fail after a real source change, while permitted work succeeds. Missing results, missing evidence, browser assertion disagreements and tool errors retain their actual failure/incomplete states.

The [previous-winner comparison](prior-art.md) cites the organizer's recap. GuardianKane is a relevant confirmed winner by developer-workflow pattern. Published descriptions of previous projects have not been independently reproduced here.

For downloaded live evidence, run `node scripts/verify-evidence.mjs path/to/latch-run.zip`. For the recorded native export, run `node scripts/verify-evidence.mjs evidence/native-repair`. The verifier checks all listed file hashes, complete cases, unchanged inputs, controls and source-patch hashes. Its manifest integrity check is separate from independently reproducing the behavior in a new browser session.

The [official brief](https://www.kaneclihack.sh/) requires a working product, meaningful Kane proof and feedback to the coding agent. This local workflow demonstrates those steps through a file-patch handoff. Hosted automatic Codex repair and arbitrary-app integration remain extensions.
