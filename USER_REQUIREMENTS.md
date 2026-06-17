# User Requirements

This file records the requirements raised during the recent implementation sessions so future work can quickly recover the expected behavior.

## Chat Page

- The thinking process must be expanded while the assistant is still replying.
- After the assistant response is complete, the thinking process should collapse by default.
- Historical thinking content should remain manually expandable.
- After sending a question or regenerating a reply, the chat view must automatically scroll to the newest message.
- During streaming output, the chat view should continue following the bottom.
- Assistant message actions must be shown before timing stats in the message footer.
- The footer order is: copy, regenerate, first-token time, total time.
- First-token time and total time must not show as `0ms`; use a stable elapsed-time calculation and show at least `1ms`.
- Copy should copy only the assistant answer, not the thinking process.
- Regenerate should rebuild the assistant answer using previous user context.
- Stop generation should keep already streamed content and append a stopped marker such as `[stopped]` or the localized equivalent used by the UI.
- Stop generation must not unlock the send state before the abort flow has actually completed.
- The send button should become a stop button while generating.

## Chat Settings

- The chat page should support light/dark theme switching.
- Theme preference should persist in `localStorage`.
- Settings should include model parameters:
  - `temperature`, range `0-2`, and `0` must be saved correctly.
  - `max_tokens`, range `1-32000`.
  - `top_p`, range `0-1`, and `0` must be saved correctly.
- Settings panel should close by clicking the backdrop.
- Settings panel should close with `Esc`.
- Settings panel close action should use a clear close icon.
- Avoid inline layout styles in the settings panel when a CSS class is appropriate.

## Export

- The current chat session can be exported as Markdown.
- The current chat session can be exported as JSON.
- Markdown export should separate assistant thinking from assistant answer.
- Markdown export should avoid emoji labels to reduce encoding/format issues.
- Export should report an error when there is no conversation content.

## Sessions

- Chat sessions are stored locally.
- Starting a new session should clear the current draft and scroll state.
- Switching sessions should clear expanded thinking state.
- Clearing a session should clear expanded thinking state.
- Session title should be derived from the first user message.

## Admin Pages

- The management entry from the chat page should route to `/m/channels`.
- When logging out from the management page, clear the admin token and return directly to the main chat page `/`.
- Do not leave the user on `/m/...` with only the login dialog after logout.
- Admin theme switching should stay consistent with the chat page theme.

## Deployment

- Before every production deployment, run:

```powershell
npm run check
```

- Deploy to EdgeOne Pages production with:

```powershell
edgeone pages deploy . -n aiapi -e production
```

- After deployment, verify:
  - `https://ai.xixiya.top` returns `200`.
  - The HTML references the latest built JS and CSS filenames from `dist`.
  - `https://ai.xixiya.top/api/health` returns `{"ok":true}`.

## Current Production Project

- Production URL: `https://ai.xixiya.top`
- EdgeOne Pages project name: `aiapi`
- EdgeOne project ID: `pages-l4gz7vzin4zo`

## Implementation Notes

- Prefer small, targeted changes that match the existing Vue 3 + Vite style.
- Use Lucide icons for UI buttons.
- Keep destructive actions disabled while a response is generating.
- Use `apply_patch` for manual file edits.
- Avoid reverting unrelated user changes.
