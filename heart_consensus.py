# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

class HeartConsensus(gl.Contract):
    last_match: str
    def __init__(self):
        self.last_match = ""
    
    @gl.public.write
    def find_soulmate(self, age: str, friends_description: str, hobby: str, bad_habits: str, food_relationship: str, schedule: str, green_flag: str, red_flag: str, ideal_weekend: str, partner_must: str) -> None:
        prompt = "Generate a funny fictional person as JSON. Keys: name, age, tagline, description, compatibility_note, image_prompt. Return raw JSON only."
        result = gl.nondet.exec_prompt(prompt).strip()
        if result.startswith("```"):
            result = result.replace("```json","").replace("```","").strip()
        start = result.find("{")
        end = result.rfind("}") + 1
        if start >= 0 and end > 0:
            data = json.loads(result[start:end])
        else:
            data = {"name":"Test","age":"30","tagline":"Test","description":"Test","compatibility_note":"Test","image_prompt":"portrait photo"}
        self.last_match = json.dumps(data, ensure_ascii=False, separators=(',',':'))
    
    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
