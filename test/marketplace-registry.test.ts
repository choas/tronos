import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_PACKAGES,
  COLLECTIONS,
  type CollectionId,
} from '../src/marketplace/registry';

describe('marketplace registry', () => {
  it('should have 80 total packages', () => {
    expect(MARKETPLACE_PACKAGES.length).toBe(80);
  });

  it('should have 58 installable packages (bundled + example)', () => {
    const installable = MARKETPLACE_PACKAGES.filter(p => p.source !== 'enterprise');
    expect(installable.length).toBe(58);
  });

  it('should have 22 enterprise packages', () => {
    const enterprise = MARKETPLACE_PACKAGES.filter(p => p.source === 'enterprise');
    expect(enterprise.length).toBe(22);
  });

  it('should have 6 bundled packages', () => {
    const bundled = MARKETPLACE_PACKAGES.filter(p => p.source === 'bundled');
    expect(bundled.length).toBe(6);
  });

  it('should have no duplicate package names', () => {
    const names = MARKETPLACE_PACKAGES.map(p => p.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('should have 8 collections', () => {
    expect(COLLECTIONS.length).toBe(8);
  });

  it('every package should belong to a valid collection', () => {
    const validIds = new Set<string>(COLLECTIONS.map(c => c.id));
    for (const pkg of MARKETPLACE_PACKAGES) {
      expect(validIds.has(pkg.collection)).toBe(true);
    }
  });

  it('all enterprise packages should have a tier', () => {
    const enterprise = MARKETPLACE_PACKAGES.filter(p => p.source === 'enterprise');
    for (const pkg of enterprise) {
      expect(pkg.tier).toBeDefined();
      expect(['free', 'pro', 'enterprise']).toContain(pkg.tier);
    }
  });

  it('enterprise tier breakdown: 6 free, 10 pro, 6 enterprise', () => {
    const enterprise = MARKETPLACE_PACKAGES.filter(p => p.source === 'enterprise');
    const free = enterprise.filter(p => p.tier === 'free');
    const pro = enterprise.filter(p => p.tier === 'pro');
    const ent = enterprise.filter(p => p.tier === 'enterprise');
    expect(free.length).toBe(6);
    expect(pro.length).toBe(10);
    expect(ent.length).toBe(6);
  });

  it('non-enterprise packages should not have a tier', () => {
    const nonEnterprise = MARKETPLACE_PACKAGES.filter(p => p.source !== 'enterprise');
    for (const pkg of nonEnterprise) {
      expect(pkg.tier).toBeUndefined();
    }
  });

  it('every package should have required fields', () => {
    for (const pkg of MARKETPLACE_PACKAGES) {
      expect(pkg.name).toBeTruthy();
      expect(pkg.description).toBeTruthy();
      expect(pkg.version).toBeTruthy();
      expect(pkg.author).toBeTruthy();
      expect(pkg.collection).toBeTruthy();
      expect(pkg.source).toBeTruthy();
    }
  });
});
