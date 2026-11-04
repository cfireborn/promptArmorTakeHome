import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableRules, CALIFORNIA_DISCLOSURE, LIVE_POLICY_VERSION, LIVE_RULES } from './reviewPolicy.mjs';

const directLoan = {
  product: 'Personal loans', audience: 'US adults', channel: 'Paid social',
  placement: 'Instagram feed', jurisdiction: 'Other US jurisdiction', affiliatePartner: 'None',
};
const rule = (scope, id) => applicableRules(scope).find(entry => entry.id === id);

test('direct distribution excludes the California and Homewise examples without skipping core checks', () => {
  const selected = applicableRules(directLoan);
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.map(entry => entry.applicability), [
    'applies', 'applies', 'applies', 'not-applicable', 'not-applicable',
  ]);
});

test('California requires the offer disclosure for every supported product, independent of free text', () => {
  for (const product of ['Personal loans', 'Credit cards', 'Mortgage prequalification']) {
    assert.equal(rule({ ...directLoan, jurisdiction: 'California', product }, 'state-review').applicability, 'applies');
  }
  assert.equal(rule({ ...directLoan, audience: 'California residents', placement: 'Homewise in CA' }, 'state-review').applicability, 'not-applicable');
});

test('California offer disclosure is an exact fictional company policy with generation instructions', () => {
  const policy = LIVE_RULES.find(entry => entry.id === 'state-review');
  assert.equal(LIVE_POLICY_VERSION, 'ClearPath live review policy v3.3');
  assert.equal(CALIFORNIA_DISCLOSURE, 'California residents: this promotion is subject to ClearPath’s California offer terms.');
  assert.equal(policy.label, 'California offer disclosure');
  assert.ok(policy.description.includes(CALIFORNIA_DISCLOSURE));
  assert.ok(policy.instructions.some(instruction => instruction.includes(CALIFORNIA_DISCLOSURE) && instruction.includes('disclosure field')));
  assert.match(policy.instructions.join(' '), /apostrophe and whitespace differences/);
  assert.deepEqual(policy.sources, [{
    id: 'CP-CA-01', authority: 'company-policy',
    label: 'ClearPath California offer policy · fictional demo policy',
    url: '?guidelines#state-review', pinpoint: 'CP-CA-01',
  }]);
  assert.doesNotMatch(JSON.stringify(policy), /1550|California Financing Law|westlaw/);
});

test('presentation policy blocks material source conflicts without rejecting image-only or harmless transcription differences', () => {
  const policy = LIVE_RULES.find(entry => entry.id === 'brand-palette');
  const instructions = policy.instructions.join(' ');
  assert.match(policy.description, /Supplied copy and recorded use must be consistent with the artwork/);
  assert.match(instructions, /Empty supplied copy is valid for image-only review/);
  assert.match(instructions, /Partial transcription.*typography or whitespace differences.*harmless OCR errors are not material conflicts/);
  assert.match(instructions, /Material contradictions in transcription or scope require needs-review/);
  assert.match(instructions, /distinguish what the artwork shows from what supplied copy or recorded use says/);
  assert.match(instructions, /Never describe transcript-only wording as visible pixels or assign it an image region/);
  assert.match(instructions, /Actual visible violations must still fail/);
  assert.match(instructions, /corrected transcription or intended use before generation and return suggestedCopy=null/);
  assert.equal(policy.sources[0].authority, 'company-policy');
});

test('conflicting free text keeps presentation review applicable without activating dropdown-owned California or Homewise rules', () => {
  const selected = applicableRules({ ...directLoan, audience: 'California residents only', placement: 'Homewise portrait feed' });
  assert.equal(selected.length, 5);
  assert.equal(selected.find(entry => entry.id === 'brand-palette').applicability, 'applies');
  assert.equal(selected.find(entry => entry.id === 'state-review').applicability, 'not-applicable');
  assert.equal(selected.find(entry => entry.id === 'affiliate-identity').applicability, 'not-applicable');
  assert.match(selected.find(entry => entry.id === 'brand-palette').instructions.join(' '), /Rule applicability still follows the structured selections supplied by the server/);
});

test('missing, unspecified, and unsupported jurisdiction stay unknown instead of silently clearing', () => {
  for (const jurisdiction of [undefined, '', 'Unspecified', 'Nevada']) {
    assert.equal(rule({ ...directLoan, jurisdiction }, 'state-review').applicability, 'unknown');
  }
  assert.equal(rule({}, 'state-review').applicability, 'unknown');
});

test('partner metadata activates Homewise; a partner name in free text does not', () => {
  assert.equal(rule({ ...directLoan, affiliatePartner: 'Homewise' }, 'affiliate-identity').applicability, 'applies');
  assert.equal(rule({ ...directLoan, placement: 'Homewise newsletter' }, 'affiliate-identity').applicability, 'not-applicable');
  assert.equal(rule({ ...directLoan, affiliatePartner: 'None', channel: 'Affiliate partner' }, 'affiliate-identity').applicability, 'unknown');
});

test('unsupported or unselected partners and channels cannot become automatic N/A', () => {
  for (const affiliatePartner of ['Other', undefined, '', 'Unknown partner']) {
    assert.equal(rule({ ...directLoan, affiliatePartner }, 'affiliate-identity').applicability, 'unknown');
  }
  assert.equal(rule({ ...directLoan, channel: 'Unknown channel' }, 'affiliate-identity').applicability, 'unknown');
});

test('unrecognized product requires policy selection, including within California', () => {
  for (const product of [undefined, '', 'Unspecified', 'Business line of credit']) {
    const scope = { ...directLoan, product, jurisdiction: 'California' };
    for (const id of ['misleading-claim', 'product-disclosure', 'state-review']) {
      assert.equal(rule(scope, id).applicability, 'unknown');
    }
  }
});

test('selection preserves trusted policy content and never mutates the shared definitions', () => {
  const before = structuredClone(LIVE_RULES);
  const selected = applicableRules({ ...directLoan, jurisdiction: 'California', affiliatePartner: 'Homewise' });
  assert.deepEqual(LIVE_RULES, before);
  assert.deepEqual(selected.map(entry => entry.id), LIVE_RULES.map(entry => entry.id));
  for (const entry of selected) {
    assert.deepEqual(entry.sources, LIVE_RULES.find(policy => policy.id === entry.id).sources);
    assert.ok(entry.reason);
  }
});
