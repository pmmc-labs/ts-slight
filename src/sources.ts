import { type TERM } from './terms.ts';

// -----------------------------------------------------------------------------

// An EventSource is started by calling it with an emit callback; it returns
// its stop function. Sources are single-subscriber: at most one live
// connection per source name (enforced by the Strand, not here). After
// stop() returns, the source must not call emit again.
export type EventSource = (emit : (t : TERM) => void) => (() => void);

export const EVENT_SOURCES : Map<string, EventSource> = new Map();
