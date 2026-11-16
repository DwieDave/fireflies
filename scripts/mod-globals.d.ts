// The one global of the mods' runtime the bun tests need declared that bun's
// types lack: `window` (defaults/types/runtime.d.ts declares it for the mods,
// with console, Buffer, URL and the rest, which bun's own types declare here).
// The tests set it to a stand-in (`globalThis.window = …`).
type GpuiShellWindow = import("gpui-kit").Window;
interface Window extends GpuiShellWindow {}
declare var window: Window & typeof globalThis;
