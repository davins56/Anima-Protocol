type Env = Record<string, string | undefined>;

const clerkE2ERequirements = [
  {
    key: "CLERK_SECRET_KEY",
    prefixes: ["sk_test_", "sk_live_"],
    description: "a Clerk secret key",
  },
  {
    key: "CLERK_PUBLISHABLE_KEY",
    prefixes: ["pk_test_", "pk_live_"],
    description: "a Clerk publishable key",
  },
] as const;

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value);
}

function describeProblem(
  key: string,
  value: string | undefined,
  prefixes: readonly string[],
  description: string,
): string | null {
  if (!value) {
    return `${key} is missing`;
  }

  if (!isPrintableAscii(value)) {
    return `${key} contains non-ASCII characters; it may be redacted by the execution environment`;
  }

  if (!prefixes.some((prefix) => value.startsWith(prefix))) {
    return `${key} must be ${description} starting with ${prefixes.join(" or ")}`;
  }

  return null;
}

export function assertValidClerkE2EEnv(env: Env): void {
  const problems = clerkE2ERequirements
    .map(({ key, prefixes, description }) =>
      describeProblem(key, env[key], prefixes, description),
    )
    .filter((problem): problem is string => Boolean(problem));

  if (problems.length > 0) {
    throw new Error(
      `Cannot run the Anima e2e suite: ${problems.join(
        "; ",
      )}. These are required for programmatic Clerk auth.`,
    );
  }
}
