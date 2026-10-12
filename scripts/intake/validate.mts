import { z } from 'zod';

// The n8n Code node repeats the required-field rules inline. n8n does not load
// this package. Email format is enforced here and covered by tests.
export const REQUIRED_FIELDS = ['name', 'email', 'company'] as const;

const requiredText = (field: string) =>
  z
    .string({ error: `${field} is required` })
    .trim()
    .min(1, { error: `${field} is required` });

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' ? value : ''),
  z.string().trim(),
);

export const leadSchema = z.object({
  name: requiredText('name'),
  email: requiredText('email').pipe(z.email({ error: 'email is invalid' })),
  company: requiredText('company'),
  website: optionalText,
  service: optionalText,
  message: optionalText,
});

export type Lead = z.infer<typeof leadSchema>;

export type ValidationResult =
  | { valid: true; lead: Lead; errors: [] }
  | { valid: false; errors: string[] };

export function validateLead(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['lead must be an object'] };
  }

  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => issue.message);
    return { valid: false, errors: errors.length > 0 ? errors : ['invalid lead'] };
  }

  return { valid: true, lead: parsed.data, errors: [] };
}
