import os
import re
import json
import time
from typing import List, Dict, Any, Optional
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

YDC_API_KEY = os.getenv("YDC_API_KEY")
YDC_SEARCH_URL = "https://ydc-index.io/v1/search"
YDC_CONTENTS_URL = "https://ydc-index.io/v1/contents"

# Known script and tag patterns for deterministic hard proof (Tier 1: Confirmed)
SCRIPT_SIGNATURES = [
    # E-Signature & Contracts
    {"tool": "DocuSign", "category": "Contract / E-Sign", "pattern": r"(docusign|docusign-cors|docusign\.net|docucdn)", "is_competitor": True},
    {"tool": "PandaDoc", "category": "Contract / E-Sign", "pattern": r"(pandadoc\.com|pandadoc-static)", "is_competitor": True},
    {"tool": "Adobe Sign / Acrobat", "category": "Contract / E-Sign", "pattern": r"(echosign|adobesign)", "is_competitor": True},
    {"tool": "HelloSign / Dropbox Sign", "category": "Contract / E-Sign", "pattern": r"(hellosign\.com|dropboxsign)", "is_competitor": True},
    {"tool": "Ironclad", "category": "Contract Lifecycle", "pattern": r"(ironcladapp\.com)", "is_competitor": True},
    {"tool": "Concord", "category": "Contract / E-Sign", "pattern": r"(concordnow\.com)", "is_competitor": True},

    # CRM, Marketing & Sales Tech
    {"tool": "HubSpot", "category": "CRM & Marketing", "pattern": r"(js\.hs-scripts\.com|hsforms\.net|hubspot\.com)"},
    {"tool": "Marketo", "category": "Marketing Automation", "pattern": r"(munchkin\.marketo\.net|marketo\.com)"},
    {"tool": "Salesforce / Pardot", "category": "Marketing Automation", "pattern": r"(pardot\.com|salesforce\.com)"},
    {"tool": "Intercom", "category": "Customer Support & Chat", "pattern": r"(widget\.intercom\.io|intercomcdn\.com)"},
    {"tool": "Zendesk", "category": "Customer Support & Chat", "pattern": r"(static\.zdassets\.com|ekr\.zdassets\.com)"},
    {"tool": "Drift", "category": "Live Chat / Conversational", "pattern": r"(js\.driftt\.com)"},

    # Product Analytics & CDP
    {"tool": "Segment", "category": "Customer Data Platform", "pattern": r"(cdn\.segment\.com/analytics\.js)"},
    {"tool": "PostHog", "category": "Product Analytics", "pattern": r"(app\.posthog\.com|us\.posthog\.com|eu\.posthog\.com)"},
    {"tool": "Mixpanel", "category": "Product Analytics", "pattern": r"(cdn\.mxpnl\.com|mixpanel\.com)"},
    {"tool": "Amplitude", "category": "Product Analytics", "pattern": r"(cdn\.amplitude\.com)"},
    {"tool": "Google Analytics", "category": "Web Analytics", "pattern": r"(googletagmanager\.com/gtag|google-analytics\.com)"},

    # Consent & Compliance
    {"tool": "OneTrust", "category": "Consent & Compliance", "pattern": r"(cdn\.cookielaw\.org|onetrust\.com)"},
    {"tool": "Cookiebot", "category": "Consent & Compliance", "pattern": r"(consent\.cookiebot\.com)"},

    # Web & Hosting
    {"tool": "Webflow", "category": "CMS & Hosting", "pattern": r"(assets\.website-files\.com|webflow\.com)"},
    {"tool": "Framer", "category": "CMS & Hosting", "pattern": r"(framerusercontent\.com|events\.framer\.com)"},
    {"tool": "WordPress", "category": "CMS & Hosting", "pattern": r"(wp-content|wp-includes)"},
    
    # Careers / Embedded ATS
    {"tool": "Greenhouse", "category": "Applicant Tracking", "pattern": r"(boards\.greenhouse\.io|greenhouse\.io)"},
    {"tool": "Lever", "category": "Applicant Tracking", "pattern": r"(jobs\.lever\.co|lever\.co)"},
    {"tool": "Ashby", "category": "Applicant Tracking", "pattern": r"(jobs\.ashbyhq\.com|ashbyhq\.com)"},
]

MIGRATION_KEYWORDS = [
    "migrate", "migration", "migrating",
    "replace", "replacing", "replacement",
    "transition", "transitioning", "move away from",
    "deprecat", "sunset", "moderniz", "switch from", "offload"
]


class YouComClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or YDC_API_KEY
        if not self.api_key:
            print("Warning: YDC_API_KEY not found in environment.")

    def search(self, query: str, count: int = 5) -> List[Dict[str, Any]]:
        """Call You.com Web Search API."""
        if not self.api_key:
            return []
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json"
        }
        payload = {"query": query, "count": count}
        try:
            resp = requests.post(YDC_SEARCH_URL, headers=headers, json=payload, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("results", {}).get("web", [])
            else:
                print(f"YDC Search error [{resp.status_code}]: {resp.text[:200]}")
                return []
        except Exception as e:
            print(f"Exception calling YDC search: {e}")
            return []

    def get_contents(self, urls: List[str]) -> List[Dict[str, Any]]:
        """Call You.com Contents API to get raw HTML / text."""
        if not self.api_key or not urls:
            return []
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json"
        }
        payload = {"urls": urls}
        try:
            resp = requests.post(YDC_CONTENTS_URL, headers=headers, json=payload, timeout=15)
            if resp.status_code == 200:
                return resp.json()
            else:
                print(f"YDC Contents error [{resp.status_code}]: {resp.text[:200]}")
                return []
        except Exception as e:
            print(f"Exception calling YDC contents: {e}")
            return []


class IntelligenceEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.client = YouComClient(api_key)
        self.snapshots_dir = os.path.join(os.path.dirname(__file__), "snapshots")
        os.makedirs(self.snapshots_dir, exist_ok=True)

    def scan_website_scripts(self, domain: str) -> List[Dict[str, Any]]:
        """Fetch target homepage HTML via Contents API or fallback fetch, detect third-party scripts."""
        clean_domain = domain.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        target_url = f"https://{clean_domain}"
        
        detected_tools = []
        html_content = ""
        
        # 1. Try You.com Contents API
        contents = self.client.get_contents([target_url])
        if contents and len(contents) > 0:
            html_content = contents[0].get("html", "")
            
        # Fallback to direct fetch if Contents API is empty or blocked
        if not html_content:
            try:
                res = requests.get(target_url, timeout=6, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
                if res.status_code == 200:
                    html_content = res.text
            except Exception as e:
                print(f"Direct fetch failed for {target_url}: {e}")

        if not html_content:
            return []

        # Find script tags and match signatures
        script_matches = re.findall(r"(<script[^>]*src=[\"']([^\"']+)[\"'][^>]*>.*?</script>|<script[^>]*src=[\"']([^\"']+)[\"'][^>]*/>|<script[^>]*src=[\"']([^\"']+)[\"'][^>]*>)", html_content, re.IGNORECASE)
        
        found_signatures = set()
        for match_tuple in script_matches:
            raw_tag = match_tuple[0]
            src_url = match_tuple[1] or match_tuple[2] or match_tuple[3]
            
            for sig in SCRIPT_SIGNATURES:
                if sig["tool"] not in found_signatures and re.search(sig["pattern"], src_url, re.IGNORECASE):
                    found_signatures.add(sig["tool"])
                    detected_tools.append({
                        "tool": sig["tool"],
                        "category": sig["category"],
                        "confidence": "Confirmed",
                        "confidence_score": 1.0,
                        "evidence_type": "Client-Side Script Tag",
                        "receipt": {
                            "source_url": target_url,
                            "tag_snippet": raw_tag[:200],
                            "matched_pattern": sig["pattern"],
                            "discovered_at": time.strftime("%Y-%m-%d %H:%M:%S")
                        },
                        "is_competitor": sig.get("is_competitor", False)
                    })

        return detected_tools

    def scan_job_signals(self, company_name: str, competitors: List[str]) -> List[Dict[str, Any]]:
        """Search job postings across Greenhouse, Lever, Ashby and general web for tech stack & migration signals."""
        signals = []
        
        # Build focused queries
        comp_or = " OR ".join([f'"{c}"' for c in competitors])
        queries = [
            f'site:boards.greenhouse.io "{company_name}" ({comp_or} OR contract OR "sales ops" OR revops)',
            f'site:jobs.lever.co "{company_name}" ({comp_or} OR contract OR "sales ops" OR revops)',
            f'site:jobs.ashbyhq.com "{company_name}" ({comp_or} OR contract OR "sales ops" OR revops)',
            f'"{company_name}" (careers OR jobs) ({comp_or})'
        ]

        seen_urls = set()
        for q in queries:
            results = self.client.search(q, count=4)
            for item in results:
                url = item.get("url", "")
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                
                title = item.get("title", "Job Posting")
                desc = item.get("description", "")
                snippets = item.get("snippets", [])
                full_text = f"{desc} {' '.join(snippets)}"
                
                # Check for competitor mentions
                mentioned_tools = [c for c in competitors if re.search(r'\b' + re.escape(c) + r'\b', full_text, re.IGNORECASE)]
                
                # Check for migration triggers
                is_migration = any(kw in full_text.lower() for kw in MIGRATION_KEYWORDS)
                
                # Identify best quote
                best_quote = ""
                for s in snippets:
                    if any(t.lower() in s.lower() for t in competitors) or any(kw in s.lower() for kw in MIGRATION_KEYWORDS):
                        best_quote = s
                        break
                if not best_quote and snippets:
                    best_quote = snippets[0]
                elif not best_quote:
                    best_quote = desc[:250]

                signals.append({
                    "title": title,
                    "url": url,
                    "mentioned_tools": mentioned_tools,
                    "is_migration": is_migration,
                    "confidence": "Strong",
                    "confidence_score": 0.9 if is_migration else 0.85,
                    "receipt": {
                        "source_url": url,
                        "quote": best_quote,
                        "source_type": "ATS Job Posting",
                        "discovered_at": time.strftime("%Y-%m-%d %H:%M:%S")
                    }
                })

        return signals

    def scan_vendor_proof(self, company_name: str, competitors: List[str]) -> List[Dict[str, Any]]:
        """Search for public vendor case studies, customer stories, or announcements."""
        proofs = []
        for comp in competitors:
            query = f'"{comp}" ("customers" OR "case study" OR "customer story") "{company_name}"'
            results = self.client.search(query, count=3)
            for res in results:
                url = res.get("url", "")
                title = res.get("title", "")
                snippets = res.get("snippets", [])
                desc = res.get("description", "")
                
                # Check if it looks like an authentic case study or customer confirmation
                text_combined = f"{title} {desc} {' '.join(snippets)}".lower()
                if company_name.lower() in text_combined and comp.lower() in text_combined:
                    proofs.append({
                        "competitor": comp,
                        "title": title,
                        "url": url,
                        "confidence": "Confirmed",
                        "confidence_score": 0.95,
                        "receipt": {
                            "source_url": url,
                            "quote": snippets[0] if snippets else desc[:200],
                            "source_type": "Vendor Case Study / Press Release",
                            "discovered_at": time.strftime("%Y-%m-%d %H:%M:%S")
                        }
                    })
        return proofs

    def generate_why_now_brief(
        self,
        company_name: str,
        domain: str,
        script_tools: List[Dict[str, Any]],
        job_signals: List[Dict[str, Any]],
        vendor_proofs: List[Dict[str, Any]],
        my_product: str = "Terms.so",
        my_value_prop: str = "Browser-based markdown contracts with zero-seat tax, inline redlining, and instant counterparty signing"
    ) -> Dict[str, Any]:
        """Synthesize findings into an actionable executive brief and ready-to-send outbound pitch."""
        
        # 1. Determine key trigger
        competitor_names = set()
        for t in script_tools:
            if t.get("is_competitor"):
                competitor_names.add(t["tool"])
        for j in job_signals:
            for m in j.get("mentioned_tools", []):
                competitor_names.add(m)
        for v in vendor_proofs:
            competitor_names.add(v.get("competitor"))

        comp_str = ", ".join(competitor_names) if competitor_names else "legacy PDF/e-sign platforms (DocuSign/PandaDoc)"
        
        # Migration signal check
        migration_jobs = [j for j in job_signals if j.get("is_migration")]
        
        if migration_jobs:
            trigger_summary = f"Active Migration Trigger: {company_name} is actively hiring ({migration_jobs[0]['title']}) with explicit requirements to modernize contract and revenue operations workflows."
            best_job = migration_jobs[0]
        elif job_signals:
            trigger_summary = f"Hiring Trigger: {company_name} recently posted roles referencing {comp_str} for sales and legal document execution."
            best_job = job_signals[0]
        else:
            trigger_summary = f"Tech Footprint Trigger: Verifiable client-side and public footprints confirm {company_name} relies on {comp_str}."
            best_job = None

        primary_receipt_url = best_job["receipt"]["source_url"] if best_job else (script_tools[0]["receipt"]["source_url"] if script_tools else f"https://{domain}")
        primary_quote = best_job["receipt"]["quote"] if best_job else (script_tools[0]["receipt"]["tag_snippet"] if script_tools else "Verified public footprint")

        # 2. Draft cold outbound email
        subject = f"Question regarding {company_name}'s contract workflows & {comp_str.split(',')[0]}"
        email_body = (
            f"Hi [First Name],\n\n"
            f"I saw that {company_name} is actively expanding your team and managing agreements via {comp_str.split(',')[0]} "
            f"(spotted via your recent {best_job['title'] if best_job else 'public team postings'}).\n\n"
            f"Most agencies and fast-scaling teams find that legacy PDF signing tools stall deal closings—counterparties print, download, or get confused by rigid fields. "
            f"With {my_product}, agreements live in living markdown documents: counterparties comment inline, negotiate in real-time, and sign with a typed signature with zero login friction.\n\n"
            f"Would you be open to a 10-minute walk-through on how {company_name} can eliminate contract lag?\n\n"
            f"Best regards,\n[Your Name]\n\n"
            f"---\n"
            f"Receipt proof: {primary_receipt_url}\n"
            f"Evidence: \"{primary_quote[:140]}...\""
        )

        return {
            "target_company": company_name,
            "target_domain": domain,
            "competitor_stack": list(competitor_names),
            "trigger_summary": trigger_summary,
            "target_persona": "Head of Operations / RevOps Director / Managing Partner",
            "recommended_angle": f"Position {my_product} as the frictionless, living-document alternative to {comp_str}, eliminating seat licensing overhead and agreement turnaround lag.",
            "outbound_email": {
                "subject": subject,
                "body": email_body,
                "cited_receipt_url": primary_receipt_url,
                "cited_quote": primary_quote
            }
        }

    def save_and_diff_snapshot(self, domain: str, current_data: Dict[str, Any]) -> Dict[str, Any]:
        """Compare current scan against previous snapshot and compute live diff for the Signal Watcher."""
        clean_domain = domain.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        filepath = os.path.join(self.snapshots_dir, f"{clean_domain}.json")
        
        diff = {
            "has_previous_run": False,
            "new_tools_detected": [],
            "new_jobs_detected": [],
            "status_message": "Initial scan completed. Baseline snapshot established."
        }
        
        if os.path.exists(filepath):
            try:
                with open(filepath, "r") as f:
                    prev_data = json.load(f)
                
                diff["has_previous_run"] = True
                prev_tools = {t["tool"] for t in prev_data.get("script_tools", [])}
                curr_tools = {t["tool"] for t in current_data.get("script_tools", [])}
                diff["new_tools_detected"] = list(curr_tools - prev_tools)

                prev_job_urls = {j["url"] for j in prev_data.get("job_signals", [])}
                diff["new_jobs_detected"] = [
                    j for j in current_data.get("job_signals", [])
                    if j["url"] not in prev_job_urls
                ]
                
                new_count = len(diff["new_tools_detected"]) + len(diff["new_jobs_detected"])
                if new_count > 0:
                    diff["status_message"] = f"🚨 Watcher Alert: {len(diff['new_jobs_detected'])} new job signals and {len(diff['new_tools_detected'])} new tool footprints detected since last scan!"
                else:
                    diff["status_message"] = "✓ Verified: All footprints match baseline snapshot. No new signals detected."
            except Exception as e:
                print(f"Error reading previous snapshot: {e}")

        # Save current snapshot
        try:
            with open(filepath, "w") as f:
                json.dump(current_data, f, indent=2)
        except Exception as e:
            print(f"Error writing snapshot: {e}")

        return diff

    def run_full_scan(
        self,
        company_name: str,
        domain: str,
        competitors: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Orchestrate the full on-demand intelligence scan."""
        if competitors is None:
            competitors = ["DocuSign", "PandaDoc", "Adobe Sign", "HelloSign", "Concord"]

        # 1. Parallel / sequential scans
        script_tools = self.scan_website_scripts(domain)
        job_signals = self.scan_job_signals(company_name, competitors)
        vendor_proofs = self.scan_vendor_proof(company_name, competitors)

        # 2. Synthesize "Why Now" & Outreach playbook
        why_now = self.generate_why_now_brief(
            company_name, domain, script_tools, job_signals, vendor_proofs
        )

        scan_result = {
            "company_name": company_name,
            "domain": domain,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "competitors_evaluated": competitors,
            "script_tools": script_tools,
            "job_signals": job_signals,
            "vendor_proofs": vendor_proofs,
            "why_now": why_now
        }

        # 3. Compute live watcher diff
        diff = self.save_and_diff_snapshot(domain, scan_result)
        scan_result["diff"] = diff

        return scan_result
