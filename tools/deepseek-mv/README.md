# deepseek-mv — DeepSeek agent for RPG Maker MV

A DeepSeek-powered agent CLI built on top of **RpgMakerMVUltimate-MCP** (the
MCP server for RPG Maker MV). It:

- **Drives the MCP server** (`rpgmaker-mv-mcp`) over stdio against your project —
  query/edit the database, generate maps, manage events, run project
  intelligence and consistency checks.
- **Uses the rpgmaker-agent-skills pack** — the installed `.claude/skills`
  (project #3) are loaded into the system prompt so every edit follows the
  engine's safety rules (append-only `MapInfos.json`, no ID renumbering,
  dry-run first, confirm references).
- **Multimodal** — `--image` attaches a screenshot/tileset/asset and switches to
  DeepSeek's vision model `deepseek-v4-flash-vision-exp` (base64 inline,
  per the [Vision guide](https://api-docs.deepseek.com/guides/vision)).

## Setup

```bash
cd tools/deepseek-mv
npm install
npm run build
cp .env.example .env      # then put your DEEPSEEK_API_KEY in .env
```

`npm install` will prompt for the SDK; `npm run build` compiles to `dist/`.

> The agent needs the MCP server built too. From the repo root:
> `npm run build` (compiles `dist/index.js`, which the agent spawns).

## Usage

```bash
# Text agent with MCP tools + skills context
node dist/index.js "Add a blacksmith NPC to Map003 who complains about the heat" --project D:\Games\MyGame

# Multimodal: analyze a map screenshot
node dist/index.js "Describe this map and suggest improvements" --image shot.png --project D:\Games\MyGame

# Consistency check
node dist/index.js "Check the project for broken references" --project D:\Games\MyGame

# Debug: print the assembled skills context
node dist/index.js --print-context
```

If `RPGMAKER_PROJECT_PATH` is set in `.env` you can omit `--project`.

## Configuration

All settings live in `.env` (or the environment). See `.env.example`.
- `DEEPSEEK_API_KEY` — required
- `DEEPSEEK_MODEL` — text model (default `deepseek-v4-flash`)
- `DEEPSEEK_VISION_MODEL` — vision model (default `deepseek-v4-flash-vision-exp`)
- `RPGMAKER_PROJECT_PATH` — default project
- `RPGMAKER_MCP_SERVER` — override the MCP server entry (defaults to repo `dist/index.js`)
- `RPGMAKER_SKILLS_DIR` — override the skills directory (defaults to repo `.claude/skills`)

## Notes

- **Security**: `tools/deepseek-mv/.env` is gitignored and never committed.
- The MCP server's `run_skill_script` tool gives the agent direct access to the
  bundled Python consistency checkers (`validate_project`, `scaffold_event`, …).
- When using `--image` the vision model runs the whole loop; pass `--no-tools`
  if you only want a description and your vision model rejects function calls.
