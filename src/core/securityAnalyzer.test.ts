import { describe, it, expect } from 'vitest';
import { analyzeCommandRisk } from './securityAnalyzer';

describe('securityAnalyzer', () => {
  it('detects rm -rf commands as high risk', () => {
    const res = analyzeCommandRisk('rm -rf /tmp/target');
    expect(res.isHighRisk).toBe(true);
    expect(res.category).toBe('destructive');
  });

  it('detects sudo privilege escalation as high risk', () => {
    const res = analyzeCommandRisk('sudo apt install curl');
    expect(res.isHighRisk).toBe(true);
    expect(res.category).toBe('privilege');
  });

  it('detects git reset --hard as high risk', () => {
    const res = analyzeCommandRisk('git reset --hard HEAD~1');
    expect(res.isHighRisk).toBe(true);
  });

  it('allows safe standard commands', () => {
    expect(analyzeCommandRisk('cargo check').isHighRisk).toBe(false);
    expect(analyzeCommandRisk('git status').isHighRisk).toBe(false);
    expect(analyzeCommandRisk('npm test').isHighRisk).toBe(false);
    expect(analyzeCommandRisk('ls -la').isHighRisk).toBe(false);
  });
});
