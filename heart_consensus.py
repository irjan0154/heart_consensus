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
            f"Age: {age}. "
            f"Friends say: {friends_description}. "
            f"Hobby: {hobby}. "
            f"Bad habits: {bad_habits}. "
            f"Food: {food_relationship}. "
            f"Schedule: {schedule}. "
            f"Green flag: {green_flag}. "
            f"Red flag: {red_flag}. "
            f"Weekend: {ideal_weekend}. "
            f"Partner must: {partner_must}."
        )

        prompt = f"""You are a brutally funny matchmaking AI. Generate a soulmate character for this person.

RULES:
- Give them what they want (green_flag, partner_must) in the most inconvenient real version
- Mirror their worst trait (red_flag, bad_habits) but worse
- Be specific and funny
- Respond in the same language as the person's answers
- The image_prompt field must always be in English

PERSON: {person}

Respond with ONLY a JSON object. No markdown. No explanation. No newlines inside string values.
Use this exact structure:
{{"name":"NAME","age":"NUMBER","tagline":"FUNNY ONE LINER","description":"2-3 FUNNY SENTENCES","compatibility_note":"ONE SENTENCE","image_prompt":"ENGLISH PHOTO DESCRIPTION photorealistic portrait photo natural light 35mm candid no illustration no anime"}}"""

        def generate_match() -> str:
            raw = gl.nondet.exec_prompt(prompt).strip()
            # Remove markdown if present
            if raw.startswith("```"):
                lines = [l for l in raw.split("\n") if not l.strip().startswith("```")]
                raw = "\n".join(lines).strip()
            # Find JSON boundaries
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start < 0 or end <= 0:
                raise ValueError("No JSON found")
            obj = json.loads(raw[start:end])
            # Ensure all fields present
            for f in ["name", "age", "tagline", "description", "compatibility_note", "image_prompt"]:
                if f not in obj:
                    raise ValueError("Missing field: " + f)
            # Return compact single-line JSON
            return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))

        self.last_match = gl.eq_principle.prompt_comparative(
            generate_match,
            "The outputs are equivalent if both generated soulmates reflect the same "
            "character type with similar humor and traits. "
            "Differences in name, exact wording, or minor details are acceptable. "
            "Both must be valid JSON with all 6 required fields."
        )

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
