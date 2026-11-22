// An Effect-written mod for the iOS MVP: the real `effect` bundle and
// @fireflies/kit, served as library modules, in gpui-shell's QuickJS engine.
import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element } from "gpui-kit";
import { Effect, Layer, Schema } from "effect";
import { decodeJson, modRuntime } from "@fireflies/kit";

const Agent = Schema.Struct({ name: Schema.String, busy: Schema.Boolean });
const runtime = modRuntime(Layer.empty);

const program = Effect.gen(function* () {
  const ok = yield* decodeJson(Agent, "agent")('{"name":"nocturne","busy":true}');
  const bad = yield* decodeJson(Agent, "agent")('{"name":42}').pipe(
    Effect.as("not caught"),
    Effect.catch((e) => Effect.succeed(`caught ${e._tag}`)),
  );
  return [`decoded ${ok.name}, busy ${ok.busy}`, bad];
});

export default class EffectMvp extends View {
  lines: readonly string[] = ["running…"];

  init(_props: unknown, cx: AsyncContext) {
    const fx = runtime.attach(cx, (message) => { this.lines = [`failed: ${message}`]; });
    fx.run(Effect.map(program, (lines) => { this.lines = lines; }));
  }

  render(_cx: Context<this>): Element {
    return div().flex().flex_col().gap(6).p(14).rounded(14).bg("#161c2c").text_color("#e8e6e3").text_size(15)
      .child(div().text_color("#f2c14e").child("Effect mod in QuickJS"))
      .children(this.lines.map((line) => div().child(line)));
  }
}
