<script lang="ts">
  import plugins from './plugins.json';
  import contributors from './contributors.json';

  const REPO = 'https://github.com/hippogriff101/freddie-slick';

  const base = typeof location === 'undefined' ? '' : location.origin;
  let copied = $state<string | null>(null);

  async function copy(file: string) {
    await navigator.clipboard.writeText(`${base}/plugins/${file}`);
    copied = file;
    setTimeout(() => copied === file && (copied = null), 1500);
  }
</script>

<main>
  <header>
    <h1>Slick plugins</h1>
    <p>
      Plugins for <a href="https://github.com/3kh0/slick">Slick</a>, made by
      <a href="https://freddieyershon.co.uk">Freddie</a> and <a href="#contributors">contributors</a>.
      Copy a link and install it from Slick, and it keeps itself up to date.
    </p>
  </header>

  <section aria-labelledby="plugins">
    <h2 id="plugins">Plugins</h2>
    <ul>
      {#each plugins as plugin (plugin.id)}
        <li>
          <div class="info">
            <h3>{plugin.name}</h3>
            <p>{plugin.description}</p>
          </div>
          <div class="actions">
            <button onclick={() => copy(plugin.file)}>
              {copied === plugin.file ? 'Copied' : 'Copy link'}
            </button>
            <a href="/plugins/{plugin.file}" download>{plugin.file}</a>
            <a href="/plugins/{plugin.userFile}">Userscript</a>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section aria-labelledby="install">
    <h2 id="install">Install</h2>
    <ol>
      <li>In Slack, open <b>Preferences → Install plugins</b>.</li>
      <li>Paste the link and press <b>Install from URL</b>.</li>
      <li>Turn the plugin on. Its settings are under the cog.</li>
    </ol>
    <p class="muted">
      Plugins installed from a link update themselves every few hours. You can also download the
      <code>.js</code> and choose it under <b>From a file</b> instead, but it won't update itself. Using
      Slack in a browser? The userscript works in Violentmonkey.
    </p>
  </section>

  <section aria-labelledby="why">
    <h2 id="why">Why get plugins here</h2>
    <ul class="reasons">
      <li><b>They keep themselves updated.</b> Install from a link once, and fixes reach you within a few hours, or right away with <b>Check now</b>.</li>
      <li><b>Made for the Hack Club Slack.</b> Small plugins for things Hack Clubbers actually run into, like spotting club leaders.</li>
      <li><b>Easy on shared services.</b> Plugins cache what they look up and limit their own requests, so they don't hammer APIs like the Club API.</li>
      <li><b>Open and readable.</b> Every plugin is short, commented TypeScript under the MIT License, so you can check what it does before installing.</li>
    </ul>
  </section>

  <section aria-labelledby="source">
    <h2 id="source">Source code</h2>
    <p>
      The code is open source under the MIT License, so anyone can read it, change it and build on it.
      It's on GitHub at
      <a href="https://github.com/hippogriff101/freddie-slick">hippogriff101/freddie-slick</a>.
    </p>
  </section>

  <section aria-labelledby="local">
    <h2 id="local">Run it yourself</h2>
    <ol>
      <li>
        Clone and build it (you'll need <a href="https://nodejs.org">Node.js</a>):
        <pre><code>git clone https://github.com/hippogriff101/freddie-slick.git
cd freddie-slick
npm install
npm run plugins</code></pre>
      </li>
      <li>In Slack, open <b>Preferences → Install plugins</b>.</li>
      <li>Under <b>From a file</b>, press <b>Choose File…</b> and pick a plugin from <code>freddie-slick/public/plugins/</code>, such as <code>ClubLeader.js</code>.</li>
      <li>Turn the plugin on. Its settings are under the cog.</li>
    </ol>
    <p class="muted">
      Plugins installed from a file don't update themselves. Pull the latest code, run
      <code>npm run plugins</code> and choose the file again.
    </p>
  </section>

  <section aria-labelledby="contribute">
    <h2 id="contribute">Contribute</h2>
    <p>Got an idea, found a bug, or want to add your own plugin? Help is very welcome.</p>
    <ol>
      <li><a href="{REPO}/fork">Fork the repo</a> and make a branch.</li>
      <li>Add or change a plugin in <code>plugins/&lt;Name&gt;/</code>. Copying <code>ClubLeader</code> is a good start.</li>
      <li>Run <code>npm test</code> and <code>npm run typecheck</code>, and try it in Slack from a file.</li>
      <li><a href="{REPO}/compare">Open a pull request</a> saying what it does and how you tested it.</li>
    </ol>
    <p class="muted">
      Not a coder? <a href="{REPO}/issues/new">Open an issue</a> with your idea or bug. The full guide is
      in <a href="{REPO}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.
    </p>
  </section>

  <section aria-labelledby="contributors">
    <h2 id="contributors">Contributors</h2>
    <p class="muted">Thanks to everyone who's helped build these plugins.</p>
    <ul class="people">
      {#each contributors as person (person.login)}
        <li>
          <a
            href={person.url}
            title="@{person.login}{person.contributions ? ` · ${person.contributions} commit${person.contributions === 1 ? '' : 's'}` : ''}"
          >
            <img src={person.avatar} alt="" width="48" height="48" loading="lazy" />
            <span class="name">{person.name}</span>
            <span class="role">{person.role}</span>
          </a>
        </li>
      {/each}
      <li>
        <a href="{REPO}/blob/main/CONTRIBUTING.md" class="you">
          <span class="plus" aria-hidden="true">+</span>
          <span class="name">You?</span>
          <span class="role">Add a plugin or fix</span>
        </a>
      </li>
    </ul>
    <p class="muted thanks">
      This project was also built with help from Claude Opus 5.5, using
      <a href="https://claude.com/product/claude-code">Claude Code</a>. Jacob also utilises <a href="https://github.com/techwithanirudh/gorkie">Gorkie</a>, an AI Slack bot for his development. 
      I also want to thank Jacob and Wally for their help with this project.
    </p>
  </section>

  <footer class="muted">
    <p>
      <a href="https://github.com/3kh0/slick">Slick</a> is made and maintained by
      <a href="https://github.com/3kh0">@3kh0</a>. These plugins aren't made by or affiliated with Slack
      or Salesforce.
    </p>
    <p>
      © 2026 Freddie Yershon. Released under the
      <a href="https://github.com/hippogriff101/freddie-slick/blob/main/LICENSE">MIT License</a>.
    </p>
  </footer>
</main>

<style>
  main {
    max-width: 680px;
    margin: 0 auto;
    padding: 56px 16px 40px;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 8px;
    letter-spacing: -0.02em;
  }
  h1::before {
    content: '♣';
    color: var(--accent);
    margin-right: 10px;
  }
  header p { margin: 0; color: var(--muted); }
  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 44px 0 12px;
  }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  li {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
  }
  h3 { margin: 0 0 2px; font-size: 1.05rem; }
  .info { flex: 1 1 260px; min-width: 0; }
  .info p { margin: 0; color: var(--muted); font-size: 0.95rem; }
  .actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 0.9rem; }
  .actions a { color: var(--muted); }
  .actions a:hover { color: var(--fg); }
  button {
    font: inherit;
    font-weight: 600;
    border: 0;
    border-radius: 8px;
    padding: 8px 14px;
    min-width: 96px;
    background: var(--accent);
    color: var(--accent-fg);
    cursor: pointer;
  }
  button:hover { filter: brightness(1.08); }
  button:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
  ol { padding-left: 20px; margin: 0 0 12px; }
  ol li {
    display: list-item;
    background: none;
    border: 0;
    padding: 2px 0;
  }
  .muted { color: var(--muted); font-size: 0.92rem; }
  ul.reasons { gap: 8px; }
  ul.reasons li {
    display: block;
    padding: 12px 16px;
    font-size: 0.95rem;
    color: var(--muted);
  }
  ul.reasons b { color: var(--fg); }
  ul.people { display: flex; flex-wrap: wrap; gap: 20px 16px; margin-top: 12px; }
  ul.people li { display: block; padding: 0; background: none; border: 0; }
  ul.people a {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 112px;
    color: var(--muted);
    text-decoration: none;
    text-align: center;
  }
  ul.people a:focus-visible { outline: 2px solid var(--fg); outline-offset: 4px; border-radius: 8px; }
  ul.people .name {
    max-width: 100%;
    margin-top: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul.people .role {
    font-size: 0.78rem;
    line-height: 1.35;
    /* Two lines at most, then an ellipsis. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  ul.people a:hover .name { color: var(--accent); }
  ul.people img,
  .plus {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid var(--line);
    background: var(--card);
  }
  ul.people a:hover img { border-color: var(--accent); }
  .plus {
    display: grid;
    place-items: center;
    border-style: dashed;
    font-size: 1.4rem;
    color: var(--muted);
  }
  .you:hover .plus { border-color: var(--accent); color: var(--accent); }
  section > p.thanks { margin-top: 20px; }
  section > p { margin: 0 0 12px; }
  pre {
    margin: 8px 0 4px;
    padding: 12px 14px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; line-height: 1.6; }
  footer { margin-top: 48px; border-top: 1px solid var(--line); padding-top: 16px; }
  footer p { margin: 0 0 6px; }
</style>
