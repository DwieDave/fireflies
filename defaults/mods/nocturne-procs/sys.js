// The system graphs' readings (the deck's system tab), free of the view
// (tested in scripts/nocturne-procs-sys.test.ts). One probe a second while
// the system tab shows, every 2 s while the deck shows another tab, none
// while it's closed; never two at once. macOS sources that need no sudo:
//
//   cpu      iostat -C -c 2 -w 1: its second line is the last second's
//            user / system / idle (the probe takes that second)
//   disk     the same iostat line: MB/s summed over the disks it lists;
//            df -k / for how full the startup disk is
//   memory   vm_stat pages and sysctl hw.memsize / hw.pagesize: used is
//            app memory (anonymous less purgeable) + wired + compressed, as
//            Activity Monitor counts it; kern.memorystatus_vm_pressure_level
//            for the pressure (1 normal, 2 warning, 4 critical)
//   network  netstat -ib byte counters of every interface but loopback,
//            per second between two readings
//   gpu      ioreg's IOAccelerator PerformanceStatistics "Device Utilization %"
//
// A source that prints nothing (no GPU entry, Linux) reads as null and its
// graph says so instead of drawing zero.

export const SEP = "@@nocturne-sys@@";
const part = (cmd) => `${cmd} 2>/dev/null; echo '${SEP}'`;
export const SYS_PROBE = [
  part("sysctl -n hw.ncpu hw.memsize hw.pagesize kern.memorystatus_vm_pressure_level"),
  part("vm_stat"),
  part("netstat -ib"),
  part("df -k /"),
  part("ioreg -r -c IOAccelerator -d 1 | grep -o '\"Device Utilization %\"=[0-9]*'"),
  "LC_ALL=C iostat -n 8 -C -c 2 -w 1 2>/dev/null; true",
].join("; ");

/** How many readings a graph keeps: 90 at a second, the last minute and a half. */
export const KEEP = 90;
/** Between readings: a second while the system tab shows, 2 s behind another tab. A reading
 *  takes about a second itself (iostat measures one), so at a second they run back to back. */
export const STEP_SHOWN = 1000;
export const STEP = 2000;

/** sysctl's four numbers. */
export function parseSysctl(text) {
  const n = String(text ?? "").trim().split(/\s+/).map(Number);
  return { ncpu: n[0] || null, memsize: n[1] || null, pagesize: n[2] || null, pressure: Number.isFinite(n[3]) && n[3] > 0 ? n[3] : null };
}

/** vm_stat: { pagesize, free, active, inactive, wired, anonymous, purgeable, compressed } in pages. */
export function parseVmStat(text) {
  const s = String(text ?? "");
  if (!/Mach Virtual Memory Statistics/.test(s)) return null;
  const v = (label) => { const m = new RegExp(`^"?${label}"?:\\s+(\\d+)`, "m").exec(s); return m ? Number(m[1]) : 0; };
  const ps = /page size of (\d+) bytes/.exec(s);
  return { pagesize: ps ? Number(ps[1]) : null, free: v("Pages free"), active: v("Pages active"), inactive: v("Pages inactive"),
    wired: v("Pages wired down"), anonymous: v("Anonymous pages"), purgeable: v("Pages purgeable"), compressed: v("Pages occupied by compressor") };
}

/** netstat -ib: bytes in and out, summed over every link row but loopback. */
export function parseNetstat(text) {
  let rx = 0, tx = 0, seen = false;
  for (const line of String(text ?? "").split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !/^<Link#\d+>$/.test(f[2]) || /^lo\d/.test(f[0])) continue;
    const ib = Number(f[f.length - 5]), ob = Number(f[f.length - 2]);
    if (!Number.isFinite(ib) || !Number.isFinite(ob)) continue;
    rx += ib; tx += ob; seen = true;
  }
  return seen ? { rx, tx } : null;
}

