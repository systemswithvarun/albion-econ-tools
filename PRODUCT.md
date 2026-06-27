# Product

## Register

product

## Users

A single Albion Online guild economy lead (the operator, "you") on the Americas-West server, plus eventually trusted guildmates entering prices. Context: a second monitor open beside the game, scanning for profitable market moves and acting on them fast. High domain fluency — knows tiers, enchant levels, taxes, the Black Market. Not a casual visitor; a power user in a recurring task.

## Product Purpose

A guild economy platform. Module 1 (Flip Screener) reads hourly market price observations and ranks cross-city flip routes by realizable daily profit, filtered by cash, margin, liquidity, and price freshness. Later modules (crafting, consumables) reuse the same data layer and fee math. Success = the operator opens a screen and immediately sees the best place to put silver to work, with enough context (ages, volumes, units affordable) to trust the call.

## Brand Personality

Terminal-grade, dense, trustworthy. Three words: precise, fast, legible. A trading tool, not a marketing page — every pixel earns its place by helping a decision. No hand-holding, no decoration.

## Anti-references

- SaaS landing-page chrome: hero metrics, gradient accents, oversized headings, marketing copy.
- Cluttered game-wiki tables with ad density and inconsistent alignment.
- Anything that hides data behind tabs/modals when it could be on one dense screen.

## Design Principles

1. **Density serves the decision.** Show the numbers that drive a trade on one screen; don't paginate or modal away context the operator needs to act.
2. **Numbers are the interface.** Tabular alignment, consistent formatting, and clear units matter more than ornament. The ranking metric (route daily profit) is always the visual anchor.
3. **Trust through transparency.** Surface freshness (price age) and liquidity (volume) next to every profit number so the operator can judge risk, not just reward.
4. **Fast in, fast out.** The operator is in flow; interactions give immediate state feedback and never make them wait for choreography.
5. **Consistency over surprise.** Same component vocabulary across modules; the flip screen sets the pattern crafting/consumables will follow.

## Accessibility & Inclusion

WCAG AA: body text ≥4.5:1 (the neutral shadcn ramp meets this; muted-foreground reserved for genuinely secondary data). Keyboard-operable controls including sortable table headers (real buttons + `aria-sort`). Respect `prefers-reduced-motion`. Dense data is acceptable, but touch targets stay ≥40px on interactive controls.
