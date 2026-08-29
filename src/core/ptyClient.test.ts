import { describe, it, expect } from 'vitest';
import { looksLikeAbsolutePath } from './ptyClient';

describe('looksLikeAbsolutePath', () => {
  it('recognises the paths a user actually types', () => {
    expect(looksLikeAbsolutePath('/var/home/cleadmon/Projects/Doom Term')).toBe(true);
    expect(looksLikeAbsolutePath('~/Projects')).toBe(true);
    expect(looksLikeAbsolutePath('~')).toBe(true);
  });

  it('treats a bare word as a filter, not a path', () => {
    expect(looksLikeAbsolutePath('doom')).toBe(false);
    expect(looksLikeAbsolutePath('')).toBe(false);
    expect(looksLikeAbsolutePath('Doom Term')).toBe(false);
  });

  it('tolerates the whitespace typing leaves behind', () => {
    expect(looksLikeAbsolutePath('  /etc  ')).toBe(true);
    expect(looksLikeAbsolutePath('   ')).toBe(false);
  });
});
