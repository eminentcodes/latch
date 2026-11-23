# Research and prior art

Research collected November 18–22, 2026. Incident reports, documentation and organizer descriptions are observed sources. They establish relevant problems and existing approaches; they do not establish customer demand or independently reproduced competitor performance.

## The user problem

Developers need to check that users can read and change only the resources their permissions allow. A working login or hidden edit button can coexist with a protected endpoint that exposes another workspace's document or accepts a viewer's write.

The [New York Department of Financial Services' First American announcement](https://www.dfs.ny.gov/reports_and_publications/press_releases/pr202311281), published November 28, 2023, describes EaglePro links allowing access to documents belonging to unrelated transactions. DFS announced a $1 million penalty and remediation for the regulatory violations it describes. This is evidence of a concrete access-control failure and consequence; it does not establish a per-document loss or savings from Latch.

[UpGuard's 2021 Power Apps investigation](https://www.upguard.com/breaches/power-apps) reported exposure of 38 million records across 47 notified entities. Enabled OData feeds without the relevant table permissions could expose data anonymously despite an authenticated portal. The report records subsequent changes; it is historical evidence, and exposure does not establish malicious theft.

Primary implementation reports also support both forbidden cases and permitted-user controls:

| Source | Observed finding | Implication |
| --- | --- | --- |
| [Payload #13518](https://github.com/payloadcms/payload/issues/13518) | Missing tenant support in generated folders was reported in 3.52.0 and fixed in 3.53. | Test isolation for each configured resource. This is a resolved bug report. |
| [Payload #13589](https://github.com/payloadcms/payload/issues/13589) | A report describes browser/API tenant-access disagreement. | Check the protected response behind the interface. |
| [Payload #11317](https://github.com/payloadcms/payload/issues/11317) | Legitimate own-profile access was denied under a custom tenant setup. | Denying everyone is a failed repair. |
| [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security#authjwt) | Membership changes in JWT metadata are not reflected until token refresh. | Retained-session removal is a useful future case; documented token behavior is not automatically a provider vulnerability. |
| [OWASP authorization testing guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Testing_Automation_Cheat_Sheet.html) | Recommends formal permissions and automated release checks. | Keep an explicit contract and repeat it after repair. |

[OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) describes unauthorized disclosure and modification from broken object-level authorization. Latch's cross-workspace read and viewer update are controlled examples of these permission risks.

## Existing permission tools

[AuthMatrix](https://github.com/SecurityInnovation/AuthMatrix) and conventional browser tests already implement important permission-testing techniques. Latch does not claim to invent ownership checks or permission matrices. Its concrete additions are a reviewed permission contract, guarded application changes, fixed verification inputs, explicit incomplete states and an inspectable browser report. External-app adapters and retained-session removal remain proposed extensions.

## Confirmed previous Kane winners

The [organizer's recap](https://www.testmuai.com/blog/kane-cli-hackathon-winners/) says the earlier online event ran August 19–31 and received 69 submissions. The recap was refreshed on November 22. These ranks and descriptions come from that recap; they are separate from the current November event.

| Winner | Published demonstration | Relationship to Latch |
| --- | --- | --- |
| **demo.studio — gold**, Sam Felix; [repository](https://github.com/SamFelix03/demo.studio) | A website and brief become a narrated walkthrough. Kane performs the product's browser work and verifies the product itself. | Different product; meaningful Kane work and self-verification are relevant lessons. |
| **GuardianKane — silver**, Abhinav; [linked repository](https://github.com/18Abhinav07/adventures-with-kane) | A coding-agent task tracker gates completion on browser evidence. A checkout bug is caught, repaired and rechecked. | The closest confirmed winner by developer-workflow pattern. |
| **KANE vs. ABLE — bronze**, Christine Lall | Kane fails a browser escape room; the coding agent repairs a circular dependency without changing Kane's objective; Kane then solves it. | A controlled example can provide meaningful evidence when the failure, source repair and unchanged verification are observable. |

These projects were researched through published descriptions. Their behavior was not independently rerun, and resemblance does not predict a winning outcome.

## Current event and feasibility

The [KaneCLI Online Hackathon brief](https://www.kaneclihack.sh/) requires a working flow, meaningful Kane verification and feedback to the coding agent. It allows an old idea with a fresh codebase. The deadline is November 26 at 23:59 IST, **19:29 WAT**. A public repository, a YouTube demo and two public posts are submission deliverables; a deployed URL is optional.

Latch uses a fresh TypeScript/Node codebase, Zod contracts, real browser requests, source-hash-bound patches, Kane evidence and GitHub Actions. [Kane documentation](https://www.testmuai.com/support/docs/kane-cli-introduction/) and the [upstream repository](https://github.com/LambdaTest/kane-cli) support the chosen browser/evidence approach. Feasibility is demonstrated by this repository's actual tests and recorded native runs, rather than inferred solely from documentation.

The observed proof covers the bundled application's five declared cases. It establishes neither exhaustive security coverage nor willingness to pay. See the [judge guide](judge-guide.md) to reproduce the implemented behavior.
