// Builds src/contributors.json for the site's Contributors section, at build time,
// so visitors never call GitHub.
//
// - Who: everyone GitHub counts as a contributor, plus everyone in people.json.
//   people.json covers anyone GitHub hasn't counted yet (its list lags, and skips
//   commits whose email isn't linked to an account).
// - Names and roles: from people.json, keyed by GitHub login. Anyone not in it is
//   shown by login, with their commit count as the role.
//
// If GitHub can't be reached (or rate-limits the build), people.json is still used and
// the last known commit counts are kept. Set GITHUB_TOKEN to raise GitHub's limit.

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = 'hippogriff101/freddie-slick';
const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src', 'contributors.json');
const PEOPLE = path.join(ROOT, 'people.json');

type GitHubContributor = { login: string; avatar_url: string; html_url: string; contributions: number; type: string };
type Counted = { login: string; avatar: string; url: string; contributions: number };
type Person = { name?: string; role?: string };
export type Contributor = Counted & { name: string; role: string };

const avatarOf = (login: string) => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=96`;
const commits = (count: number) => `${count} commit${count === 1 ? '' : 's'}`;

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
  } catch (error) {
    console.warn(`[contributors] couldn't read ${path.basename(file)}: ${error instanceof Error ? error.message : error}`);
    return fallback;
  }
}

async function fromGitHub(): Promise<Map<string, Counted>> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'freddie-slick-site-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=100`, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const list = (await response.json()) as GitHubContributor[];
  return new Map(
    list
      .filter((person) => person.type !== 'Bot' && !person.login.endsWith('[bot]'))
      .map((person) => [
        person.login.toLowerCase(),
        {
          login: person.login,
          avatar: `${person.avatar_url}${person.avatar_url.includes('?') ? '&' : '?'}s=96`,
          url: person.html_url,
          contributions: person.contributions,
        },
      ]),
  );
}

async function main() {
  const people = readJson<Record<string, Person>>(PEOPLE, {});
  let counted: Map<string, Counted>;
  try {
    counted = await fromGitHub();
  } catch (error) {
    // Fall back to the last list we saved, so commit counts don't drop to zero.
    console.warn(`[contributors] using the saved list: ${error instanceof Error ? error.message : error}`);
    const saved = readJson<Counted[]>(OUT, []);
    counted = new Map(saved.map((person) => [person.login.toLowerCase(), person]));
  }

  const lookup = new Map(Object.entries(people).map(([login, person]) => [login.toLowerCase(), { login, ...person }]));
  const keys = new Set([...counted.keys(), ...lookup.keys()]);

  const contributors: Contributor[] = [...keys].map((key) => {
    const github = counted.get(key);
    const person = lookup.get(key);
    const login = github?.login ?? person!.login;
    const contributions = github?.contributions ?? 0;
    return {
      login,
      name: person?.name?.trim() || login,
      role: person?.role?.trim() || (contributions ? commits(contributions) : 'Contributor'),
      avatar: github?.avatar ?? avatarOf(login),
      url: github?.url ?? `https://github.com/${encodeURIComponent(login)}`,
      contributions,
    };
  });
  contributors.sort((a, b) => b.contributions - a.contributions || a.name.localeCompare(b.name));

  await writeFile(OUT, JSON.stringify(contributors, null, 2) + '\n');
  console.log(`[contributors] ${contributors.length} contributor${contributors.length === 1 ? '' : 's'}`);
}

try {
  await main();
} catch (error) {
  // A failure here shouldn't fail the whole site build.
  if (!existsSync(OUT)) await writeFile(OUT, '[]\n');
  console.warn(`[contributors] kept the existing list: ${error instanceof Error ? error.message : error}`);
}
