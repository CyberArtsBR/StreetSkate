# Deploying to Cloudflare Pages

Cloudflare Pages has no bandwidth limit on its free plan. Its one hard limit is **25 MB per file**. After the Phase 0 asset diet, the largest shipped file is about 14 MB, so the game fits.

## One-time setup (owner)

1. Create a free account at https://dash.cloudflare.com (sign-up must be done by you).
2. **Workers & Pages → Create → Pages → Connect to Git**, then authorise GitHub and choose `CyberArtsBR/StreetSkate`.
3. Build settings:
   - Production branch: `main`
   - Framework preset: `None` (or `Vite`)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22` (also pinned in `.nvmrc`)
4. Save and deploy. The game will be live at `https://<project-name>.pages.dev`.
5. Optional: **Custom domains** → add your own domain (free SSL).

Every push to `main` redeploys automatically. Other branches get their own preview URLs, so you can test Phase work before it goes live.

## What's already in the repo

- `public/_headers`: cache rules. Hashed JS/CSS bundles are cached forever. Models, audio and media are cached for a day and refresh in the background. Pre-gzipped `.gz` models are marked so the CDN doesn't re-encode them.
- `.nvmrc`: Node 22.

## Moving off Render

Keep Render running until the Cloudflare URL has been tested. Then, in the Render dashboard, turn off auto-deploy or delete the `streetskate` service. `render.yaml` can stay in the repo; Cloudflare ignores it.

The CI release tools in `tools/agent10-*` default to `streetskate.onrender.com`. Set `AGENT10_ALLOWED_DEPLOY_HOST` to the new host if you keep using them.

## Later: Cloudflare R2 for big assets

When v2 adds more maps, move `public/assets` to an R2 bucket (10 GB free, no download fees) and point `gameAssetUrl()` in `src/game/AssetPaths.js` at the bucket URL. This isn't needed yet.
