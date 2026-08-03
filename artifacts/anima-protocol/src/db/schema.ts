// This file provides a minimal export for the characters schema.
// The original file contained Express route code which caused
// module/type resolution issues when importing this path as a schema.

// Export a placeholder characters object so other modules importing
// ../db/schema can resolve the symbol. Replace with a proper
// Drizzle/ORM table definition as needed.

export const characters: any = {}

export type Character = {
  id: string
  userId: string
  name: string
  type: string
  createdAt: Date
}
