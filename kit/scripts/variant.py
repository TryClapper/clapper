"""Switch the project to one problem-scene variant: writes video.json, VO timing and audio.json from variants/<name>.json.
   python3 scripts/variant.py tangle   (then: python3 scripts/audio.py && node scripts/kit.mjs build)"""
import json, sys
v = json.load(open(f"variants/{sys.argv[1]}.json"))
json.dump(v["video"], open("video.json", "w"), indent=1, ensure_ascii=False)
json.dump(v["timing"], open("public/audio/vo/timing.json", "w"), indent=1)
json.dump(v["audio"], open("audio.json", "w"), indent=1, ensure_ascii=False)
print(f"variant {sys.argv[1]}: " + " · ".join(f'{s["id"]} {s["component"]} {s["frames"]}f' for s in v["video"]["scenes"]))
