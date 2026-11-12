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
  { pane: "p3", tab: "tB", terminal: null, mod: "nocturne-browser", props: { slot: "s9" } },
];
export const SPACES = [
  { id: "s1", name: "fireflies", folder: "/w", machine: null, tabs: [{ id: "tA", index: 1, name: "claude" }, { id: "tB", index: 2, name: "api" }] },
  { id: "s2", name: "homelab", folder: "/srv", machine: "box", tabs: [{ id: "tC", index: 1, name: "x" }] },
];
