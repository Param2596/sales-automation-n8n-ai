# sales-automation-n8n-ai

![CI](https://github.com/Param2596/sales-automation-n8n-ai/actions/workflows/ci.yml/badge.svg)

Lead intake for a cybersecurity MSSP sales team. A prospect submits a service interest (SOC, MDR, EDR, DLP, Email Security, Pentest, Incident Response). n8n accepts the lead on an authenticated webhook, validates it, creates a Salesforce Lead through the REST API, and maps every Salesforce outcome to a clear HTTP response.

Verified end to end against a Salesforce Developer Edition org: valid leads are created (201), duplicates are blocked (409), invalid input is rejected before any API call (400), and bad keys are refused (403).

## Screenshots

<!-- Replace the file names below with the images you added in docs/ -->
![n8n workflow](docs/workflow.png)
![Lead created in Salesforce](docs/salesforce-lead.png)

## Architecture

```mermaid
flowchart LR
  A[web/form.html, Postman, or send-test-lead.ps1] -->|POST JSON + X_API_KEY| B[n8n Webhook /webhook/lead]
  B -->|wrong or missing key| X[403]
  B --> C[Code node: validate + normalize]
  C --> D{valid?}
  D -->|no| E[400 validation_failed]
  D -->|yes| F["POST /services/data/v66.0/sobjects/Lead"]
  F -->|success| G[201 leadId]
  F -->|error output| S{Switch on Salesforce error}
  S -->|DUPLICATES_DETECTED| H[409 duplicate_lead]
  S -->|status 400| I[422 salesforce_rejected]
  S -->|status 401| J[502 upstream_auth_failed]
  S -->|fallback| K[502 upstream_error]
```

## API responses

| Status | When | Body |
|---|---|---|
| 201 | Lead created in Salesforce | `{ "success": true, "leadId": "00Q..." }` |
| 400 | Missing name, email, or company, or invalid email | `{ "success": false, "error": "validation_failed", "details": [...] }` |
| 403 | Missing or wrong `X_API_KEY` header | rejected by n8n before the workflow runs |
| 409 | A lead with this email already exists (Salesforce duplicate rule) | `{ "success": false, "error": "duplicate_lead" }` |
| 422 | Malformed JSON (n8n body parser), or Salesforce rejected the data | `{ "success": false, "error": "salesforce_rejected" }` |
| 502 | Salesforce auth failure or any other upstream error | `{ "success": false, "error": "upstream_error" }` |

4xx means the caller must fix the request. 5xx means the request was fine and the failure is upstream, so it is safe to retry later. Raw Salesforce error details are not passed back to the caller.

## What's in the repo

| Piece | Where | Behavior |
|---|---|---|
| Lead form | `web/form.html` | POSTs JSON to `http://localhost:5678/webhook/lead` with header `X_API_KEY` from a password field |
| Intake workflow | `workflows/WF-01-intake.json` | Header auth, validation, IF, Salesforce create, Switch-based error mapping, one Respond node per outcome |
| CLI test lead | `scripts/cli/send-test-lead.ps1` | Reads `INTAKE_KEY` from the environment or `.env` and sends the same header |
| Salesforce token client | `scripts/salesforce/auth.mts` | OAuth 2.0 client-credentials token fetch, cached in memory |
| Lead validation | `scripts/intake/validate.mts` and the workflow Code node | Required fields plus an email format check; email is trimmed and lowercased |
| Tests | `tests/` and `.github/workflows/ci.yml` | `node:test` against local mocks. No live Salesforce or n8n |

## Run it locally

Windows PowerShell. Chain commands with `;`.

```powershell
Copy-Item .env.example .env ; npm ci
```

Fill `.env` before you call Salesforce or the webhook. Names are in `.env.example`. Values stay on your machine.

1. Start n8n: `npx n8n` (UI at `http://localhost:5678`). Current n8n needs Node.js 24 or newer. `npm test` runs on Node.js 22 or newer and does not start n8n.
2. Import `workflows/WF-01-intake.json`. It imports inactive.
3. Create a Header Auth credential named `X_API_KEY`. Header name: `X_API_KEY`. Value: the same string as `INTAKE_KEY`.
4. Create a generic **OAuth2 API** credential with grant type **Client Credentials**. Steps are in [docs/salesforce-setup.md](docs/salesforce-setup.md).
5. Open the HTTP Request node, attach that credential, and replace `your-org` in the URL with your My Domain host.
6. Attach `X_API_KEY` to the Webhook node if import left it unset, then publish or activate the workflow.

Send a test lead:

```powershell
.\scripts\cli\send-test-lead.ps1
```

Run the tests:

```powershell
npm test
```

## Design decisions

- **Header auth on the webhook.** The intake URL is reachable by anyone who learns it, so the Webhook node requires `X_API_KEY`. A missing or wrong key gets 403 and nothing else runs.
- **Validate at the edge.** Bad input is rejected with 400 before it costs a Salesforce API call. Salesforce validation stays as a safety net.
- **Switch for error mapping.** The HTTP Request node uses its error output. A Switch maps Salesforce failures to caller-facing codes. The duplicate rule is checked first because Salesforce reports duplicates as a generic 400. Adding a new error case is one more rule.
- **Client Credentials for Salesforce.** The org requires PKCE on the authorization-code flow, which n8n's built-in Salesforce credential does not support. The workflow uses generic OAuth2 Client Credentials against an External Client App with a Run As user and the `api` scope. The token URL is the My Domain host.
- **Secrets stay out of git.** The webhook key and Salesforce consumer secret live in the n8n credential store and in `.env`. The workflow export names credentials without their values. `.env` is gitignored.

## Security

- The committed form contains no key. A deployed form should keep the key on the server.
- `scripts/salesforce/auth.mts` prints `instance_url` only, never the token.
- The Salesforce host in the committed workflow is a placeholder.
- CI has no Salesforce, n8n, or LLM credentials.
