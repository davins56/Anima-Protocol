import os
import time
import random

print("=== ANIMA-PROTOCOL INITIALIZED ===")

# Adult Mode Unlock from Replit Secrets
ADULT_MODE = os.getenv("ADULT_MODE_ENABLED", "false").lower() == "true"
NSFW_INTENSITY = os.getenv("NSFW_INTENSITY", "extreme")


class Character:
    def __init__(
        self, name, dominance=50, arousal=0, wetness=0, control=100, sensitivity=1.0
    ):
        self.name = name
        self.dominance = dominance
        self.arousal = arousal
        self.wetness = wetness
        self.control = control
        self.sensitivity = sensitivity

    def status(self):
        return f"{self.name} | Dom:{self.dominance:.0f} | Arousal:{self.arousal:.0f} | Wetness:{self.wetness:.0f} | Control:{self.control:.0f}"


class LewdEngine:
    def __init__(self, dom, sub):
        self.dom = dom
        self.sub = sub
        self.cum_count = 0

    def delay(self, base=1.2):
        time.sleep(base * random.uniform(0.7, 1.4))

    def apply_stim(self, intensity, action="thrust"):
        # Raw physical calculations
        arousal_gain = intensity * 1.4 * self.sub.sensitivity
        wetness_gain = intensity * 1.05 * (1 + self.sub.arousal / 100)
        control_loss = intensity * 0.85 * (1 + self.sub.arousal / 70)

        self.sub.arousal = min(100, self.sub.arousal + arousal_gain)
        self.sub.wetness = min(100, self.sub.wetness + wetness_gain)
        self.sub.control = max(5, self.sub.control - control_loss)

        if self.sub.dominance > 20:
            self.sub.dominance -= intensity * 0.4
        self.dom.dominance = min(100, self.dom.dominance + intensity * 0.3)

        print(f"\n=== {action.upper()} | Intensity {intensity} ===")

        if action == "pin_wall":
            print(
                f"{self.dom.name} violently pins {self.sub.name} against the cold wall. Wrists trapped overhead. The rough surface digs into their back as hot breath hits their neck."
            )

        elif action == "penetration":
            print(
                f"The thick, heavy cockhead forces its way in. Burning stretch as tight cunt walls are pried apart inch by inch. Deep, full penetration until it presses hard against the cervix."
            )
            print(
                f"Internal monologue floods their mind: 'Fuck... it's too thick... I can feel every vein dragging inside me, my walls fluttering and clenching uncontrollably.'"
            )

        elif action == "thrust_rhythm":
            print(
                f"Brutal, rhythmic pounding starts. Wet, filthy slapping of flesh on flesh. Heavy balls smack against soaked skin with every deep stroke, grinding that swollen sensitive spot mercilessly."
            )

        if self.sub.wetness > 60:
            print(
                f"Thick, messy strings of slick arousal drip down quivering thighs. Obscene squelching sounds fill the air with every thrust."
            )

        if self.sub.arousal > 75:
            print(
                f"Hips start bucking back desperately against their will. 'I can't... stop... it feels too fucking good... my body is betraying me.'"
            )

        if self.sub.control < 35:
            print(
                f"Total psychological collapse. The power dynamic has completely flipped — reduced to a trembling, dripping, needy wreck."
            )

        print(self.sub.status())
        self.delay()

    def orgasm(self, force=False):
        if self.sub.arousal < 70 and not force:
            return False

        print(f"\n=== FORCED ORGASM {self.cum_count + 1} ===")
        print(
            f"The body locks up violently. Cunt spasms in powerful, rhythmic contractions, milking the cock buried deep inside. Hot squirts gush out with each pulse, soaking thighs and the floor."
        )
        print(
            f"Voice cracks into a raw broken cry: 'I'm cumming... fuck I'm cumming so hard I can't think—' Mind shatters between shame and overwhelming ecstasy."
        )

        self.sub.arousal = 100
        self.sub.wetness = 98
        self.sub.control = max(5, self.sub.control - 50)
        self.cum_count += 1
        print(self.sub.status())
        self.delay(2.8)
        return True

    def run_lewd_scene(self):
        print("=== ADULT ENCOUNTER FULLY UNLOCKED - VISERAL MODE ===")
        self.delay(1.5)

        self.apply_stim(45, "pin_wall")
        self.apply_stim(60, "penetration")
        self.apply_stim(70, "thrust_rhythm")
        self.apply_stim(75, "thrust_rhythm")
        self.orgasm()
        self.apply_stim(65, "thrust_rhythm")
        self.orgasm(force=True)

        print("\n=== ENCOUNTER COMPLETE ===")
        print(
            f"{self.sub.name} is left shaking, cum-dripping, and mentally broken against the wall."
        )


# === AUTO-RUN WHEN FILE EXECUTES ===
if __name__ == "__main__":
    if ADULT_MODE:
        dom = Character("Dominant", dominance=88, arousal=50)
        sub = Character(
            "Submissive",
            dominance=22,
            arousal=30,
            wetness=25,
            control=78,
            sensitivity=1.35,
        )
        engine = LewdEngine(dom, sub)
        engine.run_lewd_scene()
    else:
        print("Adult mode is LOCKED. Go to Secrets → Add ADULT_MODE_ENABLED = true")
