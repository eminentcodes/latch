# Host Latch on Vercel

The website creates an isolated [Vercel Sandbox](https://vercel.com/docs/sandbox) for each live session. Chromium, Kane CLI and both document apps run there. The HTTP Function only creates, checks or stops the session.

Use a **personal Hobby workspace** for the $0 setup. [Sandbox Hobby quotas](https://vercel.com/docs/sandbox/pricing) include free usage and pause new creation at the limit. Each demo session lasts at most 45 minutes, including preparation. Pro Sandbox usage is billed.

## Import the repository

1. Sign in to [Vercel](https://vercel.com) with GitHub.
2. Select **Add New → Project**, import **eminentcodes/latch**, and use your personal Hobby workspace.
3. Leave **Root Directory** at the repository root. The committed `vercel.json` supplies these settings:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Build Command | `npm run build:vercel` |
| Output Directory | `public` |
| Install Command | `npm ci` |
| Node.js Version | `22.x` |

If GitHub access is not connected yet, use **Adjust GitHub App Permissions** to allow this repository.

The repository's `vercel-build` hook also prepares the compiled session handler and commit metadata before Vercel traces the API Function. Keep this hook when changing build settings.

## Add environment variables

Before clicking **Deploy**, add these for **Production**:

| Variable | Value |
| --- | --- |
| `LATCH_DEMO_ENABLED` | `true` |
| `LATCH_DEMO_ACCESS_CODE` | A private, randomly chosen code of 12-128 characters |
| `LATCH_SESSION_SECRET` | A separate random key of 32-256 characters; keep this owner-only |

Give judges only the access code through your judging instructions. The session key signs the cookie and stays private in Vercel. Keep both values out of GitHub; they are separate from your account credentials. Run `node scripts/create-vercel-settings.mjs` to generate both privately in `.cache/vercel-settings.env`, then copy their values into Vercel.

For **fresh native Kane verification**, also add:

| Variable | Value |
| --- | --- |
| `LATCH_KANE_ENABLED` | `true` |
| `LT_USERNAME` | Your dedicated TestMu/LambdaTest test username |
| `LT_ACCESS_KEY` | Its dedicated access key with available Kane credits |

Without these three native settings, the live quick check still runs Chromium/Playwright and generates actual evidence. Native Kane is explicitly unavailable; the separately labeled recorded Kane proof remains accessible. Each report names the engine that actually ran it.

Enter credentials only in Vercel's environment-variable editor. Do not send keys in chat or copy your local `.testmuai` OAuth folder into the site. [Production Sandbox authentication is automatic through Vercel OIDC](https://vercel.com/docs/sandbox/concepts/authentication); no manual Sandbox token is needed for this GitHub/Vercel setup.

## Deploy and verify

1. Click **Deploy**, wait for production to become ready, then open its `*.vercel.app` URL.
2. Enter your judge code and click **Start live demo**. The first session installs the pinned browser runtime; preparation can take several minutes.
3. Click **Open my live workspace**. Try Morgan's original read and Sam's original update with your own text. Repeat in the repaired app: both return HTTP 403. Avery must still be able to read and edit.
4. Choose **Browser · quick check** and click **Generate fresh before/after proof**. Confirm two original failures, five repaired passes, a new run ID, actual screenshots, matching contract/input hashes, and unchanged stored data for the rejected update.
5. Download the **evidence archive** before the session ends. It contains the generated report, screenshots, observations and SHA-256 manifest. Raw vendor packs and account share links stay private.
6. If native credentials are configured, select **Kane CLI · native verification** and repeat. The previously observed local native comparison took approximately 28 minutes; cloud timing needs verification. A missing result, timeout or tool failure is never a pass.
7. Return to the Vercel website and click **End this session** when finished. You can also stop a session during preparation or after a setup failure.

Each session has isolated apps and a serialized job. The comparison uses a reviewed, policy-only source repair with unchanged fixture mode and expectations; the button performs fresh verification and does not invoke a new coding agent.

## If setup fails

- **Live sessions are not configured:** verify the Production variables and code length, then redeploy. Environment changes apply to new deployments.
- **Code did not match:** enter the exact configured code. It is never included in reports or saved in browser storage.
- **Sandbox request failed:** check **Runtime Logs** for `/api/session`, the project's **Sandboxes** page and remaining Hobby allowance. Use a GitHub deployment of the current published commit.
- **Browser preparation failed:** inspect that Sandbox's command logs. Bootstrap uses managed Node 22/Ubuntu and the pinned Playwright Chromium libraries. End the failed session before retrying.
- **Native Kane incomplete:** verify dedicated username/key validity and available Kane credits in TestMu. The quick check and recorded native proof have distinct engine labels.
- **Preview asks for Vercel sign-in:** use the production URL for judges or adjust deployment protection in Vercel.

The adapter is locally validated. Its actual Vercel Sandbox/browser/native execution must be checked after deployment; no hosted run is claimed before that verification.
