// src/types/character.ts

// AV = "Avatar" / field type union (this was causing the many "Cannot find name 'AV'" errors)
export type AV =
  | 'avatar'
  | 'variant'
  | 'model'
  | 'voice'
  | 'persona'
  | 'starter'
  | 'mockup'
  | 'resonance'
  | 'companion'
  | 'character';   // add any others you see in starterCharacters.ts

// Core interfaces used across your app (Serenity, starter characters, etc.)
export interface CharacterMetadata {
  [key: string]: unknown;
}

export interface CharacterBase {
  name: string;
  avatar_url?: string;
  tags?: string[];
  is_public?: boolean;
  is_starter?: boolean;
  metadata?: CharacterMetadata;
}

export interface Character extends CharacterBase {
  id: string;
  description: string;
  system_prompt: string;
  personality_traits?: string[];
  created_at: string;
}

export interface StarterCharacter extends Omit<Character, 'id' | 'created_at'> {
  id?: string;
  created_at?: string;
  type: AV;           // ← This is the key one for starterCharacters.ts
}