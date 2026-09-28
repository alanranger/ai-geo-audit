import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIdOnlySchemaReference,
  evaluateTypedSchemaTypeGroup,
  shouldEvaluateQaTypeForTier,
  buildSchemaQaGate
} from '../lib/schema-qa-gate.js';

const workshopUrl = 'https://www.alanranger.com/photo-workshops-uk/peak-district-photography-workshop';
const blogUrl = 'https://www.alanranger.com/blog-on-photography/some-post';

test('isIdOnlySchemaReference: pure @id (+ optional @type) is a reference', () => {
  assert.equal(isIdOnlySchemaReference({ '@id': 'https://example.com/#service' }), true);
  assert.equal(isIdOnlySchemaReference({ '@type': 'Service', '@id': 'https://example.com/#service' }), true);
  assert.equal(
    isIdOnlySchemaReference({
      '@type': 'Service',
      '@id': 'https://example.com/#service',
      name: 'Workshops'
    }),
    false
  );
});

test('evaluateTypedSchemaTypeGroup: complete Service + incomplete Service both scored (no masking)', () => {
  const issues = evaluateTypedSchemaTypeGroup('Service', [
    {
      '@type': 'Service',
      '@id': 'https://www.alanranger.com/#service-good',
      name: 'Photography workshops',
      provider: { '@type': 'Organization', name: 'Alan Ranger Photography' }
    },
    {
      '@type': 'Service',
      provider: { '@type': 'Organization', name: 'Alan Ranger Photography' }
    }
  ]);
  const missingName = issues.filter((i) => i.code === 'missing_required_field' && i.fieldPath === 'name');
  const missingId = issues.filter((i) => i.code === 'missing_id');
  assert.equal(missingName.length, 1);
  assert.equal(missingId.length, 1);
  assert.match(missingName[0].detail, /Service\.name is missing \(block\)/);
  assert.match(missingId[0].detail, /Service\.@id is missing \(warning\)/);
  assert.doesNotMatch(missingName[0].detail, /Google penalty/i);
  assert.doesNotMatch(missingName[0].detail, /Code Injection/i);
  assert.doesNotMatch(missingId[0].detail, /Google penalty/i);
});

test('evaluateTypedSchemaTypeGroup: pure @id reference is skipped', () => {
  const issues = evaluateTypedSchemaTypeGroup('Service', [
    { '@type': 'Service', '@id': 'https://www.alanranger.com/#service-ref' },
    {
      '@type': 'Service',
      '@id': 'https://www.alanranger.com/#service-full',
      name: 'Mentoring',
      provider: { name: 'Alan Ranger' }
    }
  ]);
  assert.equal(issues.length, 0);
});

test('evaluateTypedSchemaTypeGroup: genuine shared Service name failure remains', () => {
  const issues = evaluateTypedSchemaTypeGroup('Service', [
    { '@type': 'Service', provider: { name: 'Alan Ranger' } }
  ]);
  assert.ok(issues.some((i) => i.code === 'missing_required_field' && i.fieldPath === 'name'));
  assert.ok(issues.some((i) => i.code === 'missing_id'));
});

test('Organization: complete + nested name-only preserves HEAD type-group masking', () => {
  const issues = evaluateTypedSchemaTypeGroup('Organization', [
    {
      '@type': 'Organization',
      '@id': 'https://www.alanranger.com/#org',
      name: 'Alan Ranger Photography',
      url: 'https://www.alanranger.com'
    },
    {
      '@type': 'Organization',
      name: 'Batsford nested brand only'
    }
  ]);
  assert.equal(issues.filter((i) => i.code === 'missing_required_field').length, 0);
  assert.equal(issues.filter((i) => i.code === 'missing_id').length, 0);
});

test('shouldEvaluateQaTypeForTier: Service only on workshop/service-intent or product tier', () => {
  assert.equal(shouldEvaluateQaTypeForTier('Service', 'product', blogUrl), true);
  assert.equal(shouldEvaluateQaTypeForTier('Service', 'blog', workshopUrl), true);
  assert.equal(shouldEvaluateQaTypeForTier('Service', 'blog', blogUrl), false);
  assert.equal(shouldEvaluateQaTypeForTier('Organization', 'blog', blogUrl), true);
});

test('buildSchemaQaGate: skipped Service scope exposed on blog with Service entity', () => {
  const gate = buildSchemaQaGate(
    [
      {
        url: blogUrl,
        success: true,
        statusCode: 200,
        schemas: [
          {
            '@type': 'Service',
            name: 'Sitewide',
            provider: { name: 'Alan Ranger' },
            '@id': 'https://www.alanranger.com/#svc'
          }
        ]
      }
    ],
    'test',
    'full',
    'all',
    null,
    () => 'blog'
  );
  assert.equal(gate.rows.length, 1);
  assert.equal(gate.rows[0].status, 'pass');
  assert.ok(Array.isArray(gate.rows[0].notEvaluated));
  assert.equal(gate.rows[0].notEvaluated[0].typeName, 'Service');
  assert.match(gate.rows[0].summary, /not scored/i);
});

test('buildSchemaQaGate: workshop with nameless Service blocks; missing @id warns', () => {
  const gate = buildSchemaQaGate(
    [
      {
        url: workshopUrl,
        success: true,
        statusCode: 200,
        schemas: [
          {
            '@type': 'Service',
            provider: { '@type': 'Organization', name: 'Alan Ranger Photography' }
          }
        ]
      }
    ],
    'test',
    'full',
    'all',
    null,
    () => 'product'
  );
  const row = gate.rows[0];
  assert.equal(row.status, 'block_deploy');
  assert.ok(row.issueCodes.includes('missing_required_field'));
  assert.ok(row.issueCodes.includes('missing_id'));
  assert.match(row.summary, /Service\.name is missing \(block\)/);
  assert.doesNotMatch(row.summary, /Google penalty/i);
});
