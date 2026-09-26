const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#ededed}main{text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#a1a1a1;margin:0}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

export const NOT_FOUND_PAGE = page('404: Not found', 'There is no site at this address.');
export const PENDING_PAGE = page('Not deployed yet', 'This project has no ready deployment yet.');
export const PAGE_NOT_FOUND_PAGE = page('404: Page not found', 'This page does not exist.');
