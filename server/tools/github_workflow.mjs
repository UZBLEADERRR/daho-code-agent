/** GitHub Actions. input: {repo, action:"list"|"run"|"status"|"logs"|"artifacts", workflow?, ref?, run_id?, inputs?} */
import { apiBase, gh, softToken, target, token } from './_gh.mjs';

export default async function run(input, ctx) {
  const { owner, repo, branch } = target(input, ctx);
  const action = input.action || 'status';

  if (action === 'list') {
    const d = await gh(`/repos/${owner}/${repo}/actions/workflows`, { tok: softToken(ctx) });
    return { workflows: (d.workflows || []).map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state })) };
  }

  if (action === 'run') {
    if (!input.workflow) throw new Error('workflow (fayl nomi, masalan "apk.yml") majburiy');
    await gh(`/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(input.workflow)}/dispatches`, {
      method: 'POST', tok: token(ctx),
      body: { ref: input.ref || branch, inputs: input.inputs || undefined },
    });
    return { started: true, workflow: input.workflow, ref: input.ref || branch, note: 'natijani "status" bilan tekshiring' };
  }

  if (action === 'status') {
    const q = input.workflow
      ? `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(input.workflow)}/runs?per_page=5`
      : `/repos/${owner}/${repo}/actions/runs?per_page=5`;
    const d = await gh(q, { tok: softToken(ctx) });
    return {
      runs: (d.workflow_runs || []).map((r) => ({
        id: r.id, name: r.name, branch: r.head_branch, status: r.status,
        conclusion: r.conclusion, created_at: r.created_at, url: r.html_url,
      })),
    };
  }

  if (action === 'logs') {
    const tok = token(ctx);
    let runId = input.run_id;
    if (!runId) {
      const d = await gh(`/repos/${owner}/${repo}/actions/runs?per_page=1`, { tok });
      runId = d.workflow_runs?.[0]?.id;
      if (!runId) throw new Error('run topilmadi');
    }
    const jobs = await gh(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { tok });
    const failed = (jobs.jobs || []).filter((j) => j.conclusion && j.conclusion !== 'success');
    const out = { run_id: runId, jobs: (jobs.jobs || []).map((j) => ({ name: j.name, conclusion: j.conclusion })) };
    if (!failed.length) return { ...out, ok: true, note: 'yiqilgan job yo\'q' };

    const job = failed[0];
    const res = await fetch(`${apiBase()}/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, {
      headers: { Authorization: `Bearer ${tok}`, 'User-Agent': 'daho-brain', Accept: 'application/vnd.github+json' },
      redirect: 'follow',
    });
    const text = res.ok ? await res.text() : '';
    const lines = text.split('\n');
    const hot = lines.filter((l) => /error|failed|exception|not found|cannot/i.test(l)).slice(-40);
    return {
      ...out, ok: false, failedJob: job.name,
      errorLines: hot,
      tail: lines.slice(-60).join('\n').slice(-6000),
    };
  }

  if (action === 'artifacts') {
    const tok = softToken(ctx);
    let runId = input.run_id;
    if (!runId) {
      const d = await gh(`/repos/${owner}/${repo}/actions/runs?per_page=1&status=success`, { tok });
      runId = d.workflow_runs?.[0]?.id;
    }
    const d = await gh(`/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`, { tok });
    return {
      run_id: runId,
      artifacts: (d.artifacts || []).map((a) => ({ name: a.name, size_kb: Math.round(a.size_in_bytes / 1024), url: a.archive_download_url })),
    };
  }

  throw new Error(`Noma'lum action: ${action}`);
}
