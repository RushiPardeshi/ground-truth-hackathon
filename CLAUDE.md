# Tripwire

Project context lives in Sean's vault hub: `~/Documents/Sean's Vault/Tripwire/Tripwire.md`. Read it before starting; update it with results (not transcripts) before finishing.

- Run: `npm run dev` (needs `.env.local`, see `.env.example`). CLI: `npm run research -- "Company" domain`.
- All web data comes from You.com (Search, Contents, Research, Answer). Don't add other search/scrape services.
- Never show a claim without URL + verbatim quote + date; quotes are verified against page text in `lib/pipeline.ts`.
