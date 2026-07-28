import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  STAFF_ROLES,
  canRead,
  canWrite,
  hasAtLeast,
  isAdmin,
  isStaffRole,
  roleFromIdentity,
  type StaffRole,
} from './roles';

/**
 * Fleet access contract: no role means NO access — not reduced access, not a
 * default, not a read-only fallback. `roleFromIdentity` is the single place that
 * rule is expressed, so it gets the exhaustive treatment.
 */
describe('roleFromIdentity — fail closed', () => {
  it.each(['viewer', 'sales', 'admin'] as const)('passes through the known role %s', (role) => {
    expect(roleFromIdentity(role)).toBe(role);
  });

  // The shape identity actually sends for "no access": the key is absent, which
  // reads as undefined in JavaScript.
  it('maps undefined to none', () => {
    expect(roleFromIdentity(undefined)).toBe('none');
  });

  it('maps null to none', () => {
    expect(roleFromIdentity(null)).toBe('none');
  });

  it('maps an empty string to none', () => {
    expect(roleFromIdentity('')).toBe('none');
  });

  // A role from another app's vocabulary must not be honoured here.
  it.each(['designer', 'reviewer', 'member', 'supervised', 'superuser', 'owner'])(
    'maps the foreign role %s to none',
    (role) => {
      expect(roleFromIdentity(role)).toBe('none');
    },
  );

  // Case matters: the contract says roles are exact and lowercase.
  it.each(['Admin', 'ADMIN', 'Sales', 'Viewer'])('maps the miscased %s to none', (role) => {
    expect(roleFromIdentity(role)).toBe('none');
  });

  // 'none' is the app's internal fail-closed value, never something identity
  // can grant its way into.
  it('maps a literal "none" to none', () => {
    expect(roleFromIdentity('none')).toBe('none');
  });
});

describe('capabilities', () => {
  const table: Array<[StaffRole, boolean, boolean, boolean]> = [
    // role, canRead, canWrite, isAdmin
    ['none', false, false, false],
    ['viewer', true, false, false],
    ['sales', true, true, false],
    ['admin', true, true, true],
  ];

  it.each(table)('%s: read=%s write=%s admin=%s', (role, read, write, admin) => {
    expect(canRead(role)).toBe(read);
    expect(canWrite(role)).toBe(write);
    expect(isAdmin(role)).toBe(admin);
  });

  // The property every mutation depends on.
  it('never lets a viewer write', () => {
    expect(canWrite('viewer')).toBe(false);
  });

  it('never lets a no-access user read', () => {
    expect(canRead('none')).toBe(false);
  });
});

describe('hasAtLeast', () => {
  it('is reflexive', () => {
    for (const role of STAFF_ROLES) expect(hasAtLeast(role, role)).toBe(true);
  });

  it('orders none < viewer < sales < admin', () => {
    expect(hasAtLeast('admin', 'sales')).toBe(true);
    expect(hasAtLeast('sales', 'viewer')).toBe(true);
    expect(hasAtLeast('viewer', 'none')).toBe(true);

    expect(hasAtLeast('sales', 'admin')).toBe(false);
    expect(hasAtLeast('viewer', 'sales')).toBe(false);
    expect(hasAtLeast('none', 'viewer')).toBe(false);
  });
});

describe('isStaffRole', () => {
  it.each(STAFF_ROLES)('accepts %s', (role) => {
    expect(isStaffRole(role)).toBe(true);
  });

  it.each([undefined, null, '', 'designer', 42, {}, []])('rejects %p', (value) => {
    expect(isStaffRole(value)).toBe(false);
  });
});

describe('ASSIGNABLE_ROLES', () => {
  // `none` is the fail-closed answer, never a choice an admin makes.
  it('excludes none', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('none');
  });

  it('is exactly the vocabulary registered with identity', () => {
    expect([...ASSIGNABLE_ROLES]).toEqual(['viewer', 'sales', 'admin']);
  });
});
