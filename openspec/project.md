# LIME project context

LIME (Live Interactive Music Engine) is a pnpm TypeScript monorepo for continuous, adaptive music generation on the web.

## Workspace

| Area | Purpose |
| --- | --- |
| `packages/core` | Pure-TypeScript composition engine. |
| `packages/renderer-tone` | Browser audio renderer. |
| `packages/styles` | Built-in musical style packs. |
| `packages/corpus` | Corpus processing and generated style packs. |
| `apps/demo` | Vite demonstration application. |

## Project conventions

- Keep source packages independent of generated or external media assets.
- Use `pnpm` workspace commands for builds, tests, and type checks.
- Record proposed work as OpenSpec artifacts under `openspec/` before implementation.
