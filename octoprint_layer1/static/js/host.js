// What to call the computer OctoPrint runs on. On a Raspberry Pi that is "Pi", what its
// owners call it; anywhere else (a mini PC, a NAS, Docker) "System", OctoPrint's own word
// for it (Shutdown system, Reboot system). /sysinfo's model says which (ctx.refreshNet and
// quick info pass it in); until it has answered, the neutral word.

let pi = false;

export function setHostModel(model) {
  pi = /raspberry pi/i.test(model || '');
}

export const isPi = () => pi;

/** "Pi" or "System", for labels like `Reboot ${hostWord()}`. */
export const hostWord = () => (pi ? 'Pi' : 'System');

/** "Pi" or "system", inside a sentence. */
export const hostNoun = () => (pi ? 'Pi' : 'system');
