import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { chicagoDateSlug } from '../web_publish';

/**
 * Local Instakyle publish — mirrors the CI "Commit and push Instakyle /news" step
 * so the browser picker (`npm run pick:publish`) can be one-and-done from your Mac.
 *
 * Reads TECHNEWS_INSTAKYLE_NEWS_DIR (the Instakyle repo's `public/news`), stages
 * whatever the agent just wrote there, commits, and pushes. No-ops cleanly when
 * nothing changed (e.g. the agent didn't reach a successful send).
 *
 * Env:
 *   TECHNEWS_INSTAKYLE_NEWS_DIR  (required) — absolute path to <instakyle>/public/news
 *   TECHNEWS_INSTAKYLE_PUSH=0    — stage + commit only, skip `git push`
 */
function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
  }).trim();
}

function main(): void {
  const newsDir = process.env.TECHNEWS_INSTAKYLE_NEWS_DIR?.trim();
  if (!newsDir) {
    throw new Error(
      'TECHNEWS_INSTAKYLE_NEWS_DIR is not set — point it at the Instakyle repo\u2019s public/news (e.g. /path/to/Instakyle-clean/public/news) before publishing.'
    );
  }

  let repoRoot: string;
  try {
    repoRoot = git(newsDir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(
      `TECHNEWS_INSTAKYLE_NEWS_DIR (${newsDir}) is not inside a git repo — clone Instakyle-clean and point at its public/news.`
    );
  }

  git(repoRoot, ['add', newsDir]);

  const staged = git(repoRoot, ['diff', '--staged', '--name-only']);
  if (!staged) {
    console.log(
      'No changes under public/news to publish (did the agent reach a successful send?). Skipping commit/push.'
    );
    return;
  }
  console.log(`Staged for publish:\n  ${staged.split('\n').join('\n  ')}`);

  const slug = chicagoDateSlug();
  git(repoRoot, ['commit', '-m', `chore(news): Tech News episode (${slug}) [local]`]);
  console.log(`Committed Tech News episode (${slug}) in ${repoRoot}.`);

  if (process.env.TECHNEWS_INSTAKYLE_PUSH?.trim() === '0') {
    console.log('TECHNEWS_INSTAKYLE_PUSH=0 — committed locally, skipping push.');
    return;
  }

  const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(repoRoot, ['push', 'origin', 'HEAD']);
  console.log(`Pushed ${branch} to origin — instakyle.tech/news will update shortly.`);
}

main();
