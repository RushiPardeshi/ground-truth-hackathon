export interface CategoryPreset {
  id: string;
  label: string;
  incumbents: string[];
  challengers: string[];
  vendorDomains: Record<string, string>;
  keywords: string[]; // generic category words for queries
}

export const CATEGORIES: CategoryPreset[] = [
  {
    id: "observability",
    label: "Observability",
    incumbents: ["Splunk", "New Relic", "Dynatrace"],
    challengers: ["Datadog", "Grafana", "Honeycomb", "Chronosphere"],
    vendorDomains: {
      Splunk: "splunk.com",
      "New Relic": "newrelic.com",
      Dynatrace: "dynatrace.com",
      Datadog: "datadoghq.com",
      Grafana: "grafana.com",
      Honeycomb: "honeycomb.io",
      Chronosphere: "chronosphere.io",
    },
    keywords: ["observability", "monitoring", "SRE"],
  },
];

export const USERS = ["Alex Rivera", "Jordan Lee", "Sam Patel"];

// Per-run cost caps
export const CAPS = { search: 15, pages: 25, research: 1, answer: 1 };

// You.com list prices (USD) from https://you.com/docs/administration/billing
export const PRICE = {
  search: 5 / 1000,
  contentsPage: 1 / 1000,
  research: 50 / 1000, // standard effort
  answer: 5 / 1000,
};

export const FRESH_HOURS = 6; // reuse shared research younger than this
export const STALE_MONTHS = 18;

export const LLM_MODEL = process.env.TRIPWIRE_LLM_MODEL || "claude-opus-5-5";

export const JOB_DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "ashbyhq.com",
  "myworkdayjobs.com",
];

// Deterministic homepage script signatures. Observability ones count for the category.
export const SCRIPT_SIGNATURES: { tool: string; pattern: string; category: string }[] = [
  { tool: "Datadog", pattern: "datadoghq-browser-agent.com", category: "observability" },
  { tool: "Datadog", pattern: "browser-intake-datadoghq", category: "observability" },
  { tool: "Datadog", pattern: "DD_RUM", category: "observability" },
  { tool: "New Relic", pattern: "js-agent.newrelic.com", category: "observability" },
  { tool: "New Relic", pattern: "bam.nr-data.net", category: "observability" },
  { tool: "New Relic", pattern: "NREUM", category: "observability" },
  { tool: "Dynatrace", pattern: "ruxitagentjs", category: "observability" },
  { tool: "Dynatrace", pattern: "dynatrace", category: "observability" },
  { tool: "Splunk", pattern: "splunk-rum", category: "observability" },
  { tool: "Splunk", pattern: "signalfx", category: "observability" },
  { tool: "Grafana", pattern: "grafana.net/collect", category: "observability" },
  { tool: "Grafana", pattern: "faro-web-sdk", category: "observability" },
  { tool: "Honeycomb", pattern: "honeycomb.io", category: "observability" },
  { tool: "Sentry", pattern: "browser.sentry-cdn.com", category: "observability" },
  { tool: "Sentry", pattern: "ingest.sentry.io", category: "observability" },
  { tool: "Segment", pattern: "cdn.segment.com", category: "other" },
  { tool: "HubSpot", pattern: "js.hs-scripts.com", category: "other" },
  { tool: "Marketo", pattern: "munchkin.marketo.net", category: "other" },
  { tool: "Intercom", pattern: "widget.intercom.io", category: "other" },
  { tool: "Drift", pattern: "js.driftt.com", category: "other" },
  { tool: "Zendesk", pattern: "static.zdassets.com", category: "other" },
  { tool: "Optimizely", pattern: "cdn.optimizely.com", category: "other" },
  { tool: "Hotjar", pattern: "static.hotjar.com", category: "other" },
  { tool: "Amplitude", pattern: "cdn.amplitude.com", category: "other" },
  { tool: "Mixpanel", pattern: "cdn.mxpnl.com", category: "other" },
  { tool: "OneTrust", pattern: "cdn.cookielaw.org", category: "other" },
  { tool: "Google Tag Manager", pattern: "googletagmanager.com", category: "other" },
];

export function getCategory(id: string): CategoryPreset {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}
