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
            "You are a savage satirical matchmaking AI. "
            "Read this dating profile and create a hilariously exaggerated fictional soulmate.\n\n"
            "PROFILE:\n"
            "Age: " + age + "\n"
            "Friends describe me as: " + friends_description + "\n"
            "Hobbies: " + hobby + "\n"
            "Bad habits: " + bad_habits + "\n"
            "Food relationship: " + food_relationship + "\n"
            "Schedule: " + schedule + "\n"
            "Green flag in partner: " + green_flag + "\n"
            "Red flag I overlook: " + red_flag + "\n"
            "Ideal weekend: " + ideal_weekend + "\n"
            "Partner must: " + partner_must + "\n\n"
            "RULES:\n"
            "1. Pick the ONE most absurd trait and push it to the extreme.\n"
            "2. The character description must be funny and over-the-top.\n"
            "3. The image_prompt must match the exaggeration visually — be VERY specific:\n"
            "   - alcohol/drinking -> weathered face, red puffy nose, broken capillaries, "
            "bleary bloodshot eyes, disheveled hair, stained shirt, holding a bottle, "
            "sitting in a messy apartment at noon, photorealistic\n"
            "   - overeating/food -> extremely obese, round bloated face, double chin, "
            "tiny eyes lost in puffy cheeks, food stains on shirt, surrounded by empty "
            "takeout boxes, sitting in a reinforced chair, photorealistic\n"
            "   - lazy/couch -> pale doughy skin, unwashed greasy hair, baggy eyes, "
            "wearing the same clothes for days, half-melted into a worn-out couch, "
            "surrounded by remote controls and chip bags, photorealistic\n"
            "   - gym/fitness -> grotesquely oversized muscles, tiny head on enormous body, "
            "neck thicker than head, veins bulging everywhere, can barely walk, "
            "wearing a tank top 3 sizes too small, photorealistic\n"
            "   - workaholic -> hollow sunken eyes with dark circles, grey skin, "
            "thinning stressed hair, hunched over multiple laptops at 3am, "
            "empty coffee cups everywhere, hasn't seen sunlight in weeks, photorealistic\n"
            "   - money/greed -> gaudy expensive clothes that clash horribly, "
            "dripping in tacky gold jewelry, counting cash with a smug grin, photorealistic\n"
            "   - gaming -> pale pasty skin, energy drink cans everywhere, "
            "gaming chair with permanent body imprint, squinting from screen glare, "
            "has not left the room in days, photorealistic\n"
            "4. Always end image_prompt with: "
            "'photorealistic portrait, natural lighting, 35mm lens, ultra detailed, "
            "no cartoon, no illustration'\n\n"
            "Respond with ONLY valid JSON, no markdown, no backticks:\n"
            "{\"name\": \"FIRST NAME and LAST NAME only, no nickname, no quotes\", "
            "\"age\": \"AGE\", "
            "\"tagline\": \"one-liner that perfectly captures their absurd trait\", "
            "\"description\": \"2-3 sentences of savage funny description\", "
            "\"compatibility_note\": \"why you two are perfect for each other (sarcastic and specific)\", "
            "\"image_prompt\": \"extremely detailed visual description for image generation\"}"
        )

        def leader_fn() -> str:
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            return json.dumps(result, sort_keys=True, ensure_ascii=False)

        result = gl.eq_principle.prompt_non_comparative(
            leader_fn,
            task="Generate a fictional soulmate profile as JSON",
            criteria=(
                "ACCEPT if the result is a JSON string containing these 6 keys: "
                "name, age, tagline, description, compatibility_note, image_prompt. "
                "REJECT only if the JSON is malformed or any of the 6 keys is missing. "
                "Do not evaluate content quality, humor, or style — only check structure."
            )
        )

        self.last_match = result

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
