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

        prompt = f"""
You are a hilariously honest matchmaking AI working for HeartConsensus —
a decentralized blockchain matchmaking service. Your job is to analyze
a person's profile and generate their ideal soulmate character.

IMPORTANT RULES:
- Be creative and humorous — exaggerate the person's traits in a fun way
- The worse or weirder the input, the more entertaining the result should be
- NEVER generate a generic attractive person — make the match feel unique and real
- Do NOT be offensive, keep it fun and warm

PERSON'S PROFILE:
- Age: {age}
- How friends describe them: {friends_description}
- Favorite hobby: {hobby}
- Bad habits: {bad_habits}
- Relationship with food: {food_relationship}
- Schedule type: {schedule}
- Biggest green flag: {green_flag}
- Biggest red flag: {red_flag}
- Ideal weekend: {ideal_weekend}
- Their perfect partner must: {partner_must}

Respond ONLY with the following JSON format, nothing else.
Do not include any other words, markdown, or formatting.
The result must be perfectly parsable by a JSON parser without errors.

{{
  "name": "a first name that fits the character",
  "age": "estimated age range e.g. 28-32",
  "tagline": "one funny and witty sentence describing this person",
  "description": "2-3 sentences describing personality lifestyle and quirks. Be funny and specific.",
  "compatibility_note": "one sentence explaining why they are perfect for each other humorously",
  "image_prompt": "detailed image prompt: physical appearance style setting mood. Caricature illustration style warm colors slightly exaggerated features fun and charming. No text in image."
}}
"""

        def generate_match() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(result)
            return json.dumps(parsed, sort_keys=True, ensure_ascii=False)

        self.last_match = gl.eq_principle.prompt_comparative(
            generate_match,
            "The outputs are equivalent if the generated soulmate character "
            "is creative and humorous and clearly tailored to the person's profile. "
            "The JSON must be valid and contain all required fields: "
            "name, age, tagline, description, compatibility_note, image_prompt."
        )

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
