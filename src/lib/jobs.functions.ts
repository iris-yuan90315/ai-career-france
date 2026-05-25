import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://connector-gateway.lovable.dev/firecrawl/v2";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function requireKeys() {
  const lovable = process.env.LOVABLE_API_KEY;
  const fc = process.env.FIRECRAWL_API_KEY;
  if (!lovable) throw new Error("LOVABLE_API_KEY not configured");
  if (!fc) throw new Error("FIRECRAWL_API_KEY not configured");
  return { lovable, fc };
}

async function firecrawlScrape(url: string): Promise<string> {
  const { lovable, fc } = requireKeys();
  const res = await fetch(`${GATEWAY}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": fc,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json?.data?.markdown ?? json?.markdown ?? "";
}

async function firecrawlSearch(query: string, limit = 15) {
  const { lovable, fc } = requireKeys();
  const res = await fetch(`${GATEWAY}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": fc,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl search failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const web = json?.data?.web ?? json?.web ?? json?.data ?? [];
  return Array.isArray(web) ? web : [];
}

type ExtractedJob = {
  title: string;
  url: string;
  location?: string;
  description?: string;
  seniority?: string;
  is_ai_native?: boolean;
  remote_ok?: boolean;
  france_ok?: boolean;
};

async function aiExtractJobs(
  markdown: string,
  sourceUrl: string,
  companyName: string | null,
): Promise<ExtractedJob[]> {
  const { lovable } = requireKeys();
  const sys = `You extract product manager job listings from career-page markdown.
Return ONLY jobs that look like PRODUCT roles (Product Manager, Product Lead, Head of Product, PM, Group PM, Director of Product, CPO).
Skip engineering, design, sales, marketing roles.
For each job, extract title, absolute URL, location, seniority, and booleans for is_ai_native (company/role is clearly AI-focused), remote_ok, france_ok (based in France or open to France remote).
If you find no PM roles, return an empty array.`;

  const userMsg = `Source URL: ${sourceUrl}
Company hint: ${companyName ?? "unknown"}

Markdown:
${markdown.slice(0, 18000)}`;

  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_jobs",
            description: "Return extracted PM jobs",
            parameters: {
              type: "object",
              properties: {
                jobs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                      location: { type: "string" },
                      description: { type: "string" },
                      seniority: { type: "string" },
                      is_ai_native: { type: "boolean" },
                      remote_ok: { type: "boolean" },
                      france_ok: { type: "boolean" },
                    },
                    required: ["title", "url"],
                  },
                },
              },
              required: ["jobs"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_jobs" } },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI extract failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const args =
    json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}";
  try {
    const parsed = JSON.parse(args);
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

async function aiScoreJob(
  job: {
    title: string;
    description?: string;
    location?: string;
    is_ai_native?: boolean;
    remote_ok?: boolean;
    france_ok?: boolean;
  },
  prefs: {
    locations: string[];
    seniorities: string[];
    keywords_include: string[];
    keywords_exclude: string[];
    profile_summary: string | null;
  },
): Promise<{ score: number; reason: string }> {
  const { lovable } = requireKeys();
  const sys = `You score how well a job matches a candidate's preferences for an AI-native Product Manager role.
Return a score 0-100 (higher = better fit) and a one-sentence reason.
Heavy weight on: matches preferred locations, AI-native company, seniority match, includes keywords, excludes exclusion keywords.`;
  const user = `PREFERENCES:
Locations wanted: ${prefs.locations.join(", ")}
Seniorities: ${prefs.seniorities.join(", ")}
Include keywords: ${prefs.keywords_include.join(", ")}
Exclude keywords: ${prefs.keywords_exclude.join(", ") || "none"}
Profile: ${prefs.profile_summary ?? "n/a"}

JOB:
Title: ${job.title}
Location: ${job.location ?? "?"} | remote_ok=${job.remote_ok} | france_ok=${job.france_ok} | ai_native=${job.is_ai_native}
Description: ${(job.description ?? "").slice(0, 1500)}`;

  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "score",
            parameters: {
              type: "object",
              properties: {
                score: { type: "number" },
                reason: { type: "string" },
              },
              required: ["score", "reason"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "score" } },
    }),
  });
  if (!res.ok) return { score: 0, reason: "scoring unavailable" };
  const json = await res.json();
  const args =
    json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "{}";
  try {
    const parsed = JSON.parse(args);
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 0))),
      reason: parsed.reason ?? "",
    };
  } catch {
    return { score: 0, reason: "" };
  }
}

async function loadPrefs() {
  const { data } = await supabaseAdmin
    .from("preferences")
    .select("*")
    .eq("id", 1)
    .single();
  return {
    locations: (data?.locations ?? ["Remote", "France"]) as string[],
    seniorities: (data?.seniorities ?? ["Senior", "Lead"]) as string[],
    keywords_include: (data?.keywords_include ?? ["AI", "product"]) as string[],
    keywords_exclude: (data?.keywords_exclude ?? []) as string[],
    profile_summary: (data?.profile_summary ?? null) as string | null,
  };
}

function absUrl(u: string, base: string): string {
  try {
    return new URL(u, base).toString();
  } catch {
    return u;
  }
}

