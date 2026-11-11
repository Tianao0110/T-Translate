// One companion session's events on their way to the stream that holds it
// (audio-feeder.js, listen-session.js). A seek hands the session to the next
// stream: later events go there, a translation still goes where its segment
// went, and while a lease waits for its taker a 'closed' marks it dead.

const KEEP = 4;

export function createSessionRoute(target) {
  const before = []; // { upTo, target }: earlier holders and the last segment id each got
  let lastSegment = null;
  let onClosed = () => {};
  const route = {
    target,
    sub: null, // the client's subscription feeding deliver
    lease: null,
    closed: new Promise((r) => (onClosed = r)), // the session's 'closed' came
    deliver(evt) {
      let to = route.target;
      if (evt.type === 'segment' && evt.id != null) lastSegment = evt.id;
      else if (evt.type === 'translation') to = before.find((b) => evt.id <= b.upTo)?.target ?? to;
      else if (evt.type === 'closed') {
        if (route.lease) route.lease.dead = true;
        onClosed();
      }
      to(evt);
    },
    hand(next) {
      if (lastSegment !== null) {
        before.push({ upTo: lastSegment, target: route.target });
        if (before.length > KEEP) before.shift();
      }
      route.target = next;
      route.lease = null;
    },
  };
  return route;
}
