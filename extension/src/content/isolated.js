// Isolated world at document_idle. The bridge to the page world and the
// caption rendering land here later; for now one ping to the service worker,
// the page is left alone.

import { MSG, request } from '../shared/messages.js';

request(MSG.PING);
