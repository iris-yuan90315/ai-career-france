import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, type Status, relativeTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard — Pipeline" }] }),
});

type Row = {
  id: string;
  status: Status;
  notes: string | null;
  next_action: string | null;
  job: {
    id: string;
    title: string;
    company_name: string | null;
    location: string | null;
    url: string;
    fit_score: number;
    is_ai_native: boolean;
    remote_ok: boolean;
    france_ok: boolean;
  } | null;
};

async function fetchPipeline(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id,status,notes,next_action,job:jobs(id,title,company_name,location,url,fit_score,is_ai_native,remote_ok,france_ok)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as Row[]) ?? [];
}

function Dashboard() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["pipeline"], queryFn: fetchPipeline });

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase
        .from("applications")
        .update({ status, applied_at: status === "applied" ? new Date().toISOString() : undefined })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("applications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline"] }),
  });

  const byStatus = (s: Status) => rows.filter((r) => r.status === s);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl tracking-tight">Your pipeline</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI-native Product roles, remote or France. {rows.length} in flight.
          </p>
        </div>
        <Link to="/jobs">
          <Button>Browse jobs →</Button>
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">No applications yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Head to <Link className="underline" to="/companies">Companies</Link> to scrape roles, or <Link className="underline" to="/jobs">paste a JD URL</Link>.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {STATUSES.map((s) => {
            const list = byStatus(s.key);
            return (
              <div key={s.key} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</h2>
                  <span className="text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="space-y-2 min-h-[200px]">
                  {list.map((r) => (
                    <Card key={r.id} className="p-3 hover:border-foreground/30 transition-colors">
                      {r.job && (
                        <Link to="/job/$id" params={{ id: r.job.id }} className="block">
                          <p className="text-sm font-semibold leading-tight line-clamp-2">{r.job.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {r.job.company_name ?? "—"} · {r.job.location ?? "?"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge variant="secondary" className="text-[10px]">{r.job.fit_score}</Badge>
                            {r.job.is_ai_native && <Badge variant="outline" className="text-[10px]">AI</Badge>}
                            {r.job.remote_ok && <Badge variant="outline" className="text-[10px]">Remote</Badge>}
                            {r.job.france_ok && <Badge variant="outline" className="text-[10px]">FR</Badge>}
                          </div>
                        </Link>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {STATUSES.filter((x) => x.key !== r.status).map((x) => (
                          <button
                            key={x.key}
                            onClick={() => move.mutate({ id: r.id, status: x.key })}
                            className="text-[10px] rounded border border-border px-1.5 py-0.5 hover:bg-accent"
                          >→ {x.label}</button>
                        ))}
                        <button
                          onClick={() => remove.mutate(r.id)}
                          className="text-[10px] rounded border border-border px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
                        >✕</button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
