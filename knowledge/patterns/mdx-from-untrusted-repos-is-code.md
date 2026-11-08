## MDX fetched from a repo is code: compiling is not the danger, running and injecting it is (2026-11-07)

`@mdx-js/mdx` `compile` + `run` turns a document into a JavaScript function and the backend ran it: `{process.env.X}` in a doc
printed the backend's environment. The rendered HTML was then put into the page with innerHTML, and a SECOND renderer
(react-markdown + rehype-raw, used when the MDX compile fails, which one stray `{` causes) let raw HTML through with no sanitizer.

**Rule:** treat every doc from a repo as hostile input to both the backend and the browser.
- A remark plugin that runs before compile removes ESM and every expression that is not plain data, dangerous elements (script,
  iframe, object, form, style, meta, link, base, SVG animation), `on*` and `srcdoc`, and script-scheme URLs
  (`plugins/engineering-docs-backend/src/service/mdxSafety.ts`). Plain data (`items={['npm','pnpm']}`, `{" "}`) is kept: real docs
  use it. Judge strings inside kept expressions like plain attributes.
- Apply the same rules to EVERY renderer of the same content (`safeHtml.ts` after `rehype-raw` in DocViewer).
- Test with the real compile in a child process (the MDX packages are ESM-only; jest cannot import them), first proving the harness
  sees the leak with the guard off, and compare the output for every real doc with and without the guard.
- React drops `on*` string props on its own; do not count that as the defence.
