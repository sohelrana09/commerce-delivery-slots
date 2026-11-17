# Contributing to Delivery Slots

Bug fixes, calendar rules, checkout improvements and better documentation are all welcome. For larger changes, open an issue first so we can agree on the approach.

## Getting set up

Follow the [Quick start](README.md#quick-start): you need Node.js 24. The unit tests need no Adobe account, because the database, Commerce and I/O Runtime are faked:

```bash
git clone https://github.com/sohelrana09/commerce-delivery-slots.git
cd commerce-delivery-slots
npm install
npm test
```

`npm run demo` runs the checkout kit in a mock checkout at http://localhost:4371, and `npm run admin:preview` runs the Admin page at http://localhost:4370/preview.html with profiles and bookings kept in the browser. To deploy your copy, follow [docs/installation.md](docs/installation.md): you need an App Builder project, and a Commerce instance in the same Adobe organization to install it on.

## Making a change

1. Fork the repository and create a branch: `git checkout -b feature/your-change`.
2. Follow the [project structure](README.md#project-structure):
   - the calendar engine is `storefront/scripts/delivery-slots-engine.js`: one dependency-free module, with unit tests, that the checkout kit, the Admin preview and the actions all import (the actions and Admin as `#engine`). Keep it free of DOM and Node APIs, and do date arithmetic on plain `YYYY-MM-DD` dates or exact instants, never on local `Date` objects;
   - server-only logic goes in `src/common/slots`; actions stay thin: read the request, call `src/common`, answer;
   - every change to a reservation or a capacity counter must be a single conditional database operation filtered on the current state, so retries and redelivered events stay safe;
   - checkout must keep working: a failed availability feed shows a retry, never a broken checkout, and only a real slot problem stops an order;
   - storefront code in `storefront/` follows the Edge Delivery Services boilerplate's ESLint (Airbnb) and Stylelint rules, not Biome.
3. Keep secrets on the server: never log credentials, tokens, masked cart IDs or shopper data, and never commit `.env` or `.aio`.
4. Run the checks:

   ```bash
   npm run code:check
   npm run typecheck
   npm test
   ```

   Plus `npm run demo` for anything a shopper sees (try it with the keyboard only), and `npm run admin:preview` for anything on the Admin page.

   To lint the checkout kit with the boilerplate's rules, run them from a commerce boilerplate storefront checkout next to this one (ESLint 8 and Stylelint come from its `devDependencies`):

   ```bash
   cd ../your-storefront
   npx eslint --no-eslintrc -c .eslintrc.js --resolve-plugins-relative-to . ../commerce-delivery-slots/storefront/scripts/delivery-slots*.js
   npx stylelint --config .stylelintrc.json ../commerce-delivery-slots/storefront/styles/delivery-slots.css
   ```

5. Update the README, the guides in `docs/` and the [CHANGELOG](CHANGELOG.md) when behaviour, profile fields or setup change.
6. Commit, push the branch and open a pull request that says what changed and how you tested it. If you tried it on a Commerce instance, say which (SaaS or PaaS, and the version).

## Adding a profile field

1. Add it to `normalizeProfile` and `validateProfile` in `storefront/scripts/delivery-slots-engine.js`, use it in the availability rules, and add tests in `test/lib/engine.test.js`, including a daylight saving day if it involves times.
2. Add it to the type declarations in `delivery-slots-engine.d.ts`, and to the profile editor in `src/commerce-backend-ui-2/web-src/src/components/`.
3. Document it in [docs/profiles.md](docs/profiles.md).

## Reporting bugs and security issues

- Bugs and ideas: [open an issue](https://github.com/sohelrana09/commerce-delivery-slots/issues/new/choose).
- Security problems: report them privately, see [SECURITY.md](SECURITY.md).

By contributing you agree to follow the [code of conduct](CODE_OF_CONDUCT.md), and that your contribution is licensed under the [MIT License](LICENSE).
