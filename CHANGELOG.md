# Changelog

## v1.0.0

First release.

- Settings page listing archived conversations with title, date, size, and
  workspace path; deletes the selection after a second confirmation click.
- `archived_conversations` agent tool over the same implementation.
- Deletion removes the session log directory, the projection-cache record, the
  workspace accounting slot, and the archive entry, in that order.
- Refuses live sessions, unarchived sessions, and unexpected log paths.
