import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { refreshCompany, refreshAllCompanies } from "@/lib/jobs.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/companies")({
  component: CompaniesPage,
  head: () => ({ meta: [{ title: "Companies — Pipeline" }] }),
});

type Company = { id: string; name: string; careers_url: string; last_scraped_at: string | null };

async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from("companies").select("*").order("name");
  if (error) throw error;
  return (data as Company[]) ?? [];
}

function CompaniesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const { data: companies = [], isLoading } = useQuery({ queryKey: ["companies"], queryFn: fetchCompanies });

  const refreshOne = useServerFn(refreshCompany);
  const refreshAll = useServerFn(refreshAllCompanies);

  const refreshOneMut = useMutation({
    mutationFn: (id: string) => refreshOne({ data: { companyId: id } }),
    onSuccess: (r) => {
      toast.success(`Found ${r.found}, added ${r.added}`);
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const refreshAllMut = useMutation({
    mutationFn: () => refreshAll({}),
    onSuccess: (r) => {
      toast.success(`Refreshed all. Added ${r.added} from ${r.found} found.${r.errors.length ? ` ${r.errors.length} errored.` : ""}`);
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("companies").insert({ name, careers_url: url });
      if (error) throw error;
    },
    onSuccess: () => {
      setName(""); setUrl("");
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
  });

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl">Companies</h1>
          <p className="mt-2 text-sm text-muted-foreground">Curated AI-native companies. Refresh to scrape their careers page.</p>
        </div>
        <Button onClick={() => refreshAllMut.mutate()} disabled={refreshAllMut.isPending}>
          {refreshAllMut.isPending ? "Refreshing all…" : "Refresh all"}
        </Button>
      </div>

      <Card className="p-4">
        <form
          className="flex flex-col gap-2 md:flex-row"
          onSubmit={(e) => { e.preventDefault(); if (name && url) add.mutate(); }}
        >
          <Input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Careers URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" variant="secondary">Add</Button>
        </form>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {companies.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{c.name}</h3>
                  <a href={c.careers_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline truncate block">
                    {c.careers_url}
                  </a>
                  <p className="text-[11px] text-muted-foreground mt-1">Last refresh: {relativeTime(c.last_scraped_at)}</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => refreshOneMut.mutate(c.id)} disabled={refreshOneMut.isPending}>
                    Refresh
                  </Button>
                  <button onClick={() => remove.mutate(c.id)} className="text-[10px] text-muted-foreground hover:text-destructive">Remove</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
