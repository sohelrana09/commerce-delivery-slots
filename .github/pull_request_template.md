## What changed

<!-- What does this pull request do, and why? Link the issue if there is one: "Closes #..." -->

## How I tested it

<!-- Unit tests, the demo or Admin preview, and if you deployed it: which workspace and Commerce instance (SaaS or PaaS, version), and which profiles, slots and orders you tried. -->

## Checklist

- [ ] `npm run code:check`, `npm run typecheck` and `npm test` pass, and the checkout kit passes the boilerplate's ESLint and Stylelint
- [ ] New logic in the engine or `src/common/slots` has unit tests, including a daylight saving day if it involves times
- [ ] The engine still runs the same in the browser and on the server (no DOM or Node APIs)
- [ ] Every reservation or capacity change is still one conditional database operation, so retries can't count a place twice
- [ ] A failed availability feed still leaves checkout working, and only a real slot problem stops an order
- [ ] No secrets, tokens, masked cart IDs or shopper data in code, logs or tests
- [ ] README, `docs/` or CHANGELOG updated, if behaviour, profile fields or setup changed