async function processAndStoreJobs(
  extracted: ExtractedJob[],
  base: string,
  companyId: string | null,
  companyName: string | null,
  source: string,
): Promise<number> {
  if (extracted.length === 0) return 0;
  const prefs = await loadPrefs();
  let added = 0;

  for (const j of extracted) {
    const url = absUrl(j.url, base);
    // Skip if already stored
    const { data: existing } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("url", url)
      .maybeSingle();
    if (existing) continue;

    const scoreRes = await aiScoreJob(
      {
        title: j.title,
        description: j.description,
        location: j.location,
        is_ai_native: j.is_ai_native,
        remote_ok: j.remote_ok,
        france_ok: j.france_ok,
      },
      prefs,
    );

    const { error } = await supabaseAdmin.from("jobs").insert({
      company_id: companyId,
      company_name: companyName,
      title: j.title,
      url,
      location: j.location ?? null,
      description: j.description ?? null,
      seniority: j.seniority ?? null,
      is_ai_native: !!j.is_ai_native,
      remote_ok: !!j.remote_ok,
      france_ok: !!j.france_ok,
      fit_score: scoreRes.score,
      fit_reason: scoreRes.reason,
      source,
    });
    if (!error) added++;
  }
  return added;
}

export const refreshCompany = createServerFn({ method: "POST" })
  .inputValidator((d: { companyId: string }) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", data.companyId)
      .single();
    if (error || !company) throw new Error("Company not found");

    const md = await firecrawlScrape(company.careers_url);
    const extracted = await aiExtractJobs(md, company.careers_url, company.name);
    const added = await processAndStoreJobs(
      extracted,
      company.careers_url,
      company.id,
      company.name,
      "company",
    );

    await supabaseAdmin
      .from("companies")
      .update({ last_scraped_at: new Date().toISOString() })
      .eq("id", company.id);

    return { added, found: extracted.length };
  });

export const refreshAllCompanies = createServerFn({ method: "POST" }).handler(async () => {
  const { data: companies } = await supabaseAdmin.from("companies").select("*");
  let totalAdded = 0;
  let totalFound = 0;
  const errors: string[] = [];
  for (const c of companies ?? []) {
    try {
      const md = await firecrawlScrape(c.careers_url);
      const extracted = await aiExtractJobs(md, c.careers_url, c.name);
      const added = await processAndStoreJobs(extracted, c.careers_url, c.id, c.name, "company");
      totalAdded += added;
      totalFound += extracted.length;
      await supabaseAdmin
        .from("companies")
        .update({ last_scraped_at: new Date().toISOString() })
        .eq("id", c.id);
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  return { added: totalAdded, found: totalFound, errors };
});

export const addJobFromUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string }) => z.object({ url: z.string().url() }).parse(d))
  .handler(async ({ data }) => {
    const md = await firecrawlScrape(data.url);
    const extracted = await aiExtractJobs(md, data.url, null);
    // For a single JD page, force one job with the source URL if AI returns nothing
    if (extracted.length === 0) {
      extracted.push({ title: "Imported role", url: data.url, description: md.slice(0, 4000) });
    }
    const added = await processAndStoreJobs(extracted, data.url, null, null, "manual");
    return { added, found: extracted.length };
  });

export const searchWeb = createServerFn({ method: "POST" })
  .inputValidator((d: { query: string }) =>
    z.object({ query: z.string().min(3).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const results = await firecrawlSearch(data.query, 10);
    // Insert each result as a candidate job (AI will score them based on title/desc only)
    const prefs = await loadPrefs();
    let added = 0;
    for (const r of results) {
      const url = r.url;
      if (!url) continue;
      const { data: existing } = await supabaseAdmin
        .from("jobs")
        .select("id")
        .eq("url", url)
        .maybeSingle();
      if (existing) continue;
      const job = {
        title: r.title ?? "Untitled role",
        description: r.description ?? r.snippet ?? "",
        location: undefined as string | undefined,
        is_ai_native: /ai|llm|ml/i.test((r.title ?? "") + " " + (r.description ?? "")),
        remote_ok: /remote/i.test((r.title ?? "") + " " + (r.description ?? "")),
        france_ok: /france|paris|lyon/i.test((r.title ?? "") + " " + (r.description ?? "")),
      };
      const score = await aiScoreJob(job, prefs);
      const { error } = await supabaseAdmin.from("jobs").insert({
        title: job.title,
        url,
        description: job.description,
        is_ai_native: job.is_ai_native,
        remote_ok: job.remote_ok,
        france_ok: job.france_ok,
        fit_score: score.score,
        fit_reason: score.reason,
        source: "search",
      });
      if (!error) added++;
    }
    return { added, found: results.length };
  });

export const rescoreAll = createServerFn({ method: "POST" }).handler(async () => {
  const prefs = await loadPrefs();
  const { data: jobs } = await supabaseAdmin
    .from("jobs")
    .select("id,title,description,location,is_ai_native,remote_ok,france_ok");
  let updated = 0;
  for (const j of jobs ?? []) {
    const s = await aiScoreJob(j, prefs);
    await supabaseAdmin
      .from("jobs")
      .update({ fit_score: s.score, fit_reason: s.reason })
      .eq("id", j.id);
    updated++;
  }
  return { updated };
});
