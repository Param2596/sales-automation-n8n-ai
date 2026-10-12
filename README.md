# sales-automation-n8n-ai

![CI](https://github.com/Param2596/sales-automation-n8n-ai/actions/workflows/ci.yml/badge.svg)

Lead intake for a cybersecurity MSSP sales team. A prospect submits a service interest (SOC, MDR, EDR, DLP, Email Security, Pentest, Incident Response). n8n accepts the lead on an authenticated webhook, checks the required fields, and creates a Salesforce Lead through the REST API.

This is the working slice of that pipeline. Scoring, routing, alerts, and the rest of the build guide are listed under Roadmap and are not in the repo yet.

## Architecture

```mermaid
flowchart LR
  A[web/form.html or send-test-lead.ps1] -->|POST JSON + X_API_KEY| B[n8n Webhook /webhook/lead]
  B --> C[Validate name, email, company]
  C --> D{valid?}
  D -->|no| E[Respond 400]
  D -->|yes| F["POST /services/data/v66.0/sobjects/Lead"]
  F --> G[Respond 201]
  F -.-> H[LLM scoring, dedupe, Slack]
```

Solid lines are in `workflows/WF-01-intake.json`. The dashed step is roadmap.

## What works today

| Piece | Where | Behavior |
|---|---|---|
| Lead form | `web/form.html` | POSTs JSON to `http://localhost:5678/webhook/lead` with header `X_API_KEY` from the password field. `?key=` can prefill that field |
| Intake workflow | `workflows/WF-01-intake.json` | Header Auth, validate, IF on `$json.valid`, 400 or Salesforce create, then 201 |
| CLI test lead | `scripts/cli/send-test-lead.ps1` | Reads `INTAKE_KEY` from the environment or `.env` and sends the same header |
| Salesforce token client | `scripts/salesforce/auth.mts` | OAuth 2.0 client-credentials token fetch, cached in memory |
| Lead validation | `scripts/intake/validate.mts` and the workflow Code node | Required name, email, and company, plus the same basic email format check |
| Tests | `tests/` and `.github/workflows/ci.yml` | `node:test` against local mocks. No live Salesforce or n8n |

A lead missing name, email, or company, or with an email that fails that format check, returns 400 and is not sent to Salesforce. CI covers the check in `validate.mts`, and the workflow Code node uses the same pattern.

A failed Salesforce call does not yet return a formatted error body. The execution fails, and the error-workflow path is roadmap.

## Run it locally

Windows PowerShell. Chain commands with `;`.

```powershell
Copy-Item .env.example .env ; npm ci
```

Fill `.env` before you call Salesforce or the webhook. Names are in `.env.example`. Values stay on your machine.

1. Start n8n: `npx n8n` (UI at `http://localhost:5678`). Current n8n (2.42) needs Node.js 24 or newer. `npm test` runs on Node.js 22 or newer and does not start n8n.
2. Import `workflows/WF-01-intake.json`. It imports inactive.
3. Create a Header Auth credential named `X_API_KEY`. Header name: `X_API_KEY`. Value: the same string as `INTAKE_KEY`.
4. Create an OAuth2 API credential named `Salesforce Client Credentials`. Steps are in [docs/salesforce-setup.md](docs/salesforce-setup.md).
5. Open **Create Salesforce Lead**. Attach that credential and replace `your-org` in the URL with your My Domain host.
6. Attach `X_API_KEY` to the Webhook node if import left it unset. Activate the workflow.
7. If the browser blocks the form, set the Webhook node's Allowed Origins to `*` for local use.

Send a test lead:

```powershell
.\scripts\cli\send-test-lead.ps1
```

The script reads `.env` and does not override variables already set in the session. Or open `web/form.html`, enter that same key in the API key field, and submit. `?key=` on the page URL prefills the field for a local session. Keep that value out of git and out of any URL you share.

Check the token client without printing the access token:

```powershell
npm run salesforce:token
```

Run the tests:

```powershell
npm test
```

## Layout

```
workflows/WF-01-intake.json    n8n export
web/form.html                  local intake form
scripts/cli/send-test-lead.ps1 authenticated test POST
scripts/salesforce/auth.mts    client-credentials token fetch
scripts/intake/validate.mts   lead check shared with the workflow
tests/                         node:test, mocks only
docs/salesforce-setup.md       External Client App and n8n credential
.env.example                   variable names, empty values
```

## Design decisions

- **Header auth on the webhook.** The intake URL is reachable by anyone who learns it. The Webhook node requires header `X_API_KEY`. With that credential attached, n8n answers 403 when the header is missing or wrong, and the rest of the workflow does not run. With no credential selected, n8n answers 500.
- **Validate before the CRM write.** The IF node sends `$json.valid === false` to **Respond 400** with the error list. Salesforce is only on the true branch.
- **Client Credentials for Salesforce.** This org requires PKCE on the authorization-code flow, and n8n's built-in Salesforce OAuth credential does not support PKCE. The HTTP Request node uses generic OAuth2 Client Credentials against an External Client App, acting as that app's Run As user. The token URL is the My Domain, and the credential sends the client id and secret in the body.
- **Secrets stay out of git.** Webhook key and Salesforce consumer secret live in the n8n credential store and in `.env`. The workflow export names those credentials and does not contain their values. `.env` is gitignored.

## Security

- The form reads the webhook key from a password field. `?key=` only prefills that field in the browser. The committed page has no key. A page you deploy should keep the key on the server.
- `scripts/salesforce/auth.mts` prints `instance_url` only.
- The Salesforce host in the workflow is `your-org.my.salesforce.com`. Put the real My Domain on your machine after import.
- CI has no Salesforce, n8n, or LLM credentials. Tests point the token client at `127.0.0.1`.
