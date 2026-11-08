// Fetches the repo's GitHub contributors into src/contributors.json for the site.
// Runs at build time, so visitors never call GitHub. If GitHub can't be reached
// (or rate-limits the build), the committed file is kept as it is.
// Set GITHUB_TOKEN to raise GitHub's limit from 60 to 5000 requests an hour.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = 'hippogriff101/freddie-slick';
const OUT = path.join(import.meta.dirname, '..', 'src', 'contributors.json');

type GitHubContributor = { login: string; avatar_url: string; html_url: string; contributions: number; type: string };
export type Contributor = {
  login: string;
  avatar: string;
  url: string;
  contributions: number;
  /** Shown instead of the login, when the login is too long to fit. */
  label?: string;
  /** What they worked on, for people GitHub cannot count commits for (yet). */
  role?: string;
};

// Friendlier names for logins, used wherever the person shows up.
const LABELS: Record<string, string> = {
  hippogriff101: 'Freddie',
  smartsparkcoding: 'Jacob',
};

// GitHub only lists people whose commits are on the default branch, so anyone
// whose work is still in a fork or an open pull request would vanish from the
// site. They are listed here by hand until their commits land.
const EXTRA: Contributor[] = [
  {
    login: 'SmartSparkCoding',
    avatar: 'https://avatars.githubusercontent.com/u/186386267?v=4&s=96',
    url: 'https://github.com/SmartSparkCoding',
    contributions: 0,
    role: 'Mic Guard and Pop Out Video',
  },
];

async function main() {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'freddie-slick-site-build',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=100`, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const list = (await response.json()) as GitHubContributor[];

  const contributors: Contributor[] = list
    .filter((person) => person.type !== 'Bot' && !person.login.endsWith('[bot]'))
    .map((person) => ({
      login: person.login,
      avatar: `${person.avatar_url}${person.avatar_url.includes('?') ? '&' : '?'}s=96`,
      url: person.html_url,
      contributions: person.contributions,
    }));

  // GitHub's numbers win when somebody is in both lists.
  const known = new Set(contributors.map((person) => person.login.toLowerCase()));
  const people = [...contributors, ...EXTRA.filter((person) => !known.has(person.login.toLowerCase()))];
  people.sort((a, b) => b.contributions - a.contributions);
  for (const person of people) person.label ??= LABELS[person.login.toLowerCase()];

  await writeFile(OUT, JSON.stringify(people, null, 2) + '\n');
  console.log(`[contributors] ${people.length} contributor${people.length === 1 ? '' : 's'}`);
}

try {
  await main();
} catch (error) {
  // A failed fetch shouldn't fail the whole site build.
  if (!existsSync(OUT)) await writeFile(OUT, '[]\n');
  console.warn(`[contributors] kept the existing list: ${error instanceof Error ? error.message : error}`);
}
