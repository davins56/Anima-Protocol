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
