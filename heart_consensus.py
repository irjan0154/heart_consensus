# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


class HeartConsensus(gl.Contract):
    last_match: str

    def __init__(self):
        self.last_match = ""

    @gl.public.write
    def find_soulmate(
        self,
        age: str,
        friends_description: str,
        hobby: str,
        bad_habits: str,
        food_relationship: str,
        schedule: str,
        green_flag: str,
        red_flag: str,
        ideal_weekend: str,
        partner_must: str,
    ) -> None:

        person = (
            "Age: " + age + ". "
            "Friends say: " + friends_description + ". "
            "Hobby: " + hobby + ". "
            "Bad habits: " + bad_habits + ". "
            "Food: " + food_relationship + ". "
            "Schedule: " + schedule + ". "
            "Green flag: " + green_flag + ". "
            "Red flag: " + red_flag + ". "
            "Weekend: " + ideal_weekend + ". "
            "Partner must: " + partner_must + "."
        )

        prompt = (
            "You are a brutally funny matchmaking AI. Generate a soulmate for this person.\n"
            "RULES:\n"
            "- Give them what they want but in the most inconvenient real version\n"
            "- Mirror their worst trait but worse\n"
            "- Be specific and funny\n"
            "- Respond in the SAME LANGUAGE as the person answers\n"
            "- image_prompt must be in English only\n"
            "PERSON: " + person + "\n"
            "Return ONLY raw JSON, no markdown, no backticks:\n"
            '{"name":"X","age":"N","tagline":"X","description":"X","compatibility_note":"X","image_prompt":"X photorealistic portrait photo natural light 35mm candid no illustration no anime"}'
        )

        result = gl.nondet.exec_prompt(prompt)
        result = result.strip()

        # Remove markdown backticks
        if "```" in result:
            result = result.replace("```json", "").replace("```", "").strip()

        # Find JSON object
        start = result.find("{")
        end = result.rfind("}") + 1

        if start == -1 or end == 0:
            # Fallback: use raw result as description
            self.last_match = json.dumps({
                "name": "Unknown",
                "age": age,
                "tagline": "The validators tried their best.",
                "description": result[:200] if result else "No result.",
                "compatibility_note": "Fate is mysterious.",
                "image_prompt": "portrait photo natural light photorealistic"
            }, ensure_ascii=False)
            return

        try:
            obj = json.loads(result[start:end])
        except Exception:
            # Try to fix common JSON issues - truncate to valid JSON
            chunk = result[start:end]
            # Remove trailing commas before closing braces
            import re
            chunk = re.sub(r',\s*}', '}', chunk)
            chunk = re.sub(r',\s*]', ']', chunk)
            obj = json.loads(chunk)

        # Fill missing fields with defaults
        defaults = {
            "name": "Mystery",
            "age": age,
            "tagline": "Certified chaotic.",
            "description": "A person of unique qualities.",
            "compatibility_note": "Chaos attracts chaos.",
            "image_prompt": "portrait photo natural light photorealistic candid 35mm no illustration"
        }
        for key in defaults:
            if key not in obj or not obj[key]:
                obj[key] = defaults[key]

        self.last_match = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
