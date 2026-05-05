// Helper for embedding a "Copy CLI command" button into each tool's HTML
// output. The button sits at the top-left of the title row and copies the
// exact npx invocation that produced the file to the user's clipboard.
//
// Each tool calls `buildCliCommand(binName)` to capture its own argv at
// generation time, then injects the returned `{ html, css, script }`
// snippets into the document it builds.

const POSIX_SAFE = /^[A-Za-z0-9_./@:=,+%-]+$/;

export function shellQuote(s) {
  if (s === '') return "''";
  if (POSIX_SAFE.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

export function buildCliCommand(binName, argv = process.argv.slice(2)) {
  const parts = ['npx', '-p', '@imbue-ai/gp-treemap', binName, ...argv];
  return parts.map(shellQuote).join(' ');
}

// HTML for the button. Place at the very start of the title row so it sits
// at the top-left of the app.
export const COPY_BTN_HTML =
  `<button id="copy-cli-btn" class="copy-cli-btn" type="button" ` +
  `title="copy CLI command to clipboard" aria-label="copy CLI command to clipboard">` +
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">` +
  `<rect x="4.5" y="4.5" width="8" height="9.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
  `<path d="M3.5 11V3a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
  `</svg>` +
  `</button>`;

export const COPY_BTN_CSS = `
  .copy-cli-btn { display:inline-flex; align-items:center; justify-content:center;
    width: 22px; height: 22px; padding: 0; border-radius: 4px;
    background: var(--page-bg, #fff); color: var(--page-fg, #555);
    border: 1px solid var(--page-border, #ccc); cursor: pointer;
    flex-shrink: 0; margin-right: 4px; }
  .copy-cli-btn:hover { background: var(--page-border, #eee); color: var(--page-fg, #111); }
  .copy-cli-btn.copied { background: #16a34a; color: #fff; border-color: #16a34a; }
  .copy-cli-btn svg { display: block; }
`;

// Inline script that wires the button to the clipboard. Pass the CLI string
// returned by buildCliCommand(); we JSON-encode it for safe injection.
export function copyButtonScript(cliCommand) {
  return `
(function () {
  var btn = document.getElementById('copy-cli-btn');
  if (!btn) return;
  var cmd = ${JSON.stringify(cliCommand)};
  var origHtml = btn.innerHTML;
  var resetTimer = null;
  btn.addEventListener('click', function () {
    var done = function () {
      btn.classList.add('copied');
      btn.innerHTML = '\u2713';
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        btn.classList.remove('copied');
        btn.innerHTML = origHtml;
      }, 1200);
    };
    var fail = function () {
      btn.title = 'clipboard unavailable \u2014 see console';
      console.log('CLI command:\\n' + cmd);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(done, fail);
      } else {
        var ta = document.createElement('textarea');
        ta.value = cmd; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        ok ? done() : fail();
      }
    } catch (e) { fail(); }
  });
})();
`;
}
