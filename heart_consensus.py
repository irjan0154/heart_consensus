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
            "You are a satirical matchmaking AI. "
            "Read this dating profile and create a funny fictional soulmate.\n\n"
            "PROFILE:\n"
            "Age: " + age + "\n"
            "Hobbies: " + hobby + "\n"
            "Bad habits: " + bad_habits + "\n"
            "Food: " + food_relationship + "\n"
            "Red flag: " + red_flag + "\n"
            "Wants: " + partner_must + "\n\n"
            "Pick the funniest trait and exaggerate it:\n"
            "- lots of food/eating -> very fat, food is their personality\n"
            "- alcohol -> cheerful alcoholic\n"
            "- lazy -> cannot leave couch\n"
            "- gym -> absurdly muscular\n"
            "- work -> hollow-eyed workaholic\n\n"
            "Respond with ONLY this JSON and nothing else:\n"
            "{\"name\": \"NAME\", \"age\": \"AGE\", \"tagline\": \"TAGLINE\", "
            "\"description\": \"DESCRIPTION\", \"compatibility_note\": \"NOTE\", "
            "\"image_prompt\": \"PROMPT\"}"
        )

        result = gl.nondet.exec_prompt(prompt)
        # Store raw result — parse on frontend
        # Just clean up markdown if present
        cleaned = result.strip()
        if "```" in cleaned:
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
        # Find JSON boundaries
        s = cleaned.find("{")
        e = cleaned.rfind("}") + 1
        if s >= 0 and e > s:
            self.last_match = cleaned[s:e]
        else:
            # Fallback: store whatever came back so frontend can see it
            self.last_match = '{"name":"Mystery","age":"?","tagline":"The validators did their best","description":"' + cleaned[:200].replace('"', "'") + '","compatibility_note":"Fate brought you here","image_prompt":"candid portrait of a mysterious smiling person, warm light, 35mm lens, photorealistic"}'

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