/** df -k /: { size, used, pct } in KiB. */
export function parseDf(text) {
  const line = String(text ?? "").trim().split("\n").slice(1).join(" ");
  const m = /\s(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%/.exec(" " + line);
  return m ? { size: Number(m[1]), used: Number(m[2]), pct: Number(m[4]) } : null;
}

/** ioreg's GPU busy percent (the busiest accelerator), or null. */
export function parseGpu(text) {
  const all = [...String(text ?? "").matchAll(/"Device Utilization %"=(\d+)/g)].map((m) => Number(m[1]));
  return all.length ? Math.max(...all) : null;
}

/** iostat -C's last line: { cpu: { us, sy, id }, mbps } (disks summed). */
export function parseIostat(text) {
  const lines = String(text ?? "").trim().split("\n").filter((l) => /^\s*[\d.]/.test(l));
  const head = String(text ?? "").split("\n").find((l) => /KB\/t/.test(l));
  if (!lines.length || !head) return null;
  const disks = (head.match(/KB\/t/g) ?? []).length;
  const f = lines[lines.length - 1].trim().split(/\s+/).map(Number);
  let mbps = 0;
  for (let d = 0; d < disks; d++) mbps += f[d * 3 + 2] || 0;
  const [us, sy, id] = f.slice(disks * 3, disks * 3 + 3);
  return { cpu: Number.isFinite(id) ? { us, sy, id } : null, mbps };
}

/** The probe's output as one reading. */
export function parseSys(text, at = Date.now()) {
  const [sc = "", vm = "", net = "", df = "", gpu = "", io = ""] = String(text ?? "").split(SEP);
  return { at, sysctl: parseSysctl(sc), vm: parseVmStat(vm), net: parseNetstat(net), df: parseDf(df), gpu: parseGpu(gpu), io: parseIostat(io) };
}

/**
 * What the graphs show for a reading, with the one before it for the
 * per-second network: { cpu, gpu, mem, disk, net }, each null when its
 * source gave nothing.
 *   cpu  { pct, us, sy }         gpu  { pct }
 *   mem  { used, total, pct, pressure: "normal" | "warning" | "critical" | null } (bytes)
 *   disk { mbps, full }          net  { rx, tx } (bytes a second; null on the first reading)
 */
export function measure(cur, prev = null) {
  const io = cur.io;
  const cpu = io?.cpu ? { pct: Math.max(0, Math.min(100, 100 - io.cpu.id)), us: io.cpu.us, sy: io.cpu.sy } : null;
  const vm = cur.vm, sc = cur.sysctl;
  let mem = null;
  if (vm && sc?.memsize) {
    const page = vm.pagesize ?? sc.pagesize ?? 4096;
    const used = Math.max(0, vm.anonymous - vm.purgeable + vm.wired + vm.compressed) * page;
    mem = { used, total: sc.memsize, pct: Math.min(100, (used / sc.memsize) * 100),
      pressure: { 1: "normal", 2: "warning", 4: "critical" }[sc.pressure] ?? null };
  }
  const disk = io || cur.df ? { mbps: io ? io.mbps : null, full: cur.df?.pct ?? null } : null;
  let net = null;
  if (cur.net && prev?.net && cur.at > prev.at) {
    const dt = (cur.at - prev.at) / 1000;
    net = { rx: Math.max(0, (cur.net.rx - prev.net.rx) / dt), tx: Math.max(0, (cur.net.tx - prev.net.tx) / dt) };
  }
  return { cpu, gpu: cur.gpu == null ? null : { pct: cur.gpu }, mem, disk, net, netSeen: Boolean(cur.net) };
}

/** Appends to a history, keeping the newest `keep`. */
export const push = (list, v, keep = KEEP) => [...(list ?? []), v].slice(-keep);

/** "1.2 MB/s", "80 KB/s", "0 B/s". */
export function rate(bytes) {
  if (bytes == null) return "";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB/s`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB/s`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB/s`;
  return `${Math.round(bytes)} B/s`;
}

/** "18.2G", "512M" from bytes. */
export function size(bytes) {
  const g = bytes / 1024 ** 3;
  return g >= 1 ? `${g.toFixed(1)}G` : `${Math.round(bytes / 1024 ** 2)}M`;
}

/** Bar heights 0..1 for a history: percents over 100, rates over their own top (at least `floor`). */
export function scale(values, { max = null, floor = 1 } = {}) {
  const top = max ?? Math.max(floor, ...values.filter((v) => v != null));
  return values.map((v) => (v == null ? null : Math.max(0, Math.min(1, v / top))));
}
