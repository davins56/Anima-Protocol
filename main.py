    import os
    from anima_protocol import AnimaProtocol

    print("=== ANIMA PROTOCOL v2 - MULTI-UNIVERSE CHARACTER HUB ===")
    print("Core Concept: Interact with characters from any universe in one space.\n")

    ADULT_MODE = os.getenv("ADULT_MODE_ENABLED", "false").lower() == "true"

    # Initialize the protocol
    protocol = AnimaProtocol()

    # === ADD CHARACTERS FROM DIFFERENT UNIVERSES ===
    protocol.add_character("2B", "Nier: Automata", dominance=40, sensitivity=1.45)
    protocol.add_character("Rias Gremory", "High School DxD", dominance=80, sensitivity=1.6)
    protocol.add_character("A2", "Nier: Automata", dominance=55, sensitivity=1.5)
    protocol.add_character("Submissive Android", "Original", dominance=15, sensitivity=1.7)

    if ADULT_MODE:
        print("✅ ADULT MODE UNLOCKED — Full visceral scenes enabled\n")
        # Example: Cross-universe anal breeding session
        protocol.start_interaction("2B", "Submissive Android", scene_type="anal_breeding")
    else:
        print("Adult mode is locked. Set ADULT_MODE_ENABLED=true in Secrets for explicit scenes.")