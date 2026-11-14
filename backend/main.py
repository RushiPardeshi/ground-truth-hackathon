import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
try:
    from scanner import IntelligenceEngine
except ImportError:
    from backend.scanner import IntelligenceEngine

app = FastAPI(
    title="Receipts: Sales Intelligence API",
    description="Live on-demand sales intelligence with 100% cited receipts powered by You.com",
    version="1.0.0"
)

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = IntelligenceEngine()


class ScanRequest(BaseModel):
    company_name: str
    domain: str
    competitors: Optional[List[str]] = ["DocuSign", "PandaDoc", "Adobe Sign", "HelloSign", "Concord"]


class LeadDiscoveryRequest(BaseModel):
    industry: Optional[str] = "design agency"
    target_competitors: Optional[List[str]] = ["DocuSign", "PandaDoc"]


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Receipts Intel Engine",
        "has_ydc_key": bool(os.getenv("YDC_API_KEY"))
    }


@app.post("/api/scan")
def scan_account(req: ScanRequest):
    if not req.company_name or not req.domain:
        raise HTTPException(status_code=400, detail="company_name and domain are required")
    
    try:
        result = engine.run_full_scan(
            company_name=req.company_name,
            domain=req.domain,
            competitors=req.competitors
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/leads/discover")
def discover_leads(req: LeadDiscoveryRequest):
    """
    Finds real target companies (e.g. design agencies / studios) whose public postings
    or web footprints show they use incumbent contract tools.
    """
    comp_query = " OR ".join([f'"{c}"' for c in req.target_competitors])
    search_query = f'"{req.industry}" ({comp_query}) ("careers" OR "jobs" OR "proposals" OR "client agreements")'
    
    hits = engine.client.search(search_query, count=6)
    
    discovered_leads = []
    for hit in hits:
        discovered_leads.append({
            "title": hit.get("title"),
            "url": hit.get("url"),
            "description": hit.get("description"),
            "snippets": hit.get("snippets", []),
            "detected_signal": f"Public footprint matches target industry ({req.industry}) and competitor software usage."
        })
    
    return {
        "industry": req.industry,
        "competitors_searched": req.target_competitors,
        "query": search_query,
        "leads": discovered_leads
    }


@app.get("/api/samples")
def get_sample_targets():
    """Returns curated demo targets ready for instant evaluation."""
    return [
        {
            "name": "Pentagram",
            "domain": "pentagram.com",
            "industry": "Design & Brand Consultancy",
            "competitors": ["DocuSign", "PandaDoc", "Adobe Sign"]
        },
        {
            "name": "Huge Inc",
            "domain": "hugeinc.com",
            "industry": "Creative & Digital Agency",
            "competitors": ["DocuSign", "PandaDoc", "Adobe Sign"]
        },
        {
            "name": "IDEO",
            "domain": "ideo.com",
            "industry": "Global Design & Innovation",
            "competitors": ["DocuSign", "PandaDoc"]
        },
        {
            "name": "MetaLab",
            "domain": "metalab.com",
            "industry": "Product Design Agency",
            "competitors": ["DocuSign", "PandaDoc"]
        }
    ]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
