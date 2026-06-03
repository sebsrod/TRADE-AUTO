// Cloudflare Pages Function: routes every /api/* request through the shared Hono app.
// Pages serves static assets (and the SPA via public/_redirects) for all other paths.

import { handle } from "hono/cloudflare-pages";
import app from "../../src/worker/app";

export const onRequest = handle(app);
