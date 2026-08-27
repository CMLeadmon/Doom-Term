import type { CSSProperties } from 'react';
import type { AnsiSpan } from '../types/terminal';

/**
 * Inline style for one rendered span.
 *
 * Shared by the block view and the raw view so the two cannot drift — they
 * previously disagreed about which attributes existed at all.
 */
export function spanStyle(span: AnsiSpan, isErrorLine = false): CSSProperties {
  // A flagged row tints only what the program left uncoloured. Anything the
  // program coloured itself — a grep match, git status, ls — keeps its colour;
  // overriding it destroys the highlighting the user asked for.
  const fg = span.fg ?? (isErrorLine ? 'var(--st-fail)' : undefined);
  const bg = span.bg;

  const style: CSSProperties = {
    fontWeight: span.bold ? 'bold' : 'normal',
    fontStyle: span.italic ? 'italic' : 'normal',
  };

  if (span.invert) {
    // Inverse video is how a TUI draws selection and cursors; dropping it makes
    // the selected row indistinguishable from its neighbours.
    style.color = bg ?? 'var(--ground)';
    style.backgroundColor = fg ?? 'var(--ink)';
  } else {
    style.color = fg;
    style.backgroundColor = bg;
  }

  const decoration = [
    span.underline ? 'underline' : null,
    span.strikethrough ? 'line-through' : null,
  ].filter(Boolean);
  if (decoration.length > 0) style.textDecoration = decoration.join(' ');

  // SGR 2 is a relative reduction. It used to be 0.6, which drove already-dim
  // tokens under 2:1 against the ground; 0.78 stays legible on every palette entry.
  if (span.dim) style.opacity = 0.78;

  return style;
}
