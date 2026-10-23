# Working in this repository

This is the Bryel's Care manufacturing ERP/CRM. It handles inventory, production
traceability, quality decisions, customer orders, payroll-related records and money. Treat
every change as a change to a serious operational system.

## Read first

1. `docs/source/master-brief.md` (the owner's brief; source of truth for scope and principles)
2. `docs/decision-log.md` (accepted and proposed architecture decisions; do not contradict
   an Accepted ADR without adding a superseding ADR)
3. `docs/team-charter.md` (who owns what; which persona to use for which work)
4. The document for the area you are touching (see README table)

## Team model

Work is done by specialised personas in `.claude/agents/`. For any non-trivial task, dispatch
the owning persona with the Agent tool rather than improvising outside its expertise. The
`principal-architect` persona reviews cross-module changes and keeps the decision log.

## Non-negotiable engineering rules (from the brief)

- Every delivered feature includes data model, permissions, validation, loading/empty/error
  states, audit trail where appropriate, tests, documentation and deployment notes. A screen
  alone is not a feature. No placeholder buttons that fake success.
- Authorization is enforced on the server in the service layer and by scoped queries, never
  only in the UI. Every module ships negative tests for cross-site access and role escalation.
- Posted business transactions (stock, production, finance) are immutable; correct them by
  reversal plus replacement with reason, actor and time. Never edit historical balances.
- Multi-step operations use database transactions; stock posting serializes on affected
  lot/location rows; commands that can be retried carry idempotency keys.
- Quantities and money use `numeric`/`decimal.js`, never floating point.
- State changes go through explicit state machines, never free-form status strings.
- Legal, tax, payroll, cosmetics regulatory and quality rules are configuration flagged for
  qualified review, never invented in code.
- Development uses clearly fictional seed data; never overwrite real company data.
- Keep documentation synchronized with code in the same change. Record notable decisions in
  `docs/decision-log.md` and new assumptions in `docs/PRD.md`.

## Process

- Phases and gates are defined in `docs/team-charter.md`. Do not start a phase whose gate is
  not approved by the owner.
- Implement in vertical slices tested end-to-end. Test-driven: write the failing test first.
- After each slice report: completed, tested, not completed, known risks, commands run,
  migrations, environment variables required, exact next steps.

## Conventions

- TypeScript strict, pnpm, Next.js App Router, Drizzle ORM, PostgreSQL (see ADR-001 to 023).
- Code layout (from Phase 1): `src/app` (routes, thin), `src/modules/<domain>` (services,
  schemas, repositories, public `index.ts`), `src/db` (schema, migrations), `src/ui`
  (design system), `src/lib` (shared infrastructure), `tests/` (integration and e2e).
- Modules import each other only through their public `index.ts`.
- Permission strings: `module.entity.action`, actions
  `view|create|edit|submit|approve|post|export|void|admin`.
- Commit messages: imperative subject, body explaining why; reference the ADR or story.

## Commands

Added in Phase 1 (`pnpm dev`, `pnpm test`, `pnpm db:migrate`, ...). Until then there is no
build to run.
