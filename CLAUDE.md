@AGENTS.md

# Project rules

- Read `ARCHITECTURE.md` before touching code. It defines the stack, directory ownership, data
  rules, the engine's programming principles, and the design system.
- Package manager is `pnpm`. Never run `npm` or `yarn`.
- UI foundation is shadcn/ui (Base UI variant) + Tailwind v4. No other UI library. Base UI uses the
  `render` prop instead of `asChild`.
- Contracts live in `lib/*/types.ts`. Do not change them in a breaking way; add optional fields only.
- Weights in kg, date keys `YYYY-MM-DD`, ids via `lib/ids.ts`.
- Only edit the files you own for your task. If you need a change elsewhere, note it in your report.
- Verify with `pnpm typecheck` (errors in files you do not own are expected until integration; report them).
- Do not run `git commit`.
