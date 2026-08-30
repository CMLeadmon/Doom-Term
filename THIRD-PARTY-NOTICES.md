# Third-party notices

Doom Term is MIT licensed. It bundles and depends on the following, whose
licences require attribution.

## tmux — ISC

Copyright (c) Nicholas Marriott and contributors.
Bundled as an executable sidecar; unmodified. <https://github.com/tmux/tmux>

Permission to use, copy, modify, and distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## libevent — BSD-3-Clause

Copyright (c) Niels Provos, Nick Mathewson and contributors.
Linked into the bundled tmux. <https://libevent.org/>

## ncurses — MIT-like (X11-style)

Copyright (c) Thomas E. Dickey and contributors.
Linked into the bundled tmux. <https://invisible-island.net/ncurses/>

## @xterm/headless, @xterm/addon-unicode11 — MIT

Copyright (c) The xterm.js authors. <https://github.com/xtermjs/xterm.js>

## Prior art

Doom Term's durable-session design was informed by reading nodeterm
(BUSL-1.1, © Enes Kirca), which uses tmux the same way. No nodeterm code or
documentation was copied; the techniques are independently implemented here.
