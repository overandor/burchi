# Registrar Credential Pipeline Specification

**Status:** Governing. This document is the authoritative specification for the
registrar's credential acquisition, rotation, and revocation pipeline. Code
that diverges from this spec is a bug.

## 1. Objective

A credential pipeline that runs without human interaction from authentication
handoff through key acquisition, verification, encrypted storage, rotation,
and revocation — **only where the platform officially permits automation**.
The system fails closed on platforms that require interactive challenges
rather than circumventing them.

## 2. Permitted Mechanisms (in priority order)

1. Official API-based key creation and rotation.
2. OAuth or other documented machine-to-machine authorization flows.
3. Service accounts, workload identities, or platform-issued automation
   credentials.
4. Authenticated browser automation using an existing valid session **only
   when no supported API is available**.

The pipeline must never invent undocumented endpoints, reverse-engineer
private credential APIs, or report success unless the credential was actually
observed and captured through a supported flow.

## 3. CAPTCHA and Anti-Automation Challenges

The system **does not** bypass, defeat, solve, or circumvent CAPTCHA or
equivalent anti-bot protections.

If a platform requires CAPTCHA during signup, login, key creation, rotation,
or revocation, that path is **incompatible** with unattended automation
unless the platform provides an official automation-safe alternative.

The pipeline must detect CAPTCHA/challenge states and terminate that platform
operation with a structured failure:

```
AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE
```

The failure is recorded in the audit trail **without exposing credentials or
sensitive session data**.

Platforms requiring interactive CAPTCHA are excluded from automated
provisioning unless they expose a documented API, service-account mechanism,
OAuth flow, enterprise automation path, or other explicitly supported
non-interactive method.

## 4. Authentication Session Handling

The rotator accepts authenticated session state (`existingCookies`) and
injects it into the browser before navigating to the credential-management
page.

The pipeline connects authentication producers directly to credential
acquisition consumers. Where the signup/auth component establishes a reusable
session, it exports that session state through an **encrypted internal
handoff** rather than requiring manual browser interaction.

Session material must:

- remain encrypted at rest and in transit;
- never be written to plaintext logs;
- be scoped to the intended platform;
- carry an expiration time where available;
- be destroyed when no longer required.

## 5. Post-Navigation State Classification

The browser automation layer explicitly detects authentication redirects and
challenge pages instead of relying only on missing selectors. After
navigation, the pipeline classifies the resulting state as exactly one of:

| State | Meaning |
| --- | --- |
| `AUTHENTICATED` | Session is valid and the credential UI is reachable. |
| `LOGIN_REQUIRED` | Redirected to a login/sign-in/auth page; session invalid or absent. |
| `INTERACTIVE_CHALLENGE_REQUIRED` | A CAPTCHA, MFA approval, or equivalent interactive challenge is present. |
| `CREDENTIAL_UI_AVAILABLE` | The credential-management UI is present and operable. |
| `CREDENTIAL_UI_UNAVAILABLE` | Page loaded but the expected credential UI elements are missing. |
| `PLATFORM_FLOW_CHANGED` | The page structure no longer matches the configured selectors (flow drift). |

A login redirect or expired session returns an authentication failure, not a
generic selector error.

## 6. Credential Acquisition

- Use documented platform APIs whenever available.
- When no documented creation API exists, use authenticated UI automation
  against the configured platform credential page.
- Never invent undocumented endpoints, reverse-engineer private credential
  APIs, or report successful key creation unless the credential was actually
  observed and captured through the supported flow.

## 7. Verification

Every newly acquired credential is verified before it becomes active.

Pipeline order:

```
authenticate → acquire → verify → encrypt/store → activate → revoke previous
```

A failed verification prevents activation and leaves the existing working
credential untouched.

## 8. Secret Handling

Plaintext credential values exist in memory only for the minimum time required
to verify and encrypt them.

Plaintext secrets must **never** be:

- written to application logs;
- written to audit logs;
- returned from normal listing APIs;
- included in error messages;
- stored unencrypted on disk;
- persisted in browser traces, screenshots, or debugging artifacts.

Stored credentials are encrypted at rest using application-controlled key
management.

## 9. Rotation Safety

The system **never** revokes the current credential before the replacement
has been successfully acquired, verified, encrypted, stored, and activated.

Required order:

```
acquire → verify → store → activate → revoke
```

If a platform supports only one active credential and cannot safely create a
replacement before revoking the existing one, unattended rotation is disabled
for that platform unless the platform provides an atomic or officially
supported replacement mechanism.

## 10. Revocation

- Revocation via UI automation is best-effort only.
- The system **never** fabricates successful revocation.
- If the previous credential cannot be reliably identified or removed, the new
  credential remains active and the operation records a structured revocation
  failure.
- Platforms requiring guaranteed unattended revocation should use documented
  revocation APIs or another platform-supported machine interface.

## 11. End-to-End Automation Qualification

A platform qualifies for the zero-human pipeline only when **every** required
stage can execute through supported non-interactive mechanisms:

```
provision/authenticate → obtain session/machine identity → acquire credential
→ verify → encrypt/store → activate → rotate → revoke → audit
```

A platform that introduces mandatory CAPTCHA, MFA approval, email
confirmation requiring user action, consent screens requiring manual
approval, hardware-key interaction, or another unavoidable interactive
challenge does **not** qualify for unattended operation unless it supplies an
official automation-compatible alternative.

The system fails closed in those cases.

## 12. Auditability

Every stage emits structured operational events **without secret values**.

Audit outcomes:

| Outcome | Meaning |
| --- | --- |
| `SUCCESS` | Stage completed. |
| `AUTHENTICATION_REQUIRED` | No valid session; login needed. |
| `INTERACTIVE_CHALLENGE_REQUIRED` | CAPTCHA/MFA/etc. blocked the path. |
| `ACQUISITION_FAILED` | Credential could not be acquired. |
| `VERIFICATION_FAILED` | Credential acquired but failed verification. |
| `STORAGE_FAILED` | Encryption/storage error. |
| `ROTATION_BLOCKED` | Rotation not permitted (e.g. single-key platform). |
| `REVOCATION_FAILED` | Old credential could not be revoked. |
| `PLATFORM_FLOW_CHANGED` | Selectors no longer match the page. |

## 13. Non-Negotiable Invariants

- No CAPTCHA bypass, ever.
- No fabricated success, ever.
- No plaintext secrets in logs, audit, API responses, or error messages.
- No revocation before a verified, stored, activated replacement exists.
- Fail closed on interactive challenges.
