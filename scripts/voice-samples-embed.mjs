// Build a self-contained (base64) voice-sample page so it works in the Review pane.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const d = join(import.meta.dirname, "..", "tmp", "voice-samples");
const order = ["02-andrew", "03-brian", "04-ava", "05-emma", "06-seraphina", "07-vivienne", "00-dmitry", "01-svetlana"];
const labels = {
  "02-andrew": "andrew — мультиязычный, мужской (рекомендую)",
  "03-brian": "brian — мультиязычный, мужской, разговорный",
  "04-ava": "ava — мультиязычный, женский (рекомендую)",
  "05-emma": "emma — мультиязычный, женский, бодрый",
  "06-seraphina": "seraphina — мультиязычный, женский",
  "07-vivienne": "vivienne — мультиязычный, женский",
  "00-dmitry": "dmitry — русский (как сейчас)",
  "01-svetlana": "svetlana — русский (как сейчас)",
};
const rows = order
  .map((k) => {
    const b = readFileSync(join(d, `${k}.mp3`)).toString("base64");
    return `<div class="row"><div class="label">${labels[k] || k}</div><audio controls preload="metadata" src="data:audio/mpeg;base64,${b}"></audio></div>`;
  })
  .join("\n");
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Голоса</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:Tahoma,Arial,sans-serif;max-width:780px;margin:32px auto;padding:0 20px}
h1{font-size:22px}.row{display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid #21262d}
.label{width:340px;font-size:14px;color:#9fb4cc}audio{height:36px}</style></head><body>
<h1>Выбор голоса озвучки</h1>
<p style="color:#8b98a5;font-size:14px">Послушай и выбери голос (можно два: мужской + женский). Все читают один и тот же русский текст.</p>
${rows}
</body></html>`;
const out = join(d, "index-self.html");
writeFileSync(out, html, "utf8");
console.log("wrote", out, new Date().toISOString().slice(11, 19));
