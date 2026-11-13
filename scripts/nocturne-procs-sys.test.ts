// The deck's system graphs' readings (defaults/mods/nocturne-procs/sys.js):
// each source's parser on a Mac's output, what a reading measures (network
// per second between two), the history, the scales, and a machine without
// the sources reading as null (the graph says so, not zero).
import { test, expect } from "bun:test";
import { SYS_PROBE, SEP, KEEP, STEP, STEP_SHOWN, parseSys, parseSysctl, parseVmStat, parseNetstat, parseDf, parseGpu, parseIostat, measure, push, rate, size, scale } from "../defaults/mods/nocturne-procs/sys.js";
import { SYS, SYS_NONE } from "./fixtures/procs.ts";

test("the probe: one shell line, sections apart, iostat last (it takes its second), no sudo", () => {
  expect(SYS_PROBE.split(SEP).length).toBe(6);
  expect(SYS_PROBE).not.toContain("sudo");
  expect(SYS_PROBE).not.toContain("powermetrics");
  expect(SYS_PROBE.trim().endsWith("true")).toBe(true);
  expect(SYS_PROBE).toContain("iostat -n 8 -C -c 2 -w 1");
  // Numbers, not names: netstat -ib looks up a hostname for every address (5 s on a busy Mac).
  expect(SYS_PROBE).toContain("netstat -ibn");
  expect([KEEP, STEP, STEP_SHOWN]).toEqual([90, 2000, 1000]);
});

test("each source's parser", () => {
  const [sc, vm, net, df, gpu, io] = SYS.split(SEP);
  expect(parseSysctl(sc)).toEqual({ ncpu: 10, memsize: 34359738368, pagesize: 16384, pressure: 1 });
  expect(parseVmStat(vm)).toMatchObject({ pagesize: 16384, wired: 271923, anonymous: 1000893, purgeable: 4455, compressed: 459103 });
  // en1 and en12's link rows (loopback out, the address rows not counted twice).
  expect(parseNetstat(net)).toEqual({ rx: 12944968792 + 5424149797, tx: 260 + 232230661 + 363662454 });
  expect(parseDf(df)).toEqual({ size: 482797652, used: 13338384, pct: 21 });
  expect(parseGpu(gpu)).toBe(53);
  expect(parseIostat(io)).toEqual({ cpu: { us: 62, sy: 18, id: 20 }, mbps: 12.86 + 15.8 });
});

test("measure: cpu is all but idle; memory as Activity Monitor counts it; network per second between two readings", () => {
  const a = parseSys(SYS, 10000);
  const m = measure(a);
  expect(m.cpu).toEqual({ pct: 80, us: 62, sy: 18 });
  expect(m.gpu).toEqual({ pct: 53 });
  const used = (1000893 - 4455 + 271923 + 459103) * 16384;
  expect(m.mem).toMatchObject({ used, total: 34359738368, pressure: "normal" });
  expect(Math.round(m.mem.pct)).toBe(82);
  expect(m.disk.full).toBe(21);
  expect(m.disk.mbps).toBeCloseTo(28.66);
  expect(m.net).toBe(null); // the first reading has nothing to compare with
  const b = { ...a, at: 12000, net: { rx: a.net.rx + 4e6, tx: a.net.tx + 2e5 } };
  expect(measure(b, a).net).toEqual({ rx: 2e6, tx: 1e5 });
  // A counter that went back (an interface gone) reads 0, not negative.
  expect(measure({ ...b, net: { rx: 0, tx: 0 } }, a).net).toEqual({ rx: 0, tx: 0 });
});

test("a machine without the sources: every graph null, none zero", () => {
  const m = measure(parseSys(SYS_NONE, 1), parseSys(SYS_NONE, 0));
  expect(m).toEqual({ cpu: null, gpu: null, mem: null, disk: null, net: null, netSeen: false });
  // No GPU entry alone.
  expect(measure(parseSys(SYS.replace('"Device Utilization %"=53', ""), 1)).gpu).toBe(null);
});

test("history, scales and words", () => {
  let h: number[] = [];
  for (let i = 0; i < 95; i++) h = push(h, i);
  expect(h.length).toBe(KEEP);
  expect(h[0]).toBe(5);
  expect(scale([0, 50, 100, null], { max: 100 })).toEqual([0, 0.5, 1, null]);
  expect(scale([1e6, 2e6])).toEqual([0.5, 1]);
  expect(scale([0, 0], { floor: 1e5 })).toEqual([0, 0]);
  expect(rate(2e6)).toBe("2.0 MB/s");
  expect(rate(80000)).toBe("80 KB/s");
  expect(rate(12)).toBe("12 B/s");
  expect(size(28302770176)).toBe("26.4G");
  expect(size(512 * 1024 ** 2)).toBe("512M");
});
