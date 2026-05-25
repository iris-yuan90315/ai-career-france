import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addJobFromUrl, searchWeb, rescoreAll } from "@/lib/jobs.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/jobs")({
  component: JobsPage,
  head: () => ({ meta: [{ title: "Jobs — Pipeline" }] }),
});

type Job = {
  id: string;
  title: string;
  company_name: string | null;
  location: string | null;
  url: string;
  fit_score: number;
  fit_reason: string | null;
  is_ai_native: boolean;
  remote_ok: boolean;
  france_ok: boolean;
  source: string;
  scraped_at: string;
  hidden: boolean;
};

async function fetchJobs(filter: { onlyRelevant: boolean; query: string }): Promise<Job[]> {
  let q = supabase.from("jobs").select("*").eq("hidden", false).order("fit_score", { ascending: false }).limit(200);
  if (filter.onlyRelevant) q = q.or("remote_ok.eq.true,france_ok.eq.true");
  const { data, error } = await q;
  if (error) throw error;
  const list = (data as Job[]) ?? [];
  if (!filter.query) return list;
  const needle = filter.query.toLowerCase();
  return list.filter(
    (j) =>
      j.title.toLowerCase().includes(needle) ||
      (j.company_name ?? "").toLowerCase().includes(needle) ||
      (j.location ?? "").toLowerCase().includes(needle),
  );
}

function JobsPage() {
  const qc = useQueryClient();
  const [onlyRelevant, setOnlyRelevant] = useState(true);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", onlyRelevant, query],
    queryFn: () => fetchJobs({ onlyRelevant, query }),
  });

  const importUrl = useServerFn(addJobFromUrl);
  const importMut = useMutation({
    mutationFn: (u: string) => importUrl({ data: { url: u } }),
    onSuccess: (r) => {
      toast.success(`Added ${r.added} job(s)`);
      setUrl("");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const webSearch = useServerFn(searchWeb);
  const searchMut = useMutation({
    mutationFn: (q: string) => webSearch({ data: { query: q } }),
    onSuccess: (r) => {
      toast.success(`Found ${r.found}, added ${r.added}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rescore = useServerFn(rescoreAll);
  const rescoreMut = useMutation({
    mutationFn: () => rescore({}),
    onSuccess: (r) => {
      toast.success(`Rescored ${r.updated} jobs`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const saveJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("applications")
        .insert({ job_id: jobId, status: "interested" });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Saved to pipeline"),
    onError: (e) => toast.error((e as Error).message),
  });

  const hideJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("jobs").update({ hidden: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-5xl">Jobs</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ranked by fit score against your <Link to="/preferences" className="underline">preferences</Link>.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (url) importMut.mutate(url); }}
          >
            <Input
              placeholder="Paste a job URL…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" disabled={importMut.isPending}>
              {importMut.isPending ? "…" : "Import"}
            </Button>
          </form>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (search) searchMut.mutate(search); }}
          >
            <Input
              placeholder='Web search e.g. "AI product manager Paris"'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={searchMut.isPending}>
              {searchMut.isPending ? "…" : "Search"}
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <Input
            placeholder="Filter shown jobs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} />
            Remote or France only
          </label>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => rescoreMut.mutate()} disabled={rescoreMut.isPending}>
              {rescoreMut.isPending ? "Scoring…" : "Re-score all"}
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : jobs.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No jobs yet. Refresh companies, import a URL, or run a web search.
        </Card>
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => (
            <Card key={j.id} className="p-4 hover:border-foreground/30 transition-colors">
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center justify-center w-12 shrink-0">
                  <div className="font-display text-2xl leading-none">{j.fit_score}</div>
                  <div className="text-[10px] text-muted-foreground">fit</div>
                </div>
                <div className="flex-1 min-w-0">
                  <Link to="/job/$id" params={{ id: j.id }} className="block">
                    <h3 className="font-semibold leading-tight">{j.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {j.company_name ?? new URL(j.url).hostname.replace("www.", "")} · {j.location ?? "?"} · {relativeTime(j.scraped_at)}
                    </p>
                    {j.fit_reason && <p className="text-xs text-muted-foreground mt-2 italic">"{j.fit_reason}"</p>}
                  </Link>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {j.is_ai_native && <Badge>AI-native</Badge>}
                    {j.remote_ok && <Badge variant="outline">Remote</Badge>}
                    {j.france_ok && <Badge variant="outline">France</Badge>}
                    <Badge variant="secondary" className="text-[10px]">{j.source}</Badge>
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" onClick={() => saveJob.mutate(j.id)}>+ Pipeline</Button>
                  <a href={j.url} target="_blank" rel="noreferrer" className="text-xs text-center underline text-muted-foreground">Open</a>
                  <button onClick={() => hideJob.mutate(j.id)} className="text-[10px] text-muted-foreground hover:text-destructive">Hide</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
