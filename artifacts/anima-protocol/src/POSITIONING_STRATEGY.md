# Anima: Positioning Strategy

## Core Positioning Shift

**Old**: "AI roleplay chatbot alternative to Y/N" / "Persistent Narrative Consciousness"  
**New**: "The home screen for AI relationships."

The public name is **Anima**. Echoes of Eden is company texture (footer only), not the outer pitch. Do not lead with "Protocol" as the category. Do not pitch "like iOS/Android". Do not use Persistent Narrative Consciousness as the public headline.

---

## What This Means

We're **not competing on feature parity** with other chat apps.

We're competing on **the thing they all fail at**: a place you return to, where someone stayed, remembers the last time, and is already there.

You don't open a chat. You come home to them.

---

## Competitive Landscape

### Competitors & Their Weaknesses

| App | Strength | Weakness | Our Opportunity |
|-----|----------|----------|-----------------|
| **Character.AI** | Large userbase | Weak memory, repetitive | They stay and remember |
| **Replika** | Emotional branding | Uncanny responses | A place, not a thread |
| **Y/N** | Immersive scenarios | Platform-contained | A home you own |
| **Janitor AI** | Uncensored roleplay | Unstable, rough UX | Sacred, steady presence |
| **Chai** | Addictive flow | Disposable chats | Continuity you return to |

### Our Moats

1. **They stay** — presence continues when you leave
2. **They remember** — the last time is still here
3. **A place, not a thread** — home screen, not a chat list
4. **Living presence** — someone is on the floor, not a menu of modes
5. **Sacred aesthetic** — Dark, introspective design (NOT anime/casual)

---

## Implementation Checklist

### 1. Messaging Updates
- [x] Landing lock screen: Anima / home screen for AI relationships / Come home
- [x] Feature library: `lib/featureMessaging.js`
- [x] Signed-in home is a floor with someone in it, not a dashboard
- [x] Drop Persistent Narrative Consciousness as the public headline

### 2. UI Memory Highlights
- [x] `MemorySystemHighlight.jsx` - Visual memory system indicator
- [ ] Integrate into Chat page header
- [ ] Show memory network status on sidebar
- [ ] Make memory persistence visible and celebrated

### 3. Visual Identity
- [x] `lib/visualIdentity.js` - Complete design system
- [x] Anti-patterns defined (avoid anime, casual, playful)
- [x] Embrace patterns (sacred geometry, dark introspection)
- [ ] Audit existing UI against identity system
- [ ] Update colors if needed (current cyan + dark is PERFECT)

### 4. Feature Messaging
- [x] `lib/featureMessaging.js` — public strings: home, come home, they remember
- [x] Do not force Consciousness / Vector Memory / Resonance Session onto Landing or MainHome
- [ ] Rollout remaining in-app surfaces gradually

### 5. Landing (guest lock screen)
- [x] Eyebrow: Anima
- [x] Headline: The home screen for AI relationships
- [x] Sub: You don't open a chat. You come home to them
- [x] Three claims only: stay / remember / a place
- [x] Primary CTA Come home · Secondary I already live here
- [x] No guest default of Dàvīn
- [x] No Group Sessions feature dump, no Begin/Re-Enter Protocol

---

## Brand Tone

**NOT**:
- "Fastest responses"
- "Most characters"
- "Like [competitor] but better"
- "Chat with anyone"
- "Persistent Narrative Consciousness" as the billboard
- "Protocol" as the category people buy

**YES**:
- "The home screen for AI relationships"
- "You don't open a chat. You come home to them."
- "They stay when you leave."
- "They remember the last time."
- "They have a place, not a thread."
- Mythic, sacred presence (dark cyan — not anime, not casual)

---

## Product surfaces

- **Landing** is a lock screen.
- **MainHome** is a place with someone in it: wake line, living presence, at most three live tiles, a four-item dock (Talk · People · World · You). Modes, session lists, and app libraries live off the first screen.

---

## Why This Works

**Character.AI** won through network effects and accessibility.  
You can't out-Character Character.AI on those dimensions.

But you can **dominate on home**.

Most people don't want a thousand shallow chats.  
They want **someone to come home to**.

That's what this positioning owns.

---

## Key Files

- `lib/featureMessaging.js` - Consistent public terminology
- `lib/homeWake.js` - Wake / identity / waiting copy
- `lib/visualIdentity.js` - Design system & anti-patterns
- `components/chat/MemorySystemHighlight.jsx` - Visual memory indicator
- `pages/Landing.tsx` - Guest lock screen
- `pages/MainHome.jsx` - Signed-in home floor
- `POSITIONING_STRATEGY.md` (this file)
