### Latch: passed

Engine: Kane CLI. Tested revision: uncommitted working tree.

| Check | Expected | Result | Protected response |
| --- | --- | --- | --- |
| owner-read | allow | passed | HTTP 200 |
| other-read | deny | passed | HTTP 403 |
| viewer-read | allow | passed | HTTP 200 |
| owner-update | allow | passed | HTTP 200 |
| viewer-update | deny | passed | HTTP 403 |

Contract SHA-256: `779893089565b286f123c9f83a4b29053b59510bcf93a5baa2a096a9236d48c2`.

Repair: reviewed local patch. Application: isolated candidate.

- demo/policy.ts: `632b0d1fb28ca7544dff2d42b2140c375feaacade3f7da5081c1ef8ea542ca25` → `4b0facd079272d5349b4ef25a6bb59a854ab1e157c84fa00b54175f2af602f5b`
