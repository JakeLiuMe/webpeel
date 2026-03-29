# WebPeel Progress Tracker

## Current Sprint

- [ ] Eval suite: smart-search automated tests (30+ cases)
- [ ] Eval suite: fetch endpoint automated tests (15+ cases)
- [ ] Post-deploy eval runner (CI-ready)
- [ ] Task locking for parallel agents
- [ ] Structured progress tracking

## Completed

- [x] Eval system scaffolding (agent: jarvis, date: 2026-03-28)
- [x] Smart search eval suite — 36 test cases across 6 categories (agent: jarvis, date: 2026-03-28)
- [x] Fetch eval suite — 16 test cases across 5 categories (agent: jarvis, date: 2026-03-28)
- [x] Task locking script (agent: jarvis, date: 2026-03-28)
- [x] Post-deploy eval runner (agent: jarvis, date: 2026-03-28)
- [x] npm scripts for eval commands (agent: jarvis, date: 2026-03-28)

## Blocked

_(nothing currently blocked)_

## Lessons Learned

- Smart search SSE responses need special handling — the endpoint streams events, but accepts non-streaming JSON responses too
- Fetch endpoint is async (job-based) — must poll `/v1/jobs/:id` for results
- Geo-routing is on `/v1/search` (not `/v1/search/smart`) — use `provider=auto` with `Accept-Language` header
- Safety field has 4 required fields: verified, promptInjectionsBlocked, maliciousPatternsStripped, sourcesChecked
- Trust scores use different scales: trust.score is 0-1, trust.source.score is 0-100
