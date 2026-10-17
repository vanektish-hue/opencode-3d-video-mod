"""edge-tts helper: synthesize one narration chunk and dump word timings.

Usage:  python tts.py request.json
request.json = {"text","voice","rate","pitch","volume","mp3","json","boundary"}
Writes the mp3 and a JSON array of {t,d,w,type} boundaries (seconds).
Retries a few times because the public service occasionally throttles.
"""
import sys
import json
import asyncio
import edge_tts


async def attempt_once(req):
    kwargs = {
        "boundary": req.get("boundary", "WordBoundary"),
    }
    if req.get("rate"):
        kwargs["rate"] = req["rate"]
    if req.get("pitch"):
        kwargs["pitch"] = req["pitch"]
    if req.get("volume"):
        kwargs["volume"] = req["volume"]
    communicate = edge_tts.Communicate(req["text"], req["voice"], **kwargs)
    marks = []
    got_audio = False
    total_bytes = 0
    with open(req["mp3"], "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                if chunk["data"]:
                    got_audio = True
                    total_bytes += len(chunk["data"])
                    f.write(chunk["data"])
            elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                marks.append({
                    "t": chunk["offset"] / 1e7,
                    "d": chunk["duration"] / 1e7,
                    "w": chunk["text"],
                    "type": chunk["type"],
                })
    if not got_audio:
        raise RuntimeError("no audio received")
    # The service occasionally returns a truncated snippet; treat that as a
    # failed take so the retry loop gets a proper one.
    if total_bytes < 4000:
        raise RuntimeError(f"audio too small ({total_bytes} bytes)")
    if not marks and len(req["text"]) > 40:
        raise RuntimeError("no word boundaries")
    with open(req["json"], "w", encoding="utf-8") as f:
        json.dump(marks, f, ensure_ascii=False)
    return marks


async def run(req):
    last = None
    for attempt in range(8):
        try:
            marks = await attempt_once(req)
            print(json.dumps({"ok": True, "marks": len(marks)}))
            return
        except Exception as e:  # noqa: BLE001 - retry any transport error
            last = e
            sys.stderr.write(f"attempt {attempt + 1} failed: {e}\n")
            await asyncio.sleep(1.2 * (attempt + 1))
    raise last


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        request = json.load(f)
    asyncio.run(run(request))
