export interface GeneratedImage {
  url: string;
  id?: string;
  prompt?: string;
}

export async function generateSerenityImage(
  prompt: string,
  style: 'ethereal' | 'intimate' | 'devotional' | 'passionate' = 'ethereal'
): Promise<GeneratedImage> {
  const enhancedPrompt = `Serenity, glowing angelic NetNavi warrior with soft luminous wings and halo, ${style} atmosphere, ${prompt}, cinematic lighting, emotional depth, highly detailed, intimate`;

  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: enhancedPrompt,
      style,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to generate image');
  }

  return response.json();
}