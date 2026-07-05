# Codex Session Notes

## Current Project

- Local folder: `C:\Users\zhang\DeskTop\CodexTest`
- Original web files:
  - `index.html`
  - `styles.css`
  - `README.md`
  - `.nojekyll`
  - `.gitignore`
- Current app files:
  - `index.html`
  - `styles.css`
  - `script.js`
  - `server.py`
  - `server.ps1`
  - `README.md`
  - `render.yaml`
  - `railway.json`
  - `Procfile`
  - `runtime.txt`
  - `nixpacks.toml`
  - `vendor/jszip.min.js`
  - `vendor/mammoth.browser.min.js`
  - `vendor/xlsx.full.min.js`
- Screenshot and generated report files are ignored or can be ignored by Git as needed.

## Current Website State

This project is now a private personal diary website, not only the original static homepage.

Main features currently visible from the code:

- Password-protected private diary.
- Browser-side encryption/decryption with Web Crypto.
- Diary entries can include title, date, mood, category, content, links, and attachments.
- Supports adding, editing, deleting, clearing, searching, date filtering, and category filtering diary entries.
- Supports entry detail view.
- Supports image compression/previews and attachment upload/download.
- Supports attachment previews for images, videos, audio, PDF, text, Word, Excel, and PowerPoint where possible.
- Supports editable attached links with link title and URL.
- Syncs encrypted diary data through the Python server API at `/api/diary`.
- Checks the server for newer diary content about every 10 seconds.
- Stores encrypted diary vault locally in `data/diary-vault.json` by default, or in Supabase Storage when Supabase environment variables are configured.
- Stores large attachments in Supabase Storage under the `private-diary` bucket.

Important security note:

- The diary content is intended to be encrypted before being saved to the server.
- Do not commit real diary data, private passwords, `SUPABASE_SERVICE_ROLE_KEY`, database files, or other secrets.

## Published Website

- GitHub account: `DemoNotation`
- GitHub repository: `https://github.com/DemoNotation/CodexTest-webpage`
- GitHub Pages URL: `https://demonotation.github.io/CodexTest-webpage/`
- Pages source: `main` branch, `/` root folder
- Repository is public.
- Note: the diary app needs the Python server for `/api/diary` and `/api/attachments`. GitHub Pages can serve static files only, so full diary sync/attachment behavior needs a server deployment such as Render or Railway.

## Tools Installed

- Git installed at: `C:\Program Files\Git\cmd\git.exe`
- GitHub CLI installed at: `C:\Program Files\GitHub CLI\gh.exe`
- GitHub CLI account: `DemoNotation`
- Note: GitHub CLI token was reported invalid on 2026-06-18. Refresh with `gh auth refresh -h github.com` before publishing through `gh`.

## Important Commands

Check GitHub login:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth status --hostname github.com
```

Check project status:

```powershell
& "C:\Program Files\Git\cmd\git.exe" status --short --branch
```

Commit and publish future webpage changes:

```powershell
& "C:\Program Files\Git\cmd\git.exe" add index.html styles.css README.md .nojekyll .gitignore
& "C:\Program Files\Git\cmd\git.exe" commit -m "Update webpage"
& "C:\Program Files\Git\cmd\git.exe" push
```

Run locally with PowerShell wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1 -HostName 0.0.0.0 -Port 8000
```

Run locally with Python:

```powershell
python server.py --host 0.0.0.0 --port 8000
```

Local browser URL:

```text
http://localhost:8000
```

Same Wi-Fi phone URL:

```text
http://电脑的局域网 IP:8000
```

For public deployment, use Render or Railway with persistent storage, or configure Supabase:

```text
SUPABASE_URL=https://你的项目编号.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 service_role JWT key
SUPABASE_BUCKET=private-diary
```

## What Was Done

1. Created a static homepage saying: `这是一个用 Codex 制作的网页`.
2. Added responsive styling in `styles.css`.
3. Installed Git and GitHub CLI.
4. Logged in to GitHub CLI as `DemoNotation`.
5. Created public repository `DemoNotation/CodexTest-webpage`.
6. Pushed the website source code.
7. Enabled GitHub Pages.
8. Fixed Chinese garbled text in `index.html`, `README.md`, and `session-notes.md`.
9. Read HomeApp data from `C:\Users\zhang\Desktop\Debug\database\dbTest.mdb`.
10. Generated `ajie-advance-report.png` for `预支 > 啊姐`.
11. Converted the project into a private diary web app.
12. Added encrypted diary storage and a Python server API.
13. Added local/server sync and conflict protection using diary version headers.
14. Added category, mood, date, search, edit, delete, clear, and detail-view features.
15. Added attachments and Supabase-backed attachment upload/download.
16. Added local previews for document attachments using `JSZip`, `mammoth`, and `xlsx`.
17. Added editable diary links.
18. Updated diary app wording from `我的私人日记` / `我的日记` to `日记本`, and changed `锁定` to `退出登录`.
19. Added custom mood input with common mood suggestions.
20. Added a clickable diary count button that opens a diary directory modal.
21. Added related diary support using `relatedEntryIds`, including selection during editing and related-entry display in detail view.
22. Expanded search with date range and attachment-type filters.
23. Added a logged-in password change flow. The old password authorizes the save; entries are re-encrypted with the new password in the browser; server supports `X-Diary-New-Key`.

## Recent Git History

Latest commits seen on 2026-07-06:

```text
398cc90 Allow editing attached diary links
12ad054 Improve diary link details
9e7b7c9 Add local document attachment previews
a66fec7 Add downloadable diary attachments
2949d13 Add diary detail viewer
```

Current Git status seen on 2026-07-06:

```text
main...origin/main
M session-notes.md
?? WECHAT-AUTOMATION.md
?? a1.jpg
?? a2.jpg
?? generate-ajie-report.ps1
?? generate-story-video.ps1
?? little-lamp-story.mp4
?? little-lamp-story.txt
?? story-animation.html
?? wechat-send.ps1
```

The untracked files above look related to WeChat automation, generated reports, images, and story/video experiments. They should not be committed unless intentionally needed.

## How To Resume Later

Tell Codex:

```text
请读取 `C:\Users\zhang\DeskTop\CodexTest\session-notes.md`，然后继续上次的网页项目。
```

For the current diary app, a better resume prompt is:

```text
请读取 `C:\Users\zhang\DeskTop\CodexTest\session-notes.md`，然后继续维护这个私人日记网站。先检查当前 Git 状态，不要覆盖我已有的未提交文件。
```

Then ask for the new change, for example:

```text
帮我修改主页标题。
```

or:

```text
帮我增加一个联系我们区域，然后发布到 GitHub Pages。
```

## Notes

- Do not put private data, passwords, database connection strings, or sensitive business information into this public website.
- After pushing changes, GitHub Pages may take several seconds to a few minutes to update.
- If the browser still shows the old page, use `Ctrl + F5` to force refresh.
