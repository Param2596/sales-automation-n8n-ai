import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REQUIRED_FIELDS, validateLead } from '../scripts/intake/validate.mts';

const validLead = {
  name: ' Paramjot Singh ',
  email: 'paramjot@acme.io',
  company: 'RetroTerminal',
  website: ' https://iristerminal.vercel.app ',
  service: 'MDR',
  message: 'Need 24x7 SOC for 300 endpoints',
};

describe('validateLead', () => {
  it('accepts a complete lead and trims text', () => {
    const result = validateLead(validLead);
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.lead.name, 'Paramjot Singh');
    assert.equal(result.lead.email, 'paramjot@acme.io');
    assert.equal(result.lead.website, 'https://iristerminal.vercel.app');
    assert.deepEqual(result.errors, []);
  });

  it('rejects each missing required field', () => {
    for (const field of REQUIRED_FIELDS) {
      const input = { ...validLead, [field]: '   ' };
      const result = validateLead(input);
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes(`${field} is required`));
    }
  });

  it('rejects a malformed email that is otherwise present', () => {
    const result = validateLead({ ...validLead, email: 'not-an-email' });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ['email is invalid']);
  });

  it('rejects a non-object payload', () => {
    assert.deepEqual(validateLead(null), { valid: false, errors: ['lead must be an object'] });
    assert.deepEqual(validateLead(['name']), { valid: false, errors: ['lead must be an object'] });
  });

  it('defaults optional fields when they are omitted', () => {
    const result = validateLead({
      name: 'Asha Rao',
      email: 'asha@acme.io',
      company: 'Acme',
    });
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.lead.website, '');
    assert.equal(result.lead.service, '');
    assert.equal(result.lead.message, '');
  });
});
