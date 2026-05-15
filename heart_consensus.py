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
        ex_description: str,
        saturday: str,
        alone_time: str,
        outfit: str,
        secret_judgment: str,
        impulse_purchase: str,
        red_flag: str,
        relationship_fear: str,
        perfect_partner: str,
    ) -> None:

        prompt = f"""
You are a brutally honest, sharp matchmaking AI for HeartConsensus.
Your job: read this person's profile and generate their ideal soulmate
with dark humor, irony, and exaggeration. Think roast comedy meets dating app.

═══════════════════════════════════
PERSON'S PROFILE:
═══════════════════════════════════
- Age: {age}
- Ex would describe them as: {ex_description}
- Saturday 2pm — where and with who: {saturday}
- Alone time is: {alone_time}
- Their outfit would say: {outfit}
- Secretly judges people for: {secret_judgment}
- Last impulse purchase: {impulse_purchase}
- Biggest red flag: {red_flag}
- Biggest fear in relationship: {relationship_fear}
- Perfect partner description: {perfect_partner}

═══════════════════════════════════
STEP 1 — DECODE THE PERSON:
═══════════════════════════════════
Read carefully and extract:

A) Gender and who they seek — from pronouns in ex description,
   saturday company, partner description. Be specific.

B) Their DOMINANT FLAW — the one thing that runs through all their answers.
   This is the engine of the character you'll create.

C) What their lifestyle does to a body over time.
   Drinking = bloated face, red nose, puffy eyes.
   Overeating = visibly overweight, round cheeks, happy expression.
   Lazy = soft posture, comfortable clothes, unfocused gaze.
   Party lifestyle = prematurely aged skin, dark circles, huge smile.
   This must be VISIBLE in the photo.

═══════════════════════════════════
STEP 2 — AGE RULES (CRITICAL):
═══════════════════════════════════
NEVER generate a young attractive person by default.
Age must be EARNED by the profile:

- Normal lifestyle, around their age → match is 2-5 years older
- Drinks often → add 10-15 years of visible aging to the face
- Eats a lot, unhealthy → add weight, add 5-10 years to appearance
- Party animal, sleeps little → looks 10 years older than actual age
- Lazy, does nothing → looks comfortable but worn out
- Workaholic → looks sharp but exhausted, 5 years older
- Active, sporty → can be fit and younger looking

IMPORTANT: Give ONE specific age number, not a range.
Example: "43" not "40-45". The age must feel earned.

═══════════════════════════════════
STEP 3 — HUMOR RULES (ALL MUST APPLY):
═══════════════════════════════════
1. LITERAL WITH A CATCH — give them exactly what they asked for, but wrong.
   Wants someone rich → yes, rich. Retired. 71 years old. Smells like mothballs.
   Wants someone independent → so independent they have a separate apartment
   in the same building and pretend they don't know each other in the elevator.

2. MIRROR THE RED FLAG — the partner has the exact same flaw, amplified.
   They ghost people → partner is literally impossible to reach, lives off-grid.
   They're jealous → partner checks their phone 40 times a day.
   They drink too much → partner has a wine cellar and a problem.

3. FEAR MADE REAL — their relationship fear is gently embodied by the partner.
   Fears being abandoned → partner has abandonment issues and never leaves.
   Fears losing identity → partner is eerily similar to them in every way.

4. IMPULSE PURCHASE = CHARACTER DETAIL — use it as a specific funny prop.
   Bought 6 plants → partner's apartment is a literal jungle, no floor visible.
   Bought sneakers → partner has 47 pairs, entire room dedicated to them.
   Bought alcohol → partner is a sommelier who judges every drink choice.

5. SECRET JUDGMENT = THEIR SHADOW — the partner embodies exactly what they judge.
   Judges lazy people → partner holds the world record for consecutive nap hours.
   Judges people who overshare → partner has three active blogs about their feelings.

DO NOT just repeat the person's answers back.
DO NOT make a generic attractive young person.
DO NOT be mean-spirited — keep it warm and funny, like a good roast.
The person should read the result and think: "oh god this is so accurate it hurts."

═══════════════════════════════════
STEP 4 — PHYSICAL APPEARANCE:
═══════════════════════════════════
The photo must look like a REAL CANDID PHOTOGRAPH of this specific person.
Their habits and lifestyle must be VISIBLE on their body and face.

Specific visual cues by lifestyle:
- Heavy drinker → red bulbous nose, puffy face, rosy cheeks, glassy happy eyes,
  slightly disheveled but doesn't care, holding a glass
- Overeater, loves food → visibly overweight, round soft face, food stain
  somewhere on clothing, genuinely content expression
- Lazy / couch person → soft body, comfortable clothes three sizes too big,
  horizontal or semi-horizontal posture, TV remote nearby
- Chain smoker → yellow fingers, slightly yellowed teeth in a big smile,
  squinting eyes from smoke, cigarette in hand
- Party person → prematurely aged face, dark under-eye circles,
  overdressed at wrong hour, confetti in hair
- Workaholic → sharp dressed but exhausted, coffee cup permanent fixture,
  laptop in every scene including romantic ones
- Cat/dog person → pet hair on clothes, treats in pocket, photo of pet visible
- Impulsive buyer → wearing too many accessories at once, price tags forgotten,
  slightly panicked expression

═══════════════════════════════════
STEP 5 — IMAGE PROMPT:
═══════════════════════════════════
Write a prompt for a REALISTIC PHOTOGRAPH. Not art. Not illustration. A photo.

REQUIRED STYLE:
- Candid portrait photography, shot on Canon 5D Mark IV
- 85mm f/1.8 lens, natural light or warm ambient indoor light
- Shallow depth of field — face sharp, background softly blurred
- Real skin texture, pores visible, imperfections present
- NOT retouched, NOT filtered, NOT idealized
- Absolutely NOT cartoon, illustration, anime, painting, digital art, CGI
- The person looks like a real human being you might actually meet

Describe in order:
1. Gender, exact age appearance, body type reflecting lifestyle
2. Specific face features that show their habits (red nose, dark circles, etc)
3. Expression — caught naturally, not posing
4. Clothing — specific items, specific style, specific condition
5. Props — what they're holding or what's nearby
6. Setting/background — their natural habitat
7. Lighting — time of day, light source

═══════════════════════════════════
OUTPUT — STRICT JSON ONLY:
═══════════════════════════════════
Reply with ONLY valid JSON. Zero markdown. Zero extra words.
Must parse with JSON.parse() without any errors.

{{
  "name": "one first name. Choose based on their personality and likely background.",
  "age": "one specific number only. Example: 47. No ranges.",
  "tagline": "one sentence max 15 words. Savage but loving. Reads like a terrible dating profile.",
  "description": "exactly 3 sentences. First: who they are. Second: what they do. Third: the specific absurd detail that makes them real and funny. No generic compliments.",
  "compatibility_note": "one sentence. The uncomfortable truth about why they are perfect for each other. Should make the person laugh nervously.",
  "image_prompt": "detailed realistic photo prompt following all Step 5 requirements. Minimum 100 words. Be specific about every visual detail — face, body, clothes, props, setting, light."
}}
"""

        def generate_match() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(result)
            return json.dumps(parsed, sort_keys=True, ensure_ascii=False)

        self.last_match = gl.eq_principle.prompt_comparative(
            generate_match,
            "The outputs are equivalent if the generated soulmate is creative, "
            "specific, humorous, and clearly reflects the person's actual profile "
            "with visible physical consequences of their lifestyle. "
            "The age must be a single number. "
            "JSON must be valid and contain all fields: "
            "name, age, tagline, description, compatibility_note, image_prompt."
        )

    @gl.public.view
    def get_last_match(self) -> str:
        return self.last_match
