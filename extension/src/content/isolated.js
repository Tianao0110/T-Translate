// Isolated world at document_start: the page agent (bridge to the page
// world, media elements, navigation, captions) for the top frame. One per
// frame: injected again into a page that has a live one, it leaves it be.

import { createPageAgent } from './page-agent.js';

if (!globalThis.__tcAgent?.alive) globalThis.__tcAgent = createPageAgent();
