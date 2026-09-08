# Session conversation rendering

Reference: local `codex-cli` commit `0337192dfd`.

- `codex-rs/app-server-protocol/src/protocol/thread_history.rs`: reconstruct turns and typed items before rendering.
- `codex-rs/tui/src/chatwidget/replay.rs`: replay typed items through their handlers.
- `codex-rs/tui/src/exec_cell/model.rs` and `render.rs`: group adjacent exploration; combine consecutive reads and deduplicate names; keep normal command titles as Running/Ran, with exit status on the marker.
- `codex-rs/tui/src/history_cell/snapshots/codex_tui__history_cell__tests__stderr_tail_more_than_five_lines_snapshot.snap`: retain output head/tail and omission count in the summary.

These are CLI/TUI and history replay references, not evidence of the desktop application's pixel layout.

This project's Rust replay remains responsible for event ordering, process polling and token updates. `src/lib/session-conversation.ts` adapts that replay into a cached conversation model and owns legacy tool argument/output decoding. It does not evaluate logged JavaScript. The React component renders messages, exploration and command activities from that model.

User and assistant messages render Markdown by default. System/developer context remains collapsed. Exploration summaries retain a badge for every original call with recorded token usage, even when read filenames are deduplicated; numbered badges follow the original call order, and expansion reveals each command, its tokens and its raw records. Input/cache/output are visible beside total tokens. Cache is included in input, and reasoning is included in output; the tooltip retains exact counts and model. Calls without recorded usage receive no invented estimate. An orchestration call's tokens are not split between batch results.

Exploration classification intentionally accepts only known literal read/search/list commands. Unknown shell syntax, mixed scripts, failed/running/stopped calls and batches remain ordinary activities. Existing batch exit statuses, process polling, signal handling and raw JSONL provenance are preserved. Command summaries show three leading and two trailing lines with the omitted line count; expansion shows all retained output. A replay cannot recover output that was already truncated in the source log.
