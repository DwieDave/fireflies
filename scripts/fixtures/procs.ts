// Fixtures for the processes and ports manager's tests, in this Mac's formats:
// `ps -o pid=,comm=`, `ps -axww -o pid=,ppid=,pgid=,user=,etime=,pcpu=,rss=,command=`
// (a path with spaces, a login shell's -zsh, a decimal comma), `lsof -F pcn`
// (IPv4 and IPv6 of one port), and the app's terminals, panes and spaces.
export const COMM = `    1 /sbin/launchd
 1392 /Users/dev/.local/bin/herdr-core
 1455 /Users/dev/.local/bin/herdr-core
21416 /Applications/Nix Apps/Fireflies.app/Contents/MacOS/Fireflies
 1467 /bin/zsh
41872 claude
52210 /bin/zsh
52214 cargo
52391 /nix/store/abc-rustc/bin/rustc
50112 bun
50118 node
50121 esbuild
60000 /usr/sbin/cupsd
`;
export const PS = `    1     0     1 root             03-01:40:04   0.2   9552 /sbin/launchd
 1392     1  1392 dev              03-01:39:03   1.4  13712 /Users/dev/.local/bin/herdr-core --hc-launchd /tmp/hc/ready
 1455  1392  1455 dev              03-01:39:02   0.2   6656 /Users/dev/.local/bin/herdr-core hold --socket /Users/dev/.local/state/herdr-core/default/default.holder.sock
21416     1 21416 dev                 16:37   3,5 412000 /Applications/Nix Apps/Fireflies.app/Contents/MacOS/Fireflies
 1467  1455  1467 dev                  1:12:04   0.0   3000 -zsh
41872  1467 41872 dev                  1:12:04   3.1 421888 claude --model claude-opus-5-5 --effort high
52210 41872 52210 dev                     02:41   0.0   3072 /bin/zsh -c just test
52214 52210 52210 dev                     02:40   0.4  90112 cargo test --locked
52391 52214 52210 dev                     01:58  98.2 1992294 /nix/store/abc-rustc/bin/rustc --crate-name herdr_app --edition=2021 src/main.rs
50112  1455 50112 dev                     38:10   0.2  45056 bun run dev
50118 50112 50112 dev                     38:09   1.4 186368 node /w/node_modules/.bin/vite --port 5173
50121 50118 50112 dev                     38:09   0.0  21504 esbuild --service=0.21.5 --ping
60000     1 60000 root                    10:00   0.0   4000 /usr/sbin/cupsd -l
`;
export const LSOF = `p50118
cnode
f20
n127.0.0.1:5173
f21
n[::1]:5173
p41872
cclaude
f9
n*:8080
`;

export const TERMS = [
  { address: "t4", pid: 1467, state: "live", labels: {}, name: "zsh" },
  { address: "t7", pid: 50112, state: "live", labels: { "nocturne.name": "web" } },
  { address: "t9", pid: 999999, state: "live", labels: {} }, // no pane, its process gone
  { address: "box/t1", pid: 50, state: "live", labels: {} }, // another machine
];
export const PANES = [
  { pane: "p1", tab: "tA", terminal: "t4", cwd: "/w", status: "working", program: { name: "claude" }, focused: true },
  { pane: "p2", tab: "tB", terminal: "t7", cwd: "/w/web", status: null, program: { name: "zsh" } },
  { pane: "p3", tab: "tB", terminal: null, mod: "browser", props: { slot: "s9" } },
];
export const SPACES = [
  { id: "s1", name: "fireflies", folder: "/w", machine: null, tabs: [{ id: "tA", index: 1, name: "claude" }, { id: "tB", index: 2, name: "api" }] },
  { id: "s2", name: "homelab", folder: "/srv", machine: "box", tabs: [{ id: "tC", index: 1, name: "x" }] },
];

// The system probe (procs/sys.js SYS_PROBE) on a Mac, trimmed, addresses scrubbed.
const S = "@@nocturne-sys@@";
export const SYS = `10
34359738368
16384
1
${S}
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    12958.
Pages active:                                 660263.
Pages inactive:                               650508.
Pages wired down:                             271923.
Pages purgeable:                                4455.
"Translation faults":                     3231391271.
Anonymous pages:                             1000893.
Pages stored in compressor:                   971757.
Pages occupied by compressor:                 459103.
${S}
Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       1571308     0  184554271  1571308     0  184554271     0
lo0        16384 127           localhost        1571308     -  184554271  1571308     -  184554271     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
utun0      1380  <Link#20>                            0     0          0        3     0        260     0
en1        1500  <Link#16>   02:00:00:00:00:00 12106332     0 12944968792  1576563     0  232230661     0
en1        1500  10/24         10.0.0.16       12106332     - 12944968792  1576563     -  232230661     -
en12       1500  <Link#11>   02:00:00:00:00:00  4580550     0 5424149797   732778     0  363662454     0
${S}
Filesystem     1024-blocks      Used Available Capacity iused     ifree %iused  Mounted on
/dev/disk3s1s1   482797652  13338384  53264692    21%  484019 532646920    0%   /
${S}
"Device Utilization %"=53
${S}
              disk0               disk6               disk8       cpu    load average
    KB/t  tps  MB/s     KB/t  tps  MB/s     KB/t  tps  MB/s  us sy id   1m   5m   15m
   22.98  219  4.92    37.04  284 10.28    25.68    3  0.07  13  5 82  104.18 138.27 138.06
   13.16 1001 12.86    33.68  481 15.80     0.00    0  0.00  62 18 20  104.18 138.27 138.06
`;

// The same probe on a machine with none of these tools (Linux without them): sysctl alone fails too.
export const SYS_NONE = `${S}\n${S}\n${S}\n${S}\n${S}\n`;
