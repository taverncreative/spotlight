{
  "schema_version": 1,
  "project": {
    "id": "slug",              // stable, lowercase
    "name": "Display Name",
    "one_liner": "what it is in one sentence",
    "mission": "what the app is trying to be, 2-3 sentences",
    "stack": ["Next.js", "Supabase"],
    "status": "live" | "building" | "parked",
    "repo": "org/name"
  },
  "slices": [
    { "id": "slug", "title": "...", "state": "shipped" | "in_progress" | "planned" | "parked", "shipped_at": "YYYY-MM-DD or null", "note": "optional" }
  ],
  "ideas": ["uncommitted potential features, plain strings"],
  "blockers": [
    { "on": "john" | "external" | "none", "note": "..." }
  ],
  "report": { "generated_at": "ISO datetime", "type": "onboarding" | "situation", "summary": "3-5 sentence current state" }
}
