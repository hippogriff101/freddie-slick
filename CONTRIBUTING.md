# Contributing

Thanks for helping out! Ideas, bug reports and new plugins are all welcome.

## Ideas and bugs

[Open an issue](https://github.com/hippogriff101/freddie-slick/issues/new). For a bug, say which plugin,
what you expected, what happened instead, and any `[slick]` lines from the console
(open DevTools in Slack with Ctrl+Alt+I and filter for `[slick]`).

## Changing or adding a plugin

1. Fork the repo and make a branch.
2. Install and build (you'll need [Node.js](https://nodejs.org)):
   ```bash
   npm install
   npm run plugins
   ```
3. Make your change in `plugins/<Name>/`. For a new plugin, copy `plugins/ClubLeader` and rename it.
   The folder name and the class's `static id` must match.
4. Check it:
   ```bash
   npm test
   npm run typecheck
   ```
5. Try it in Slack: **Preferences → Install plugins**, and under **From a file** choose
   `public/plugins/<Name>.js`.
6. Add yourself to `people.json` (your GitHub login, the name you'd like shown, and what you worked on),
   so you appear on the site with a name and role:
   ```json
   "your-github-login": { "name": "Your name", "role": "What you made" }
   ```
7. Open a pull request saying what it does and how you tested it. Screenshots help.

## Guidelines

- Keep plugins small and focused, with comments where something isn't obvious.
- Be kind to shared services: cache what you look up and limit requests (see `plugins/ClubLeader/limiter.ts`).
- Plugins can only import `$slick`, their own files, `plugins/_shared/` and npm packages. Use Slack's global `React`, don't import it.
- Adding a row to one of Slack's menus? Use `addRow` and `watchMenus` from `plugins/_shared/menus.ts`, so it highlights like Slack's own rows.
- Don't rename a plugin's id once it's released, since Slick stores people's settings under it.
- Never put API keys or tokens in the code. Use a plugin setting instead.

By contributing, you agree your work is released under the [MIT License](LICENSE).
