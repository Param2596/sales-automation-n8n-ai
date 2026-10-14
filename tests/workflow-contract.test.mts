import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

type Node = {
  name: string;
  type: string;
  parameters: Record<string, any>;
  credentials?: Record<string, { id?: string; name?: string }>;
};

const root = join(import.meta.dirname, '..');
const workflow = JSON.parse(
  readFileSync(join(root, 'workflows', 'WF-01-intake.json'), 'utf8'),
) as {
  active: boolean;
  nodes: Node[];
  connections: Record<string, { main: Array<Array<{ node: string }>> }>;
};

function node(name: string): Node {
  const found = workflow.nodes.find((item) => item.name === name);
  assert.ok(found, `missing node ${name}`);
  return found;
}

function next(from: string, output: number): string {
  return workflow.connections[from].main[output][0].node;
}

function status(name: string): number {
  return node(name).parameters.options.responseCode;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.n8n') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

const SF_BASE = 'https://your-org.my.salesforce.com/services/data/v66.0/sobjects/Lead';

describe('WF-01 intake export', () => {
  it('exposes POST and PATCH on /lead behind header auth', () => {
    const webhook = node('Webhook');
    assert.equal(webhook.parameters.authentication, 'headerAuth');
    assert.deepEqual(webhook.parameters.httpMethod, ['POST', 'PATCH']);
    assert.equal(webhook.parameters.path, 'lead');
    assert.equal(webhook.parameters.responseMode, 'responseNode');
    assert.equal(webhook.credentials?.httpHeaderAuth?.id, '');
    assert.equal(next('Webhook', 0), 'check_valid_fields');
    assert.equal(next('Webhook', 1), 'check_valid_fields1');
  });

  it('POST validates required fields and email before Salesforce', () => {
    const code = String(node('check_valid_fields').parameters.jsCode);
    assert.match(code, /\['name', 'email', 'company'\]/);
    assert.match(code, /is required/);
    assert.match(code, /email is invalid/);
    assert.equal(next('if json is valid', 0), 'salesforce_POST');
    assert.equal(next('if json is valid', 1), 'validation_failed');
    assert.equal(status('validation_failed'), 400);
  });

  it('POST creates a Lead and maps Salesforce errors to client-safe codes', () => {
    const create = node('salesforce_POST');
    assert.equal(create.parameters.method, 'POST');
    assert.equal(create.parameters.url, SF_BASE);
    assert.equal(create.parameters.genericAuthType, 'oAuth2Api');
    assert.equal(create.credentials?.oAuth2Api?.id, '');
    for (const field of ['LastName', 'Company', 'Email']) {
      assert.match(String(create.parameters.jsonBody), new RegExp(field));
    }
    assert.equal(next('salesforce_POST', 0), 'success_new_resource');
    assert.equal(status('success_new_resource'), 201);
    assert.equal(next('salesforce_POST', 1), 'Switch');

    const outputs = ['duplicate (409)', 'bad_request (400)', 'auth(401)', 'fallback'];
    const codes = [409, 422, 502, 502];
    outputs.forEach((name, i) => {
      assert.equal(next('Switch', i), name);
      assert.equal(status(name), codes[i]);
    });
  });

  it('PATCH updates only allow-listed fields on a valid lead id', () => {
    const code = String(node('check_valid_fields1').parameters.jsCode);
    assert.match(code, /b\.id/);
    assert.match(code, /\['Title','Phone','Company','Status'\]/);
    assert.match(code, /invalid lead id/);
    assert.match(code, /no updatable fields/);

    assert.equal(next('if json is valid1', 0), 'salesforce_PATCH');
    assert.equal(next('if json is valid1', 1), 'json_fail');
    assert.equal(status('json_fail'), 400);

    const patch = node('salesforce_PATCH');
    assert.equal(patch.parameters.method, 'PATCH');
    assert.equal(patch.parameters.url, `=${SF_BASE}/{{ $json.id }}`);
    assert.equal(patch.parameters.jsonBody, '={{ JSON.stringify($json.fields) }}');
    assert.equal(next('salesforce_PATCH', 0), 'patch_resource');
    assert.equal(status('patch_resource'), 200);
    assert.equal(next('salesforce_PATCH', 1), 'salesforce_error');
    assert.equal(status('salesforce_error'), 502);
  });

  it('never returns raw upstream errors to the client', () => {
    for (const name of ['duplicate (409)', 'bad_request (400)', 'auth(401)', 'fallback', 'salesforce_error']) {
      assert.equal(node(name).parameters.respondWith, 'json', `${name} must return a fixed JSON body`);
    }
  });

  it('ships inactive with no org host or credential ids', () => {
    assert.equal(workflow.active, false);
    const text = JSON.stringify(workflow);
    assert.doesNotMatch(text, /develop\.my\.salesforce\.com/);
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
