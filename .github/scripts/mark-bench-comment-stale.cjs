// Prepend a `> [!WARNING]` block to a sticky bench comment at the start
// of a CI run, so the comment makes it clear the data shown is from the
// *previous* run and the new measurement is in flight. The warning is
// naturally overwritten when the bench job ends and the sticky comment
// action posts the fresh markdown.
//
// Invoked from `actions/github-script` in the bench job of
// `.github/workflows/perf.yml`, which checks this repository out into
// `.perf-plugin/` at the ref the caller pinned:
//
//   - uses: actions/github-script@v9
//     env:
//       COMMENT_HEADER: profiler  # or tracerbench
//     with:
//       script: |
//         const markStale = require(
//           `${process.env.GITHUB_WORKSPACE}/.perf-plugin/.github/scripts/mark-bench-comment-stale.cjs`,
//         );
//         await markStale({ github, context });
//
// CI-only, so it is not in `package.json`'s `files`: nothing ever resolves it
// from `node_modules`, only from an `actions/checkout` of this repo.
//
// `COMMENT_HEADER` matches the `header:` value the bench job passes to
// `marocchino/sticky-pull-request-comment`, which is what produces the
// `<!-- Sticky Pull Request Comment<header> -->` marker we hunt for.

/**
 * @param {{
 *   github: import("@octokit/rest").Octokit;
 *   context: typeof import("@actions/github").context;
 * }} args
 */
module.exports = async ({ github, context }) => {
  const header = process.env.COMMENT_HEADER;
  if (!header) throw new Error("COMMENT_HEADER env var is required");

  const marker = `<!-- Sticky Pull Request Comment${header} -->`;
  const sha = context.sha.slice(0, 7);
  const { owner, repo } = context.repo;
  const commitUrl = `${context.serverUrl}/${owner}/${repo}/commit/${context.sha}`;
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

  const { data: comments } = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: context.issue.number,
  });
  const existing = comments.find((c) => c.body && c.body.includes(marker));
  if (!existing) return; // First run on this PR — nothing to mark stale.

  // Strip any prior `> [!WARNING]` block at the top so successive runs
  // don't stack the banner.
  const cleaned = existing.body.replace(
    /^> \[!WARNING\]\n(?:> [^\n]*\n)+\n/,
    "",
  );
  const warning =
    `> [!WARNING]\n` +
    `> ⏳ CI is running for commit [\`${sha}\`](${commitUrl}) — ` +
    `the data below is from a previous run and will be refreshed ` +
    `when this run completes. [View this run](${runUrl}).\n\n`;

  await github.rest.issues.updateComment({
    owner,
    repo,
    comment_id: existing.id,
    body: warning + cleaned,
  });
};
