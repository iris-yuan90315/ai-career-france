import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/preferences")({
  component: PrefsPage,
  head: () => ({ meta: [{ title: "Preferences — Pipeline" }] }),
});

type Prefs = {
  locations: string[];
  seniorities: string[];
  keywords_include: string[];
  keywords_exclude: string[];
  min_comp: number | null;
  profile_summary: string | null;
};

const empty: Prefs = {
  locations: [], seniorities: [], keywords_include: [], keywords_exclude: [], min_comp: null, profile_summary: "",
};

function csv(arr: string[]) { return arr.join(", "); }
function parseCsv(s: string) { return s.split(",").map((x) => x.trim()).filter(Boolean); }

function PrefsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["prefs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("preferences").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Prefs;
    },
  });

  const [form, setForm] = useState<Prefs>(empty);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("preferences").update({
        locations: form.locations,
        seniorities: form.seniorities,
        keywords_include: form.keywords_include,
        keywords_exclude: form.keywords_exclude,
        min_comp: form.min_comp,
        profile_summary: form.profile_summary,
      }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved. Re-score from the Jobs page to apply."); qc.invalidateQueries({ queryKey: ["prefs"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="font-display text-5xl">Preferences</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tune what counts as a good role. Used to score every job.</p>
      </div>

      <Card className="p-6 space-y-5">
        <div className="space-y-2">
          <Label>Locations (comma separated)</Label>
          <Input value={csv(form.locations)} onChange={(e) => setForm({ ...form, locations: parseCsv(e.target.value) })} placeholder="Remote, France, Paris" />
        </div>
        <div className="space-y-2">
          <Label>Seniorities</Label>
          <Input value={csv(form.seniorities)} onChange={(e) => setForm({ ...form, seniorities: parseCsv(e.target.value) })} placeholder="Senior, Lead, Principal, Head of Product" />
        </div>
        <div className="space-y-2">
          <Label>Keywords to include</Label>
          <Input value={csv(form.keywords_include)} onChange={(e) => setForm({ ...form, keywords_include: parseCsv(e.target.value) })} placeholder="AI, LLM, agents, product" />
        </div>
        <div className="space-y-2">
          <Label>Keywords to exclude</Label>
          <Input value={csv(form.keywords_exclude)} onChange={(e) => setForm({ ...form, keywords_exclude: parseCsv(e.target.value) })} placeholder="intern, contract" />
        </div>
        <div className="space-y-2">
          <Label>Minimum comp (annual, EUR)</Label>
          <Input
            type="number"
            value={form.min_comp ?? ""}
            onChange={(e) => setForm({ ...form, min_comp: e.target.value ? Number(e.target.value) : null })}
            placeholder="100000"
          />
        </div>
        <div className="space-y-2">
          <Label>Your profile (used for AI fit scoring)</Label>
          <Textarea
            rows={5}
            value={form.profile_summary ?? ""}
            onChange={(e) => setForm({ ...form, profile_summary: e.target.value })}
            placeholder="8 years PM. Shipped 2 LLM products. Based in Paris, open to remote. Looking for Senior/Lead PM at AI-native company."
          />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </Card>
    </div>
  );
}
