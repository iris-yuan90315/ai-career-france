import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function requireKeys() {
  const lovable = process.env.LOVABLE_API_KEY;
  const fc = process.env.FIRECRAWL_API_KEY;
  if (!lovable) throw new Error("LOVABLE_API_KEY not configured");
  if (!fc) throw new Error("FIRECRAWL_API_KEY not configured");
  return { lovable, fc };
}

async function firecrawlScrape(url: string): Promise<string> {
  const { fc } = requireKeys();
  const res = await fetch(`${FIRECRAWL_URL}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fc}`,
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
  const { fc } = requireKeys();
  const res = await fetch(`${FIRECRAWL_URL}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fc}`,
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
  const text = await res.text();
  if (!text) return [];
  let json: any;
  try { json = JSON.parse(text); } catch { return []; }
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
  const text = await res.text();
  if (!text) return { score: 0, reason: "empty response" };
  let json: any;
  try { json = JSON.parse(text); } catch { return { score: 0, reason: "bad json" }; }
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

function normalizeJobSearchQuery(query: string) {
  const trimmed = query.trim();
  if (/\b(job|jobs|career|careers|hiring|opening|openings|role|roles)\b/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} jobs careers`;
}

function isLikelyJobResult(result: { title?: string; url?: string; description?: string }) {
  const text = `${result.title ?? ""} ${result.description ?? ""} ${result.url ?? ""}`.toLowerCase();
  const positiveSignals = [
    /\b(job|jobs|hiring|opening|openings|apply|application|career|careers|position|vacancy)\b/,
    /greenhouse|lever|ashby|workday|smartrecruiters|job-boards|jobs\./,
    /builtin|wellfound|indeed|ziprecruiter|welcome to the jungle|aijobs/,
  ];
  const negativeSignals = [
    /\breddit\b|\byoutube\b|\bmedium\b|community\.|forum|discussion/,
    /\bcertificate\b|\bcourse\b|\bbadge\b|\btraining\b|bootcamp/,
    /what is|how to become|where to start|anyway|guide|blog|insight|article/,
  ];

  return positiveSignals.some((pattern) => pattern.test(text)) && !negativeSignals.some((pattern) => pattern.test(text));
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
    const baseQuery = normalizeJobSearchQuery(data.query);
    const searchQueries = [
      baseQuery,
      `site:greenhouse.io ${data.query}`,
      `site:lever.co ${data.query}`,
    ];

    const rawResults = await Promise.all(
      searchQueries.map((query) => firecrawlSearch(query, 6).catch(() => [])),
    );
    const dedupedResults = rawResults
      .flat()
      .filter((result) => result?.url)
      .filter((result, index, arr) => arr.findIndex((item) => item.url === result.url) === index);
    const results = dedupedResults.filter(isLikelyJobResult).slice(0, 10);
    const prefs = await loadPrefs();

    const urls = results.map((r) => r.url).filter(Boolean) as string[];
    const { data: existingRows } = urls.length
      ? await supabaseAdmin.from("jobs").select("url").in("url", urls)
      : { data: [] as { url: string }[] };
    const existingSet = new Set((existingRows ?? []).map((r) => r.url));
    const fresh = results.filter((r) => r.url && !existingSet.has(r.url));

    // Score in parallel to avoid worker timeout
    const scored = await Promise.all(
      fresh.map(async (r) => {
        const text = (r.title ?? "") + " " + (r.description ?? r.snippet ?? "");
        const job = {
          title: r.title ?? "Untitled role",
          description: r.description ?? r.snippet ?? "",
          is_ai_native: /ai|llm|ml/i.test(text),
          remote_ok: /remote/i.test(text),
          france_ok: /france|paris|lyon/i.test(text),
        };
        const score = await aiScoreJob(job, prefs).catch(() => ({ score: 50, reason: "default" }));
        return { r, job, score };
      }),
    );

    // Dedupe within the batch (firecrawl can return same URL twice)
    const seen = new Set<string>();
    const rows = scored
      .filter(({ r }) => {
        if (!r.url || seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .map(({ r, job, score }) => ({
        title: job.title,
        url: r.url,
        description: job.description,
        is_ai_native: job.is_ai_native,
        remote_ok: job.remote_ok,
        france_ok: job.france_ok,
        fit_score: score.score,
        fit_reason: score.reason,
        source: "search",
      }));

    let added = 0;
    const errors: string[] = [];
    if (rows.length) {
      // Upsert with ignoreDuplicates so a single conflict doesn't drop the batch
      const { data: inserted, error } = await supabaseAdmin
        .from("jobs")
        .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
        .select("id");
      if (error) errors.push(error.message);
      else added = inserted?.length ?? 0;
    }
    return { added, found: results.length, errors };
  });

export const rescoreAll = createServerFn({ method: "POST" }).handler(async () => {
  const prefs = await loadPrefs();
  const { data: jobs } = await supabaseAdmin
    .from("jobs")
    .select("id,title,description,location,is_ai_native,remote_ok,france_ok");
  let updated = 0;
  for (const j of jobs ?? []) {
    const s = await aiScoreJob({
      title: j.title,
      description: j.description ?? undefined,
      location: j.location ?? undefined,
      is_ai_native: j.is_ai_native ?? undefined,
      remote_ok: j.remote_ok ?? undefined,
      france_ok: j.france_ok ?? undefined,
    }, prefs);
    await supabaseAdmin
      .from("jobs")
      .update({ fit_score: s.score, fit_reason: s.reason })
      .eq("id", j.id);
    updated++;
  }
  return { updated };
});
