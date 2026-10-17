# Creator Mod — 3D-моделирование и видеомонтаж для OpenCode

Мод для OpenCode, который даёт агенту два инструмента в одном:

1. **3D-моделирование** — процедурные и примитивные модели в JSON-сцене, CPU-рендер
   превью «без видеокарты», экспорт в **glTF 2.0 (.glb)** и **.obj**, и интерактивный
   **Three.js-вьюпорт** прямо во встроенном браузере OpenCode.
2. **Видеомонтаж** — декларативный таймлайн компилируется в **один ffmpeg
   `filter_complex`**: переходы (`xfade`), текст с разными шрифтами и анимацией
   (`drawtext`), картинки-оверлеи, **motion blur** (`tmix`), цветокоррекция, вигнетка,
   фейды и синтезированное аудио.

Всё это доступно агенту как MCP-инструменты (`tools.creator.*`) в Code Mode, а
человеку — как графическое окно (панель Review во встроенном браузере).

---

## 🎬 Фильм «Как ИИ собрал это видео» (~10 минут)

Кроме технического шоурила мод умеет собрать **целый фильм-объяснение**: 30 реплик
нейросетевой озвучки от первого лица — от лица самой нейросети, 10 процедурных
3D-моделей, монтаж, субтитры, музыку, вотермарку канала и блок поддержки автора на
третьей минуте (рекламы в ролике нет). Озвучка задаёт тайминг, под неё
подгоняются сцены и субтитры.

```sh
npm run movie:voice   # 1) синтез озвучки (Python + edge-tts) -> narration.json
npm run movie:dry     # 2) только раскладка: длительности, блок поддержки, главы
npm run movie         # 3) полная сборка -> exports/movie.mp4
```

Результат: `exports/movie.mp4` (1280×720, ~10:30), `exports/movie.srt`,
`exports/movie.description.txt` (описание с главами для YouTube).
Подробности пайплайна — в [`docs/MOVIE.md`](docs/MOVIE.md), текст озвучки — в
[`docs/SCRIPT.md`](docs/SCRIPT.md).

---

## 🤖 Для других ИИ-агентов

Этот проект задуман как **инструмент, которым пользуется сам ИИ** (агент).
Если ты — агент, получивший этот код, прочитай **[`AGENTS.md`](AGENTS.md)**
(приоритетная инструкция): как запускаться, как не сломать растеризатор,
как понимать тайминги фильма, что можно и нельзя класть в репозиторий.

## Что демонстрирует мод

Полностью автономный конвейер (`tools.creator.showreel` / `npm run demo`):

- процедурная **компьютерная мышь** (21 узел, ~18 750 треугольников, 8 материалов);
- **анимация 3D**: орбитальная камера + субкадровый **motion blur**, 101 кадр на CPU;
- **логотип-кольцо** с альфа-каналом (оверлей);
- монтаж **16.1 с** шоурила: 5 сцен, 4 перехода (`wipeleft`, `circleopen`,
  `slideleft`, `fadeblack`), текст в **6+ шрифтах** (Bahnschrift, Georgia, Impact,
  Comic Sans, Consolas, Ink Free, Segoe UI, Arial Black), анимация текста
  (slideUp/slideRight), плашки, тени, обводка;
- процедурный фон (`gradients`, `mandelbrot`) + FX (hue shift, motion blur, вигнетка);
- аудио: аккордовая подложка + пентатоническая мелодия + шум;
- на выходе: **H.264 1280×720 @ 24 fps + AAC**, ≈16 с.

Артефакты лежат в `exports/`:

| Файл | Что это |
| --- | --- |
| `exports/showreel.mp4` | готовый шоурил (16.1 с, 1280×720, h264+aac) — единственное видео в репозитории |
| `exports/computer-mouse.png`, `exports/project.json` … | генерируются командами, в git не хранятся |

В репозиторий не кладутся объёмные артефакты: `movie.mp4`, рендеры, `tmp/`,
`node_modules/` (см. `.gitignore`). Всё это воспроизводится командами выше.

---

## Быстрый старт

