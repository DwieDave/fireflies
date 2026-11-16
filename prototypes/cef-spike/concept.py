# Throwaway: patches a scratch home's copy of the browser mod with one engine-mark concept.
#   python3 concept.py <mods dir> A|B
import sys, re
mods, which = sys.argv[1], sys.argv[2]
bar = f"{mods}/browser/bar.ts"
strip = f"{mods}/browser/strip.ts"
s = open(bar).read()
hook = '''    .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(host || "blank"))'''
if which == "A":
    mark = '''    .when(view.engine === "chromium", (el) => el.child(div().id("engine").flex_none().mr(6).px(4).h(14).flex().items_center().border(1).border_color(t.ansi8).text_size(9).text_color(t.ansi6).child("chromium")))
'''
else:
    mark = '''    .when(view.engine === "chromium", (el) => el.child(div().absolute().left(0).top(3).bottom(3).w(2).child(dither(t.ansi6, 1))).pl(9))
'''
s = s.replace(hook, mark + hook)
open(bar, "w").write(s)
if which == "B":
    t = open(strip).read()
    hook2 = '''      .child(tabMark(view, t, tab, on || lifted))'''
    t = t.replace(hook2, '''      .when(view.engine === "chromium", (el) => el.child(div().absolute().left(6).right(6).top(0).h(2).child(dither(t.ansi6, 1))))
''' + hook2)
    if "import { dither }" not in t:
        t = 'import { dither } from "./dither.ts";\n' + t
    open(strip, "w").write(t)
