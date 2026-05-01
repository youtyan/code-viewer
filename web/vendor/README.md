# Vendored Browser Assets

These files are committed so git-diff-preview works offline and does not load
CDN assets from the browser.

| Package | Version | Files | License |
| --- | --- | --- | --- |
| diff2html | 3.4.56 | `diff2html/diff2html.min.css`, `diff2html/diff2html-ui.min.js` | MIT, https://github.com/rtfpessoa/diff2html |
| highlight.js | 11.9.0 | `highlight.js/highlight.min.js`, `highlight.js/styles/github*.min.css` | BSD-3-Clause, https://github.com/highlightjs/highlight.js |

`diff2html-ui.min.js` is the UI bundle from the npm package. `highlight.min.js`
is the standard browser build for highlight.js 11.9.0.
