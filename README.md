<p align="center">
  <img src="https://img.bscotch.net/fit-in/256x256/logos/stitch.png" alt="Stitch (GameMaker Pipeline Development Kit) Logo"/>
</p>

# Stitch Monorepo

[Butterscotch Shenanigans](https://www.bscotch.net) ("Bscotch") develops and maintains a collection of tools for management of [GameMaker](https://gamemaker.io) projects. These tools are collected under the umbrella trademark "Stitch".

This monorepo includes the code for many of the Stitch projects.

> 💡 Bscotch only develops features and fixes bugs that impact our studio directly. If you need other features or fixes, feel free to fork this project to add them yourself. You may submit pull requests with your changes, but we make no promises that we will merge them.

_Butterscotch Shenanigans&reg; and Stitch&trade; are not affiliated with GameMaker&reg;._

## Stitch Projects

Some of the projects listed here are available as compiled packages via [npm](https://npmjs.com) or other 3rd party repositories. Others are only used locally.

- [**Stitch for VSCode**](packages/vscode): A [Visual Studio Code](https://code.visualstudio.com/) extension providing code editing features for GameMaker project files. Available as [`bscotch.bscotch-stitch-vscode` via the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=bscotch.bscotch-stitch-vscode).
- [**Stitch YY**](packages/yy): Utilities for reading, validating, and writing `.yy` and `.yyp` files. Available as [`@bscotch/yy` via npm](https://www.npmjs.com/package/@bscotch/yy).
- [**GML Parser**](packages/parser): A GML parser and project modeler, providing programmatic access to a GameMaker project's resources and code. Provides features like go-to-definition, adding/removing resources, etc. Underpins Stitch for VSCode, but can be used on its own to create other tools and pipelines. Available as [`@bscotch/gml-parser` via npm](https://www.npmjs.com/package/@bscotch/gml-parser).
- [**Sprite Source**](packages/sprite-source): A library for creating art asset pipelines for GameMaker projects, including a basic CLI. Built into Stitch for VSCode, but also available as a standalone thing for other workflows. Available as [`@bscotch/sprite-source` via npm](https://www.npmjs.com/package/@bscotch/sprite-source).
- [**Stitch Launcher**](packages/launcher): Utilities for automatically installing the GameMaker IDE by version, and opening GameMaker projects with specific IDE versions.
- [**GameMaker Merged Releases**](packages/releases): Utilities for merging the various GameMaker IDE and Runtime release notes into a single merged listing. Available as [`@bscotch/gamemaker-releases` via npm](https://www.npmjs.com/package/@bscotch/gamemaker-releases). Merged feeds are regularly published to [this repo's releases](https://github.com/bscotch/stitch/releases/latest/download/releases-summary.json).
- [**Stitch Core (LEGACY)**](https://github.com/bscotch/stitch-legacy/tree/develop/packages/core): The core SDK for managing and manipulating GameMaker projects. It includes a programmatic API and a CLI. Available as [`@bscotch/stitch` via npm](https://www.npmjs.com/package/@bscotch/stitch). (No longer maintained. Superseded by the GML Parser project.)
- [**Spritely (LEGACY)**](packages/spritely): Utilities for batch-preparation of source images for import as GameMaker sprites. It includes a programmatic API and a CLI. Available as [`@bscotch/spritely` via npm](https://www.npmjs.com/package/@bscotch/spritely). (No longer maintained. Superseded by the Sprite Source project.)

## Recent Parser + Extension Notes (May 2026)

The following behavior updates are now available to developers using Stitch for VSCode (powered by the GML parser):

### 1) Static Member Semantics Match GameMaker More Closely

- `Function.member` is resolved as `static_get(Function).member`.
- This works for global/script functions, constructor statics, and constructor-backed methods.
- Static declarations inside function bodies are treated as function-owned static members (not instance-owned object members).

Examples that now resolve correctly in parser-backed tooling (hover, references, diagnostics):

```gml
var _a = Cyg.Export;
var _b = Cueca.__channels;
var _c = new CuecaChannel().Play(noone);
```

### 2) Static Projections Are Unified Across Features

- `StaticType<T>` now projects static members consistently.
- Dot accessor resolution and static utility typing share the same static-member view logic.
- Function-derived types now preserve correct static lookup by walking the function inheritance chain.

### 3) Typed Struct Returns in JSDoc (Named Members)

You can now describe returned struct members explicitly, not just `Struct` as a whole.

```gml
/// @return {{persistent: Bool, cleared: Bool}}
function enemy_list_room_effective_config(_room=room)
{
  var _effective = {persistent: true, cleared: false};
  return (_effective);
}
```

This enables better completion/typing for downstream usage, such as:

```gml
var _cfg = enemy_list_room_effective_config();
if (_cfg.persistent && !_cfg.cleared) {
  // ...
}
```

### 4) JSDoc Record Parsing Improvements

- Nested-brace record syntax in JSDoc type groups is now parsed correctly (for example, `@return {{x: Real}}`).
- Record-property names are preserved and mapped to real struct members in parser types.
- This improves hover, go-to-definition context, and semantic validation quality in VSCode.

## Development

### Setup

1. Install [pnpm](https://pnpm.io/installation)

- If you already have corepack available but do not have pnpm, you can run `npm run setup:pnpm` in this directory to install it.

2. Run `pnpm install` in this directory to install all dependencies.

- You can use [pnpm filters](https://pnpm.io/filtering) to only install the dependencies for a specific package.

3. Run `pnpm build:all` to build all packages.
