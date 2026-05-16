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

        prompt = f"""You are a brutally funny matchmaking AI. Analyze this person and generate their perfect (wrong) match.

RULES:
1. GRANT THE WISH, TWIST THE WRAPPING: Give them what they asked for (green_flag, partner_must) but in the most inconvenient real-world version.
   - Wants "rich"? She's rich, 61, runs everything, tolerates nothing.
   - Wants "funny"? Hilarious. Unemployed since 2021.
   - Wants "caring"? Cares about everything. Including your posture.
2. FIND THE MIRROR: Match their red_flag and bad_habits but one level worse.
   - Lazy → legendary lazy. Drinks → loyalty card at the bar. Games → 4000 hours, no daylight.
3. Be specific and visual. Not "messy" — "three pizza boxes and a cat named Debt."
4. Detect the language of the answers and respond in that same language.
5. The image_prompt must describe a REALISTIC PHOTO PORTRAIT — like a candid photo, NOT anime, NOT illustration.
   MOST IMPORTANT: identify the single most extreme trait of this character (drinking, eating, gaming, fitness, cleaning obsession, etc.)
   and push it to visual absurdity in the photo. Examples:
   - Drinker → red puffy face, glassy eyes, holding a bottle, bar background at noon, disheveled
   - Overeater → visibly overweight, food stains on shirt, fast food wrappers visible, crumbs on chin
   - Gamer → pale skin, dark circles, unwashed hair, gaming setup glow, energy drink cans everywhere
   - Fitness obsessed → overly muscular, protein shaker in hand, gym mirror selfie, veins visible
   - Clean freak → rubber gloves still on, bleach smell implied, immaculate but tense expression
   - Workaholic → suit at midnight, laptop open, coffee cups stacked, dead eyes
   The photo should make someone laugh the moment they see it. One look = instantly understand the character.
   End the prompt with: "photorealistic portrait photo, natural light, 35mm, candid, no illustration, no anime"

PERSON:
- Age: {age}
- Friends say: {friends_description}
- Hobby: {hobby}
- Bad habits: {bad_habits}
- Food: {food_relationship}
- Schedule: {schedule}
- Green flag: {green_flag}
- Red flag: {red_flag}
- Ideal weekend: {ideal_weekend}
- Partner must: {partner_must}

Return ONLY a JSON object. No markdown, no backticks, no explanation. Just the raw JSON.
Required fields: name, age, tagline, description, compatibility_note, image_prompt.
The "age" field must be a single specific number like "34", not a range.
Example format:
{{"name":"Sofia","age":"34","tagline":"One sentence punchline.","description":"Two or three sentences about them.","compatibility_note":"One sentence why they match.","image_prompt":"Physical description... photorealistic portrait photo, natural light, 35mm, no illustration"}}"""

        def generate_match() -> str:
            result = gl.nondet.exec_prompt(prompt)
            # Strip markdown if present
            result = result.strip()
            if result.startswith("```"):
                result = result.replace("```json", "").replace("```", "").strip()
            # Extract JSON object
            start = result.find("{")
            end = result.rfind("}") + 1
            if start == -1 or end == 0:
                raise ValueError("No JSON object found in response")
            json_str = result[start:end]
            parsed = json.loads(json_str)
            # Validate required fields
            for field in ["name", "age", "tagline", "description", "compatibility_note", "image_prompt"]:
                if field not in parsed:
                    raise ValueError(f"Missing field: {field}")
            return json.dumps(parsed, sort_keys=True, ensure_ascii=False)

        self.last_match = gl.eq_principle.prompt_comparative(
            generate_match,
            "The outputs are equivalent if both describe a similar character type "
            "with the same core twist on the person's wishes and flaws. "
            "Minor differences in name, wording, or details are acceptable. "
            "Both must be valid JSON with all required fields."
        )

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
