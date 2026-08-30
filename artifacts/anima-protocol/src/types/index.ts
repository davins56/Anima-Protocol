// src/types/index.ts
export type AV =
  | 'avatar'
  | 'variant'
  | 'model'
  | 'voice'
  | 'persona'
  | 'starter'
  | 'mockup'
  | 'resonance'
  | 'companion';   // ← add more as you see them in starterCharacters.ts

// You can expand this later with interfaces too
export interface StarterCharacter {
  id: string;
  type: AV;
  name: string;
  // add other fields from your data as needed
}