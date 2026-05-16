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

        prompt = (
            "You are a funny matchmaking AI. Analyze this person and generate their perfect (wrong) match.\n\n"
            "RULES:\n"
            "1. Give them what they want (green_flag, partner_must) but in the most inconvenient version.\n"
            "2. Mirror their worst habit (red_flag, bad_habits) but one level worse.\n"
            "3. Be specific and visual. Not 'messy' but 'three pizza boxes and a cat named Debt'.\n"
            "4. Detect the language of the answers and respond in that same language - EXCEPT the image_prompt field which must ALWAYS be in English.\n"
            "5. image_prompt: realistic portrait photo, identify the most extreme trait and exaggerate it visually to absurdity. End with: 'photorealistic portrait photo, natural light, 35mm, candid, no illustration, no anime'\n\n"
            "PERSON:\n"
            f"- Age: {age}\n"
            f"- Friends say: {friends_description}\n"
            f"- Hobby: {hobby}\n"
            f"- Bad habits: {bad_habits}\n"
            f"- Food: {food_relationship}\n"
            f"- Schedule: {schedule}\n"
            f"- Green flag: {green_flag}\n"
            f"- Red flag: {red_flag}\n"
            f"- Ideal weekend: {ideal_weekend}\n"
            f"- Partner must: {partner_must}\n\n"
            "Return ONLY a JSON object on a single line. No markdown, no backticks, no newlines inside strings.\n"
            "Required fields: name, age, tagline, description, compatibility_note, image_prompt.\n"
            "The age field must be a single number like 34.\n"
            'Example: {"name":"Sofia","age":"34","tagline":"One sentence.","description":"Two sentences.","compatibility_note":"One sentence.","image_prompt":"English description... photorealistic portrait photo, natural light, 35mm, candid, no illustration, no anime"}'
        )

        def generate_match() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.strip()
            # Strip markdown
            if "```" in result:
                result = result.replace("```json", "").replace("```", "").strip()
            # Extract JSON
            start = result.find("{")
            end = result.rfind("}") + 1
            if start == -1 or end == 0:
                raise ValueError("No JSON in response")
            parsed = json.loads(result[start:end])
            # Validate fields
            for field in ["name", "age", "tagline", "description", "compatibility_note", "image_prompt"]:
                if field not in parsed:
                    raise ValueError("Missing: " + field)
            return json.dumps(parsed, sort_keys=True, ensure_ascii=False)

        self.last_match = gl.eq_principle.prompt_comparative(
            generate_match,
            "Equivalent if both describe a similar character with same core twist. "
            "Minor differences in name or wording are fine. "
            "JSON must be valid with all required fields."
        )

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
