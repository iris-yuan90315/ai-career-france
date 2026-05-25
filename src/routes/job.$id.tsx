import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUSES, type Status, relativeTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/job/$id")({
  component: JobDetail,
  head: () => ({ meta: [{ title: "Job — Pipeline" }] }),
});

function JobDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: job, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: app } = useQuery({
    queryKey: ["application", id],
    queryFn: async () => {
      const { data } = await supabase.from("applications").select("*").eq("job_id", id).maybeSingle();
      return data;
    },
  });

  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [contact, setContact] = useState("");
  useEffect(() => {
    if (app) {
      setNotes(app.notes ?? "");
      setNextAction(app.next_action ?? "");
      setContact(app.contact ?? "");
    }
  }, [app]);

  const ensureApp = async (): Promise<string> => {
    if (app) return app.id;
    const { data, error } = await supabase.from("applications").insert({ job_id: id, status: "interested" }).select().single();
    if (error) throw error;
    return data.id;
  };

  const saveApp = useMutation({
    mutationFn: async () => {
      const appId = await ensureApp();
      const { error } = await supabase.from("applications").update({ notes, next_action: nextAction, contact }).eq("id", appId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["application", id] }); qc.invalidateQueries({ queryKey: ["pipeline"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const setStatus = useMutation({
    mutationFn: async (status: Status) => {
      const appId = await ensureApp();
      const { error } = await supabase
        .from("applications")
        .update({ status, applied_at: status === "applied" ? new Date().toISOString() : undefined })
        .eq("id", appId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["application", id] }); qc.invalidateQueries({ queryKey: ["pipeline"] }); },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); navigate({ to: "/jobs" }); },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!job) return <p>Not found.</p>;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/jobs" className="text-sm text-muted-foreground underline">← Back to jobs</Link>

      <div>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center justify-center w-16 shrink-0">
            <div className="font-display text-4xl">{job.fit_score}</div>
            <div className="text-xs text-muted-foreground">fit</div>
          </div>
          <div className="flex-1">
            <h1 className="font-display text-3xl tracking-tight">{job.title}</h1>
            <p className="mt-1 text-muted-foreground">
              {job.company_name ?? new URL(job.url).hostname} · {job.location ?? "?"} · {relativeTime(job.scraped_at)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.is_ai_native && <Badge>AI-native</Badge>}
              {job.remote_ok && <Badge variant="outline">Remote</Badge>}
              {job.france_ok && <Badge variant="outline">France</Badge>}
              {job.seniority && <Badge variant="secondary">{job.seniority}</Badge>}
            </div>
            {job.fit_reason && <p className="text-sm text-muted-foreground mt-3 italic">"{job.fit_reason}"</p>}
            <div className="mt-4 flex gap-2">
              <a href={job.url} target="_blank" rel="noreferrer">
                <Button variant="secondary">Open posting ↗</Button>
              </a>
              <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate()}>Delete</Button>
            </div>
          </div>
        </div>
      </div>

      <Card className="p-5 space-y-4">
        <h2 className="font-display text-2xl">Your pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Button
              key={s.key}
              variant={app?.status === s.key ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus.mutate(s.key)}
            >{s.label}</Button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Next action</Label>
            <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. apply by Friday, follow up with recruiter" />
          </div>
          <div className="space-y-2">
            <Label>Contact</Label>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Recruiter name / email / LinkedIn" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this role, key questions, comp range…" />
        </div>
        <Button onClick={() => saveApp.mutate()} disabled={saveApp.isPending}>
          {saveApp.isPending ? "Saving…" : "Save"}
        </Button>
      </Card>

      {job.description && (
        <Card className="p-5">
          <h2 className="font-display text-2xl mb-3">Description</h2>
          <pre className="whitespace-pre-wrap text-sm text-foreground/90 font-sans">{job.description}</pre>
        </Card>
      )}
    </div>
  );
}
