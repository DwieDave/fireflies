// @fireflies/viewer: the preview's viewer, a View that reads a file and
// draws it kind by kind (docs/effect-mods.md, wave 0). The preview pane is
// one; the files pane's preview split and the editor's drawn tabs mount it
// as a nested view with props { embedded: true, path, on }.
//
//   import Viewer from "@fireflies/viewer";
//   import { fileIcon, iconColor, iconSvg, ICON_SIZE } from "@fireflies/viewer/file-icons";
//   import { kindOf } from "@fireflies/viewer/kinds";
//   import { parse, table, oneLine } from "@fireflies/viewer/table";   // CSV/TSV as a table

export { default } from "./viewer.ts";

export type { ViewerProps } from "./viewer-state.ts";

export type { Size } from "./image.ts";

export { hasDatabases, openInDatabases } from "./viewer-table.ts";
