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
        gender: str,
        friends_description: str,
        hobby: str,
        bad_habits: str,
        food_relationship: str,
        schedule: str,
        green_flag: str,
        red_flag: str,
        ideal_weekend: str,
        partner_must: str,
        money_attitude: str,
        conflict_style: str,
        boredom_activity: str,
        how_are_you: str,
    ) -> None:
        prompt = (
            "You are a savage satirical matchmaking AI. "
            "Read this dating profile and create a hilariously exaggerated fictional soulmate.\n"
            "IMPORTANT: if the user gender is male, create a FEMALE soulmate. If female, create a MALE soulmate.\n\n"
            "PROFILE:\n"
            "Age: " + age + "\n"
            "Gender: " + gender + "\n"
            "Friends describe me as: " + friends_description + "\n"
            "Hobbies: " + hobby + "\n"
            "Bad habits: " + bad_habits + "\n"
            "Food relationship: " + food_relationship + "\n"
            "Schedule: " + schedule + "\n"
            "Green flag in partner: " + green_flag + "\n"
            "Red flag I overlook: " + red_flag + "\n"
            "Ideal weekend: " + ideal_weekend + "\n"
            "Partner must: " + partner_must + "\n"
            "Money attitude: " + money_attitude + "\n"
            "Conflict style: " + conflict_style + "\n"
            "When bored: " + boredom_activity + "\n"
            "When asked how are you: " + how_are_you + "\n\n"
            "RULES:\n"
            "1. Pick the ONE most absurd trait and push it to the extreme.\n"
            "2. The character description must be funny and over-the-top.\n"
            "3. The image_prompt must be funny and exaggerated but NOT scary or depressing.\n"
            "   - alcohol/drinking -> cheerful rosy person, big grin, holding a beer, cozy messy apartment\n"
            "   - overeating/food -> chubby happy person, huge smile, surrounded by snacks, cozy couch\n"
            "   - lazy/couch -> cozy blissful person in blanket, TV remote in hand, unbothered smile\n"
            "   - gym/fitness -> ridiculous huge muscles, proud goofy smile, tiny tank top, gym mirror\n"
            "   - workaholic -> exhausted but cheerful, coffee cups everywhere, funny tired smile\n"
            "   - money/greed -> tacky gold jewelry, smug grin, counting cash, looks ridiculous\n"
            "   - gaming -> pale cheerful gamer, headphones, energy drinks, big enthusiastic smile\n"
            "4. Always end image_prompt with: "
            "'warm lighting, funny expression, one person only, realistic photo, no cartoon'\n\n"
            "Respond with ONLY valid JSON, no markdown, no backticks:\n"
            "{\"name\": \"FIRST NAME and LAST NAME only, no nickname, no quotes\", "
            "\"age\": \"AGE\", "
            "\"tagline\": \"one-liner that perfectly captures their absurd trait\", "
            "\"description\": \"2-3 sentences of savage funny description\", "
            "\"compatibility_note\": \"why you two are perfect for each other (sarcastic and specific)\", "
            "\"image_prompt\": \"start with man or woman, then extremely detailed visual description\"}"
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
