import json

log_file = "/Users/qinwengu/.gemini/antigravity/brain/39b28bb1-9507-4faa-ad57-1b03e0a63e68/.system_generated/logs/transcript.jsonl"
edits = []
with open(log_file) as f:
    for line in f:
        data = json.loads(line)
        if "tool_calls" in data:
            for tc in data["tool_calls"]:
                args = tc.get("function", {}).get("arguments", "{}")
                try:
                    args_obj = json.loads(args)
                    target = args_obj.get("TargetFile", "")
                    if "Assistant.tsx" in target:
                        edits.append(tc["function"]["name"])
                except:
                    pass
print("Edits to Assistant.tsx:", len(edits))
print("Tools used:", set(edits))
