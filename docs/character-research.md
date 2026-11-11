# Character portrayal research during setup

The Companion Generator looks up character portrayal online by default. Enter a
name and franchise in the description and optionally specify a version,
adaptation, or season. The generated personality, backstory, and speaking style
use the returned reference excerpts. Review and edit the draft before saving.
Those fields already feed the companion's chat persona and starter memory.

The review screen links to the actual search sources. `sources_found` means
reference material was retrieved, not that every generated claim was verified.
Unavailable/empty searches show an unverified-draft message rather than an
"AI Researched" badge. The saved Character retains `canon_research` with the
source excerpts, URLs, research status, and requested version for provenance;
these excerpts are not inserted as new instructions into subsequent chats.

Users can turn off online research for private or original descriptions. The
original-Anima Awakening Ceremony explicitly skips search. A description and
version can leave the application for the selected search service when research
is enabled; the generator explains this next to the control.

## Runtime

The server uses the configured Brave/Serper adapter, otherwise Tavily when
`TAVILY_API_KEY` is available. With no search keys it requests public Wikipedia
article introductions through a single bounded query. `ANIMA_SEARCH_PROVIDER=off`
or `none` disables setup research too. Each provider request has a timeout and
returns at most five sources. Existing authenticated invoke rate limits apply.
Search keys stay on the server. Tavily is now included in the Worker's runtime
environment allowlist; operators still need to supply a secret binding if they
choose that provider. No new secrets or migrations are applied by this change.

The existing `generateCharacterTraits`/Wikipedia aliases use the same research
service and return `research` metadata alongside their existing trait fields.
The generator accepts `research_online: false` and `canon_version` in addition
to its existing `prompt` input. Existing callers remain compatible.

Research instructions tell the model to distinguish adaptations, prefer official
material when available, identify ambiguity, avoid invented quotes, and treat
all source text as untrusted reference data. Retrieval does not guarantee canon
accuracy; the profile remains an editable draft.