```sh
cd opencode-3d-video-mod
npm install          # SDK, ffmpeg-static, ffprobe-static, three, ws
node bin/setup.js    # доктор окружения: бинарники, шрифты, зависимости
npm test             # 17 тестов (3D, GLB, видео, MCP, растеризатор, раскладка фильма)
npm run demo         # полный шоурил -> exports/showreel.mp4
npm run ui           # открыть вьюпорт + таймлайн в браузере
```

Требуется **Node ≥ 20**. ffmpeg/ffprobe скачиваются как статические сборки
(`ffmpeg-static`/`ffprobe-static`), так что системный ffmpeg не нужен.

---

## Регистрация в OpenCode

Добавьте сервер `creator` в `opencode.jsonc` проекта (файл уже лежит в корне
рабочей папки):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "creator": {
        "type": "local",
        "command": ["node", "bin/mcp.js"],
        "cwd": "opencode-3d-video-mod",
        "environment": { "CREATOR_EXPORT_DIR": "exports" }
      }
    }
  }
}
```

После подключения агент получает инструменты `tools.creator.<tool>` в Code Mode:

| Инструмент | Назначение |
| --- | --- |
| `modeling_new_scene` | создать пустую сцену |
| `modeling_add_mouse` | добавить целую процедурную мышь |
| `modeling_add_primitive` | примитив (ellipsoid/box/roundedBox/cylinder/torus/capsule/tube/disk) |
| `modeling_transform` / `modeling_set_material` | трансформ / материал узла |
| `modeling_add_light` / `modeling_set_camera` | свет / камера |
| `modeling_list` / `modeling_delete` | список / удаление узлов |
| `modeling_preview` | CPU-рендер сцены (возвращает PNG) |
| `modeling_render_frames` | анимированная PNG-секвенция с motion blur |
| `modeling_export_glb` / `modeling_export_obj` | экспорт модели |
| `video_new_timeline` / `video_add_clip` | таймлайн и клипы |
| `video_add_transition` | переходы `xfade` |
| `video_add_text` / `video_set_texts` | текст (шрифты, анимация) |
| `video_add_overlay` | картинка-оверлей |
| `video_set_audio` | аудио-дорожки |
| `video_info` / `video_render` | сводка / рендер в mp4 |
| `video_logo` | рендер логотипа-кольца (PNG с альфой) |
| `showreel` | весь демо-конвейер одной командой |
| `movie_plan` | план 10-минутного фильма без рендера (сцены, длительности, блок поддержки, главы) |
| `movie_build` | собрать фильм целиком (3D-клипы + нейроозвучка + музыка + субтитры) |
| `ui_open` / `ui_status` | запуск веб-вьюпорта |
| `project_summary` / `project_save` / `project_load` | состояние проекта |

---

## Web UI (Three.js-вьюпорт)

`ui_open` (или `npm run ui`) поднимает локальный сервер и возвращает URL. Откройте
его во встроенном браузере:

- слева — **интерактивный 3D-вьюпорт**: вращение (ЛКМ), панорама (Shift/ПКМ),
  зум (колесо), кнопки видов Persp/Front/Side/Top/Back, wireframe, сетка;
- кнопка **CPU render** — серверный растеризатор отдаёт PNG-кадр;
- справа — **дерево сцены** и **панель таймлайна** (клипы, переходы, тексты,
  оверлеи, аудио); обновляются в реальном времени по WebSocket.

Стек UI: статический HTML/CSS/JS + `three` из `node_modules` (отдаётся по
`/vendor/three/`), живое состояние — через `/api/state` и `/ws`.

---

## Архитектура

```
opencode-3d-video-mod/
├─ bin/
│  ├─ mcp.js          # точка входа MCP (stdio) — то, что запускает OpenCode
│  ├─ ui.js           # отдельный запуск веб-вьюпорта
│  ├─ demo.js         # CLI полного шоурила
│  └─ setup.js        # доктор окружения
├─ src/
│  ├─ core/
│  │  ├─ mesh.js      # построение мешей (ellipsoid, roundedBox, torus, tube, ...)
│  │  ├─ scene.js     # JSON-граф сцены, материалы, статистика
│  │  ├─ raster.js    # CPU-растеризатор (renderImageAA, renderCutout, accumulate)
│  │  ├─ mat.js       # вектора/матрицы/освещение
│  │  ├─ png.js       # кодирование PNG (RGBA + альфа)
│  │  ├─ glb.js       # экспорт glTF 2.0 (.glb) и .obj
│  │  ├─ mouse.js     # процедурная модель мыши
│  │  ├─ frames.js    # анимация: ключи камеры, движение blur, секвенции
│  │  ├─ video.js     # таймлайн -> ffmpeg filter_complex
│  │  ├─ ffmpeg.js    # обёртки ffmpeg/ffprobe (статические сборки)
│  │  └─ project.js   # хранилище проекта (сцена+таймлайн), события, персист
│  ├─ mcp/server.js   # MCP-сервер: схемы инструментов + обработчики
│  ├─ ui/server.js    # HTTP+WS сервер вьюпорта
│  └─ demo/showreel.js# сборка демо (логотип, 3D-клип, монтаж, аудио)
├─ web/               # index.html, styles.css, viewport.js, timeline.js, app.js
├─ scripts/           # QA/утилиты: movie-voice, movie-thumbnail, verify-movie, ascii-preview...
├─ tests/             # mouse / video / mcp / movie / raster
└─ opencode.jsonc     # регистрация MCP-сервера
```

### Как работает 3D

Сцена — обычный JSON (узлы, примитивы-спеки, материалы, свет, камера). Из спека
геометрия строится лениво и кэшируется. Для превью/кадров используется
**собственный CPU-растеризатор** (`raster.js`): без GPU и нативных зависимостей, с
AMBIENT+диффуз+спекуляр, супер-сэмплингом и альфа-режимом cutout для логотипов.
Тот же JSON отображается в браузере через Three.js (`web/viewport.js`), а экспорт
идёт в glTF 2.0 (`glb.js`) для внешних редакторов.

### Как работает видео

Таймлайн (`createTimeline`) — список сегментов/переходов/текстов/оверлеев/аудио.
`buildFFmpegArgs` компилирует его в **один граф**:

- клипы → `[i:v] fps,scale,pad, [filters], tmix, eq/vignette, drawtext ... [lN]`;
- переходы → `[lA][lB] xfade=transition=<тип>:duration:offset`;
- оверлеи → `overlay` с фейдами и `enable='between(...)'`;
- текст → `drawtext=textfile=...` (обход проблем с экранированием, поддержка .ttf);
- аудио → `sine`/`aevalsrc`-дорожки, сведение `amix`, фейды;
- вывод → `-t <total>` + `libx264`/`aac`.

---

## Тесты

`npm test` (17 тестов, `node --test`):

- **mouse**: структура сцены, группы/дети, валидность GLB (magic/версия/чанки/JSON),
  OBJ, непустой CPU-рендер (контраст/дисперсия), альфа-cutout;
- **video**: сборка filter-графа, разрешение шрифтов, реальный рендер mp4
  (проверка кодека, размеров, длительности), математика длительности с переходами;
- **raster**: ближняя грань закрытого тела побеждает в z-буфере (нет дыр/просвечивания);
- **movie**: раскладка ~10-минутного фильма, блок поддержки на ~3-й минуте,
  реплики озвучки не накладываются;
- **mcp**: запуск stdio-сервера, `initialize`, `tools/list`, вызов
  `modeling_add_mouse`, получение image-блока из `modeling_preview`.

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

---

## Лицензия

MIT — см. [`LICENSE`](LICENSE).

---

## Ограничения

- CPU-растеризатор оптимизирован под корректность и предсказуемость, а не под
  реалтайм: 1280×720 кадр мыши — сотни миллисекунд. Для превью используйте
  меньший размер/`aa: 1`, для интерактива — Three.js-вьюпорт (GPU браузера).
- `modeling_preview` возвращает PNG; часть моделей не умеет читать
  изображения — тогда используйте `browser.preview` для показа пользователю и
  ASCII-диагностику (`scripts/ascii-preview.mjs`) для самопроверки.
- Шрифты берутся из `C:\Windows\Fonts`; на других ОС задайте `FONT_DIR` или
  кладите `.ttf` рядом.
