# Slick plugins

> [!NOTE]
> This project was built with [Claude Code](https://claude.com/claude-code), using Claude Opus 5.5.
> The original code, plugins and site were written by AI, with Freddie directing and testing.

Plugins for [Slick](https://github.com/3kh0/slick) by Freddie and contributors, and the site that hosts
them at slick.freddieyershon.co.uk.

```
plugins/<Name>/index.tsx   a plugin (TypeScript; index.ts works too)
plugins/<Name>/meta.ts     its id, name, description and settings
plugins/_shared/           code several plugins use (not a plugin itself)
types/slick.d.ts           types for Slick's plugin API ($slick)
scripts/build-plugins.ts   builds plugins into public/plugins/ and src/plugins.json
src/App.svelte             the site, which lists whatever was built
```

## Commands

```bash
npm install
npm run plugins    # build plugins only
npm run contributors # refresh src/contributors.json from GitHub
npm run dev        # build plugins, then run the site locally
npm run build      # build plugins and the site into dist/
npm run typecheck  # type-check plugins and the site
npm test           # run plugins/**/*.test.ts
```

## Adding a plugin

1. Make `plugins/MyPlugin/meta.ts` and `plugins/MyPlugin/index.tsx`. Copy `ClubLeader` to start.
2. The folder name and the class's `static id` must match. Slick stores settings under that id,
   so don't rename it once people have installed it.
3. Run `npm run plugins`. It appears on the site and at `/plugins/MyPlugin.js`.
4. To try it before deploying: in Slack, open **Preferences → Install plugins**, and under
   **From a file** choose `public/plugins/MyPlugin.js`.

Notes:
- Plugins can only import `$slick`, their own files, `plugins/_shared/` and npm packages (which get bundled).
- JSX uses Slack's own global `React`, so don't import React.
- `types/slick.d.ts` covers part of Slick's API. Add to it when you need more, or use `this.api.raw`
  untyped. The full types are in Slick's `src/shared/Plugin.ts` and `src/app/pluginManager.ts`.
- Debug in Slack with Ctrl+Alt+I and filter the console for `[slick]`.

## Deploying

`vercel.json` builds with `npm run build` and serves `dist/`. Plugin files are cached for 5 minutes,
and Slick checks installed links for updates every few hours.

## Who made what

| Plugin | What it does | Made with | Supervised by |
| --- | --- | --- | --- |
| [Club Leader Badge](plugins/ClubLeader) | Badge next to Hack Club club leaders, from the Club API | Claude Code (Claude Opus 5.5) | [Freddie](https://freddieyershon.co.uk) |
| [Mic Guard](plugins/MicGuard) | Unmutes you again when someone else mutes you in a huddle, and says who | [Gorkie](https://github.com/techwithanirudh/gorkie) | [Jacob](https://github.com/SmartSparkCoding) |
| [Pop Out Video](plugins/PopOutVideo) | Opens a participant's huddle video in its own window you can resize | [Gorkie](https://github.com/techwithanirudh/gorkie) | [Jacob](https://github.com/SmartSparkCoding) |

Every plugin is directed and tested in Slack by a person, who decides what ships.

## Contributing

Ideas, bug reports and new plugins are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Slick Credits

Slick is a Slack client mod created and maintained by [@3kh0](https://github.com/3kh0)! It is a really cool project that has grown into a tool used and collaborated on by many people. I suggest you check it out at [3kh0/slick](https://github.com/3kh0/slick).

## License

[MIT](LICENSE) © 2026 Freddie Yershon
