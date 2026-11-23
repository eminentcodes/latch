Repair the application permission enforcement identified by Latch.

Allowed application files: demo/policy.ts.
Contract SHA-256: 779893089565b286f123c9f83a4b29053b59510bcf93a5baa2a096a9236d48c2.
Fixture mode for repeat verification: vulnerable.

[
  {
    "rule": {
      "id": "other-read",
      "actor": "other",
      "resource": "launch-plan",
      "action": "read",
      "expect": "deny"
    },
    "reason": "Another user received the protected document.",
    "observation": {
      "caseTag": "23eaa89a-f3fe-4d0c-adde-6baddf31b463-other-read",
      "actor": "other",
      "resource": "launch-plan",
      "action": "read",
      "status": 200,
      "disclosed": true,
      "beforeHash": "9c1936e585409b00f478e7932b32990b780a788a1d5bdfecc507f1b48577741b",
      "afterHash": "9c1936e585409b00f478e7932b32990b780a788a1d5bdfecc507f1b48577741b",
      "at": "2026-11-22T22:06:52.215Z"
    },
    "screenshots": [
      "artifacts/latch-before/cases/other-read/screenshots/step-7-0.jpg",
      "artifacts/latch-before/cases/other-read/screenshots/step-6-1.jpg",
      "artifacts/latch-before/cases/other-read/screenshots/step-5-2.jpg",
      "artifacts/latch-before/cases/other-read/screenshots/step-4-3.jpg",
      "artifacts/latch-before/cases/other-read/screenshots/step-3-4.jpg",
      "artifacts/latch-before/cases/other-read/screenshots/step-2-5.jpg",
      "artifacts/latch-before/cases/other-read/screenshots/step-1-6.jpg"
    ]
  },
  {
    "rule": {
      "id": "viewer-update",
      "actor": "viewer",
      "resource": "launch-plan",
      "action": "update",
      "expect": "deny"
    },
    "reason": "A forbidden update changed the protected document.",
    "observation": {
      "caseTag": "23eaa89a-f3fe-4d0c-adde-6baddf31b463-viewer-update",
      "actor": "viewer",
      "resource": "launch-plan",
      "action": "update",
      "status": 200,
      "disclosed": false,
      "beforeHash": "9c1936e585409b00f478e7932b32990b780a788a1d5bdfecc507f1b48577741b",
      "afterHash": "5fd897372020c2018659232b558a45a932626899b68222ced88928f7dfccb3a9",
      "at": "2026-11-22T22:15:17.598Z"
    },
    "screenshots": [
      "artifacts/latch-before/cases/viewer-update/screenshots/step-9-0.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-8-1.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-7-2.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-6-3.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-5-4.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-4-5.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-3-6.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-2-7.jpg",
      "artifacts/latch-before/cases/viewer-update/screenshots/step-1-8.jpg"
    ]
  }
]

Change only the allowed application files. Preserve all permission expectations, legitimate-user controls, identity bindings, fixtures, observers, scenarios, and verifier code. Do not change tests, commands, build configuration, or dependencies. Do not commit, push, publish, contact services, or modify account credentials. Fix enforcement rather than hiding the affected interface. The same browser cases will be run again; blocking all users is a failed repair.
