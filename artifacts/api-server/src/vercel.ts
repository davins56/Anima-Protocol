// Vercel Fluid compute entry — export the Express app without binding a port.
import app from "./app";
<<<<<<< HEAD
=======
import { ensureClerkPreviewRedirects } from "./lib/ensureClerkPreviewRedirects";

// Register this preview deployment's Clerk callback URLs on cold start. Vercel
// preview hosts are unique per deployment, and Clerk does not allow wildcard
// redirect URLs.
void ensureClerkPreviewRedirects();
>>>>>>> origin/main

export default app;
