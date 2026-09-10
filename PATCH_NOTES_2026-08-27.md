# Phase 0 patch after first Linux run

Changes:
- Fix strict TypeScript errors in extension repeated-item detector.
- Fix strict TypeScript error in Fastify error handler.
- Replace deprecated npm short workspace flag `-ws` with `--workspaces`.

Expected verification:

```bash
npm install
npm run check:env
npm run typecheck
npm run build
npm run dev
```

Backend root `/` intentionally returns 404. Health endpoint is:

```bash
curl http://127.0.0.1:17321/api/health
```
