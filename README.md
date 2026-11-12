# dsh-archived-cleanup

A DeepSeek Harness plugin that lists archived conversations and deletes them
permanently — freeing their logs, cached projections, and workspace entries.

Archived conversations are hidden from the sidebar but their logs stay on disk
forever, so `~/.dsh/sessions` grows without bound. Harness ships no deletion
API; this plugin adds one, with two callers over a single implementation: a
settings page and an agent tool.

## What it deletes

For each archived session, in this order:

| Step | Target | Why this order |
|---|---|---|
| 1 | Session log directory `~/.dsh/sessions/<project>/<session-id>/` | Physical bytes |
| 2 | Projection cache record in the `session_projcache` domain | Derived data |
| 3 | Workspace accounting (detach from every workspace) | UI grouping |
| 4 | The archive-set entry itself | Last, so a partial failure never hides a session it failed to delete |

## Safety rules

- Only **archived** sessions are touched. Passing `allowNonArchived: true`
  relaxes this.
- A session with a **live agent** is always refused.
- Before removing a directory, both the file name and the parent directory name
  are checked: the file must match `session[.vN].jsonl[.zstd]` and the directory
  must equal the session id. Anything else refuses as `unsafe-path`.
- Deletion in the UI requires a second click to confirm.
- One request deletes at most `maxBatch` (default 200) sessions.

## Install

```text
dsh plugin add /absolute/path/to/dsh-archived-cleanup
```

Or install the directory through **Settings → Plugins → Add**.

## Use

**Settings → Archived conversations** (trash-can icon, after the plugin market).
Tick conversations and confirm, or delete the whole set.

Or ask the agent — the `archived_conversations` tool takes:

```json
{ "action": "list" }
{ "action": "delete", "sessionIds": ["session-..."] }
{ "action": "delete", "all": true }
```

## Configuration

Set on the plugin's Loader row in `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `maxBatch` | `200` | Largest number of conversations one request may delete |
| `allowNonArchived` | `false` | Permit deleting conversations that are not archived |
| `keepProjectionCache` | `false` | Keep the derived projection-cache document |

## Requirements

DeepSeek Harness `0.2.2-rc.1` or later. Declares `dsh.bundle` and `dsh.client`
in `package.json`; the Host half registers the routes and the tool, the Client
half registers the settings page.

## License

MIT
