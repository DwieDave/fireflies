// @fireflies/look: the chrome of Fireflies' mods, drawn the way the shown
// layout asks (docs/plain-look.md): Nocturne's dithered, square look where the
// layout's scrim is dithered, herdr-app's plain one elsewhere (`main`, a
// person's own layout). Each primitive draws exactly today's Nocturne chrome in
// Nocturne.
//
//   import { fill, rule, lit, veil, plate } from "@fireflies/look";
//
// layout-look.ts and tones.ts are copies of the mods' until wave 0a serves
// them as @fireflies/layout-look and @fireflies/tones; then these import them
// by name and the copies go.

export * from "./layout-look.ts";

export * from "./tones.ts";

export * from "./paint.ts";
