import os
from anima_protocol import LewdEngine, Character  # Import from the detailed file

print("=== ANIMA-PROTOCOL MAIN ENTRY POINT ===")
print("Launching full visceral anal breeding simulation...\n")

# Adult Mode Check
ADULT_MODE = os.getenv("ADULT_MODE_ENABLED", "false").lower() == "true"

if ADULT_MODE:
    print("✅ ADULT MODE UNLOCKED - MAXIMUM DETAIL ANAL BREEDING ACTIVE")
    print(
        "Kink Focus: Multiple rounds, different positions, heavy stretching, deep creampie breeding, psychological collapse.\n"
    )

    # Initialize characters with high intensity settings
    dom = Character(name="Dominant", dominance=94, arousal=72, sensitivity=1.0)

    sub = Character(
        name="Submissive Woman",
        dominance=10,
        arousal=52,
        wetness=48,
        control=55,
        sensitivity=1.65,
    )

    # Launch the full detailed engine
    engine = LewdEngine(dom, sub)
    engine.run_lewd_scene()

    print("\n=== SESSION COMPLETE ===")
    print(
        "You can now expand this further — add Flask routes, multiple girls, save states, etc."
    )

else:
    print("❌ Adult mode locked.")
    print("Go to Secrets tab → Add ADULT_MODE_ENABLED with value 'true'")
    print("Then run again for the full raw anal breeding experience.")
import os
from anima_protocol import AnimaProtocol, Character

print("=== ANIMA-PROTOCOL v2 - MULTI-UNIVERSE CHARACTER HUB ===")

ADULT_MODE = os.getenv("ADULT_MODE_ENABLED", "false").lower() == "true"

protocol = AnimaProtocol()

# Example: Loading characters from different universes
protocol.add_character(Character("2B", "Nier: Automata", dominance=45, sensitivity=1.4))
protocol.add_character(Character("Rias Gremory", "High School DxD", dominance=75, sensitivity=1.6))
protocol.add_character(Character("Submissive Android", "Original", dominance=15, sensitivity=1.65))

if ADULT_MODE:
    print("✅ ADULT MODE UNLOCKED - Visceral interactions enabled")
    # Trigger a sample multi-character scene
    protocol.start_interaction("2B", "Rias Gremory", scene_type="anal_breeding")
else:
    print("Adult mode locked. Enable ADULT_MODE_ENABLED=true in Secrets for full visceral mode.")