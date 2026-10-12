# Salesforce setup

WF-01 creates a Lead with the Salesforce REST API. n8n sends the request with a generic **OAuth2 API** credential, grant type **Client Credentials**. `scripts/salesforce/auth.mts` performs the same token request. CI exercises that script against a local mock and does not call Salesforce.

## Why Client Credentials

This org requires PKCE on the authorization-code flow. n8n's built-in Salesforce OAuth credential has no PKCE support, so that login fails. Client Credentials is server-to-server: the External Client App's **Run As** user is the integration identity, and there is no browser login.

Use an **External Client App**. As of Spring '26, Salesforce restricts creating new Connected Apps and points new integrations at External Client Apps.

## External Client App

1. Setup, Quick Find **External Client App Manager**, New External Client App.
2. Name: `AI Lead Qualifier`. Distribution state: **Local**. Contact email: yours.
3. Enable OAuth.
4. Callback URL: `https://localhost/callback`. The form requires a URL. Client Credentials does not redirect there.
5. OAuth scope: **Manage user data via APIs (`api`)**.
6. Flow enablement: **Enable Client Credentials Flow**.
7. Save, then **Edit Policies**. Enable the Client Credentials flow and set **Run As** to the integration user. In a personal Developer Edition org, your admin user is enough to prove the path. The Run As user's permissions are the ceiling for every API call.
8. Open Consumer Key and Secret. Put the key in `SF_CLIENT_ID` and the secret in `SF_CLIENT_SECRET` inside `.env`. New apps can take a few minutes before the first token call succeeds.

## Token request

Send the token request to your My Domain. `login.salesforce.com` does not issue client-credentials tokens.

`POST https://your-org.my.salesforce.com/services/oauth2/token`

Form body:

- `grant_type=client_credentials`
- `client_id`
- `client_secret`

The response includes `access_token` and `instance_url`. Later calls go to `instance_url` with `Authorization: Bearer <access_token>`.

List versions with `GET <instance_url>/services/data/`. The workflow calls `/services/data/v66.0/sobjects/Lead`. If your org's latest version is different, change that path on the HTTP Request node and set `SF_API_VERSION` in `.env`.

Confirm the Lead describe response lists `LastName` and `Company` as required before you rely on the mapping.

## n8n credential

Create an **OAuth2 API** credential and name it exactly `Salesforce Client Credentials`.

| Field | Value |
|---|---|
| Grant Type | Client Credentials |
| Access Token URL | `https://your-org.my.salesforce.com/services/oauth2/token` |
| Client ID | consumer key |
| Client Secret | consumer secret |
| Authentication | **Body** |
| Scope | empty |

n8n defaults Authentication to Header (HTTP Basic). Salesforce expects the client id and secret in the body for this flow, so switch it to Body.

After importing `workflows/WF-01-intake.json`, open **Create Salesforce Lead**, select this credential, and replace `your-org` in the URL with your My Domain host. The repo keeps that host as a placeholder.

## Lead body

`POST /services/data/v66.0/sobjects/Lead`

| Salesforce field | Source |
|---|---|
| `LastName` | form `name` |
| `Company` | form `company` |
| `Email` | form `email` |
| `Website` | form `website` when it is non-empty |
| `LeadSource` | `Web` |
| `Description` | form `service` and `message`, joined with a newline |

The webhook returns 400 when name, email, or company is missing, so those requests never reach Salesforce.

## Check the token locally

```powershell
Copy-Item .env.example .env ; node --experimental-strip-types scripts/salesforce/auth.mts
```

Fill `SF_MY_DOMAIN`, `SF_CLIENT_ID`, and `SF_CLIENT_SECRET` in `.env` first. The script prints `instance_url` and does not print the access token.
