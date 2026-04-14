export const selfHostedProjectKeys = {
  list: () => ['self-hosted-projects'] as const,
  health: (ref: string) => ['self-hosted-projects', ref, 'health'] as const,
}
