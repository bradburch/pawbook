/** Widget tenant comes from the iframe path: /embed/:slug — never from the host page. */
export const slug = window.location.pathname.split('/').filter(Boolean)[1] ?? '';

export const errorMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Try again.');
