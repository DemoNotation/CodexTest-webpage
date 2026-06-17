# Codex Session Notes

## Current Project

- Local folder: `C:\Users\zhang\DeskTop\CodexTest`
- Web files:
  - `index.html`
  - `styles.css`
  - `README.md`
  - `.nojekyll`
  - `.gitignore`
- Screenshot files are ignored by Git through `.gitignore`.

## Published Website

- GitHub account: `DemoNotation`
- GitHub repository: `https://github.com/DemoNotation/CodexTest-webpage`
- GitHub Pages URL: `https://demonotation.github.io/CodexTest-webpage/`
- Pages source: `main` branch, `/` root folder
- Repository is public.

## Tools Installed

- Git installed at: `C:\Program Files\Git\cmd\git.exe`
- GitHub CLI installed at: `C:\Program Files\GitHub CLI\gh.exe`
- GitHub CLI is logged in as `DemoNotation`.

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

## What Was Done

1. Created a static homepage saying: `这是一个用 Codex 制作的网页`.
2. Added responsive styling in `styles.css`.
3. Installed Git and GitHub CLI.
4. Logged in to GitHub CLI as `DemoNotation`.
5. Created public repository `DemoNotation/CodexTest-webpage`.
6. Pushed the website source code.
7. Enabled GitHub Pages.

## How To Resume Later

Tell Codex:

```text
请读取 C:\Users\zhang\DeskTop\CodexTest\session-notes.md，然后继续上次的网页项目。
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
