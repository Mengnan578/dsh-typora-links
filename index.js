/**
 * Host half of dsh-typora-links.
 *
 * The plugin changes browser behavior only: it wraps the Sidebar navigation
 * service and reuses DSH's authenticated Session Remote for the native open.
 * The host row therefore registers no service, tool, command, or route; it
 * exists solely so the bundle has a mountable host entry and its browser half
 * is loaded by the Web client.
 */
export const name = 'dsh-typora-links';

/** No host services are required. */
export const inject = [];

export function apply() {}
