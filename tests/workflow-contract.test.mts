import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { EMAIL_PATTERN, REQUIRED_FIELDS } from '../scripts/intake/validate.mts';

const root = join(import.meta.dirname, '..');
const workflowPath = join(root, 'workflows', 'WF-01-intake.json');
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8')) as {
  active: boolean;
  nodes: Array<{
    name: string;
    type: string;
    parameters: Record<string, unknown>;
    credentials?: Record<string, { id?: string; name?: string }>;
  }>;
  connections: Record<string, { main: Array<Array<{ node: string }>> }>;
};

function node(name: string) {
  const found = workflow.nodes.find((item) => item.name === name);
  assert.ok(found, `missing node ${name}`);
  return found;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.n8n') continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

describe('WF-01 intake export', () => {
  it('authenticates the webhook with a named header credential and no secret', () => {
    const webhook = node('Webhook');
    assert.equal(webhook.parameters.authentication, 'headerAuth');
    assert.equal(webhook.parameters.httpMethod, 'POST');
    assert.equal(webhook.parameters.path, 'lead');
    assert.equal(webhook.parameters.responseMode, 'responseNode');
    assert.deepEqual(webhook.credentials?.httpHeaderAuth, { id: '', name: 'X_API_KEY' });
  });

  it('validates required fields, then routes valid leads to Salesforce and invalid leads to 400', () => {
    const validate = node('Validate lead');
    const code = String(validate.parameters.jsCode);
    assert.match(code, /const field of \['name', 'email', 'company'\]/);
    assert.match(code, /\$\{field\} is required/);
    assert.ok(code.includes(EMAIL_PATTERN.source));
    assert.match(code, /email is invalid/);
    assert.deepEqual([...REQUIRED_FIELDS], ['name', 'email', 'company']);

    const gate = node('Valid?');
    const conditions = gate.parameters.conditions as {
      conditions: Array<{ leftValue: string; operator: { type: string; operation: string } }>;
    };
    assert.equal(conditions.conditions[0].leftValue, '={{ $json.valid }}');
    assert.equal(conditions.conditions[0].operator.operation, 'true');

    assert.equal(workflow.connections['Valid?'].main[0][0].node, 'Create Salesforce Lead');
    assert.equal(workflow.connections['Valid?'].main[1][0].node, 'Respond 400');

    const rejected = node('Respond 400');
    assert.equal(rejected.parameters.respondWith, 'json');
    assert.equal((rejected.parameters.options as { responseCode: number }).responseCode, 400);
    assert.match(String(rejected.parameters.responseBody), /valid: false/);
  });

  it('posts a Lead to the placeholder Salesforce host with the expected fields', () => {
    const create = node('Create Salesforce Lead');
    assert.equal(create.parameters.method, 'POST');
    assert.equal(
      create.parameters.url,
      'https://your-org.my.salesforce.com/services/data/v66.0/sobjects/Lead',
    );
    assert.equal(create.parameters.genericAuthType, 'oAuth2Api');
    assert.deepEqual(create.credentials?.oAuth2Api, {
      id: '',
      name: 'Salesforce Client Credentials',
    });

    const body = String(create.parameters.jsonBody);
    for (const field of ['LastName', 'Company', 'Email', 'Website', 'LeadSource', 'Description']) {
      assert.match(body, new RegExp(field));
    }
    assert.match(body, /LeadSource: 'Web'/);

    const accepted = node('Respond 201');
    assert.equal((accepted.parameters.options as { responseCode: number }).responseCode, 201);
    assert.equal(workflow.connections['Create Salesforce Lead'].main[0][0].node, 'Respond 201');
  });

  it('ships inactive so import does not activate it before credentials are attached', () => {
    assert.equal(workflow.active, false);
  });
});

describe('committed files', () => {
  it('keeps secret material out of the tree and leaves .env.example blank', () => {
    const patterns = [
      /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/,
      /sk-[A-Za-z0-9]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /^(?:export\s+)?(?:SF_CLIENT_SECRET|SF_CLIENT_ID|INTAKE_KEY)=\S+/m,
      /"access_token"\s*:\s*"(?!mock-access-token)[^"]+"/,
    ];

    const offenders: string[] = [];
    for (const file of walk(root)) {
      const rel = relative(root, file);
      if (rel === '.env' || rel.startsWith('coverage/') || rel.startsWith('reports/')) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(text)) offenders.push(`${rel} matched ${pattern}`);
      }
    }
    assert.deepEqual(offenders, []);

    const example = readFileSync(join(root, '.env.example'), 'utf8');
    for (const line of example.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      assert.ok(eq > 0, `expected NAME= in .env.example, got ${trimmed}`);
      assert.equal(trimmed.slice(eq + 1).trim(), '');
    }

    const form = readFileSync(join(root, 'web/form.html'), 'utf8');
    assert.equal(form.includes('dev-only-key'), false);
    assert.doesNotMatch(form, /const API_KEY/);
    assert.match(form, /type="password"/);
    assert.match(form, /URLSearchParams/);
    assert.match(form, /X_API_KEY/);

    const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
    for (const entry of ['.env', 'node_modules/', '.n8n/', 'reports/']) {
      assert.match(ignore, new RegExp(entry.replace(/[./]/g, '\\$&')));
    }
  });
});
